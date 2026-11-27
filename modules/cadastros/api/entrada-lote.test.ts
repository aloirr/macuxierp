/**
 * T-0057 C3 (ADR 0014 §3): o worker que processa o lote da `/entrada/v1`: valida, adapta, grava por `gravarLinhas`, guarda o resultado
 * por linha sem o dado e avança o cursor. Em memória (o banco real está em entrada-lote.db.test.ts).
 */
import { TRABALHO_ENTRADA_LOTE, type Trabalho } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, FilaDeTrabalhosMemoria, OutboxMemoria } from '@macuxierp/platform-sdk/testes';
import type { CorpoLote } from '@macuxierp/platform-sdk/hub-v1';
import { describe, expect, it } from 'vitest';
import { EntradaMemoria } from './entrada-memoria';
import { aplicarIrmasDaForma } from './carga-gravar';
import { criarExecutorEntradaLote } from './entrada-lote';
import { dependenciasEmMemoria } from './memoria';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const AGORA = new Date('2026-11-26T16:00:00.000Z');
const CNPJ = '99.000.001/0001-01';

const vendedor = (n: number, alterado_em: string, extra: Record<string, unknown> = {}) => ({
  external_id: `V${n}`, alterado_em, ativo: true, nome: `Vendedor ${n}`, ...extra,
});
const filial = (n: number, alterado_em: string) => ({
  external_id: `F${n}`, alterado_em, ativo: true, codigo: `0${n}`, nome: `Filial ${n}`, cidade: 'Manaus', uf: 'AM', cnpj: CNPJ, logradouro: 'Rua Exemplo', numero: '100', bairro: 'Centro', cep: '69000000',
});

const corpo = (entidade: string, registros: unknown[], extra: Partial<CorpoLote> = {}): CorpoLote => ({
  versao_contrato: 'v1', entidade, modo: 'delta', enviado_em: '2026-11-26T15:59:00.000Z', cursor: null, registros, linhas_invalidas: [], linhas_invalidas_omitidas: 0, ...extra,
}) as CorpoLote;

function montar() {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  // O vendedor sem filial vai para a filial padrão do ERP (RN-CAD-08).
  m.repos.filiais.linhas.push({ id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a0001', inativo: false, padrao: true, external_id: 'FP', nome: 'Padrão' });
  const entrada = new EntradaMemoria();
  const outbox = new OutboxMemoria();
  const auditoria = new AuditoriaMemoria();
  const fila = new FilaDeTrabalhosMemoria();
  const executor = criarExecutorEntradaLote({ repositorios: m.deps.repositorios, entrada: () => entrada, outbox, auditoria, fila, agora: () => AGORA });
  const tx = { consultar: async () => [] };
  const receber = async (c: CorpoLote, chave = `chave-${entrada.lotes.length + 1}-xxxxxxxx`) => {
    const { lote } = await entrada.criarLote({
      credencial_id: 'cred', conector_id: 'conector-1', entidade: c.entidade, modo: c.modo, idempotency_key: chave, hash_corpo: 'h'.repeat(64), corpo: c,
      recebidos: c.registros.length + c.linhas_invalidas.length + c.linhas_invalidas_omitidas,
    });
    return lote.id;
  };
  const trabalho = (loteId: string): Trabalho => ({ id: 'trab-1', tipo: TRABALHO_ENTRADA_LOTE, tenant_id: TENANT, payload: { lote_id: loteId }, tentativas: 0 });
  const rodar = (loteId: string) => executor.executar(trabalho(loteId), tx);
  return { ...m, entrada, outbox, auditoria, fila, executor, tx, receber, rodar, trabalho };
}

describe('T-0057 C3: processamento do lote da entrada', () => {
  it('ADR 0014 §3: grava o delta, conclui o lote, zera o corpo e avança o cursor', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z'), vendedor(2, '2026-11-26T10:00:00.000Z')]));
    expect(await t.rodar(id)).toMatchObject({ processados: 1 });
    const l = t.entrada.lotes[0]!;
    expect(l).toMatchObject({ estado: 'concluido', com_erro: 0, corpo: null, contagens: { recebidas: 2, novas: 2, atualizadas: 0, inalteradas: 0 } });
    expect(t.repos.vendedores.linhas.map((v) => v.external_id)).toEqual(['V1', 'V2']);
    expect(t.entrada.cursores.get('conector-1|vendedor')?.cursor).toEqual({ alterado_em: '2026-11-26T10:00:00.000Z', external_id: 'V2' });
    expect(t.outbox.eventos.map((e) => e.nome)).toContain('cadastros.vendedor.alterado@1');
    expect(t.auditoria.registros.map((r) => r.acao)).toContain('cadastros.entrada_lote.processar');
  });

  it('reenvio do mesmo registro não muda nada: conta como inalterada', async () => {
    const t = montar();
    await t.rodar(await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')])));
    await t.rodar(await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')])));
    expect(t.entrada.lotes[1]).toMatchObject({ estado: 'concluido', contagens: { novas: 0, atualizadas: 0, inalteradas: 1 } });
  });

  it('RN-INT-01 e LGPD: o erro da linha guarda índice, external_id, campo e código, nunca o valor; o cursor ignora a linha com erro', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [
      vendedor(1, '2026-11-25T10:00:00.000Z', { nome: 'Ana Segredo' }),
      vendedor(2, '2026-11-26T10:00:00.000Z', { nome: `Beto Segredo ${'x'.repeat(90)}` }),
      { external_id: 'V3', alterado_em: '2026-11-26T11:00:00.000Z', ativo: true },
    ]));
    await t.rodar(id);
    const l = t.entrada.lotes[0]!;
    expect(l.estado).toBe('concluido_com_erros');
    expect(l.com_erro).toBe(2);
    expect(l.erros.map((e) => [e.indice, e.external_id, e.campo, e.codigo])).toEqual([[1, 'V2', 'nome', 'formato_invalido'], [2, 'V3', 'nome', 'campo_obrigatorio']]);
    expect(JSON.stringify(l)).not.toMatch(/Segredo/);
    expect(t.entrada.cursores.get('conector-1|vendedor')?.cursor).toEqual({ alterado_em: '2026-11-25T10:00:00.000Z', external_id: 'V1' });
    expect(t.repos.vendedores.linhas.map((v) => v.external_id)).toEqual(['V1']);
  });

  it('RN-CAD-01: a filial nova do Hub não traz o CRT e é recusada em crt (campo_obrigatorio); o resto do lote segue', async () => {
    const t = montar();
    await t.rodar(await t.receber(corpo('filial', [filial(1, '2026-11-25T10:00:00.000Z')])));
    expect(t.entrada.lotes[0]).toMatchObject({ estado: 'concluido_com_erros', erros: [{ indice: 0, external_id: 'F1', campo: 'crt', codigo: 'campo_obrigatorio' }] });
    expect(t.entrada.cursores.has('conector-1|filial')).toBe(false);
  });

  it('referência ausente vira referencia_ausente (reprocessável) e o resto do lote grava', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [
      vendedor(1, '2026-11-26T10:00:00.000Z', { filial_external_id: 'FX' }),
      vendedor(2, '2026-11-26T10:01:00.000Z'),
    ]));
    await t.rodar(id);
    const l = t.entrada.lotes[0]!;
    expect(l.erros).toEqual([{ indice: 0, external_id: 'V1', campo: 'filial_external_id', codigo: 'referencia_ausente' }]);
    expect(l.contagens).toMatchObject({ novas: 1, com_erro: 1 });
  });

  it('delta com o mesmo external_id duas vezes: vale o último e conta duplicadas_no_lote, sem erro', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z', { nome: 'Antiga' }), vendedor(1, '2026-11-26T10:00:00.000Z', { nome: 'Nova' })]));
    await t.rodar(id);
    const l = t.entrada.lotes[0]!;
    expect(l).toMatchObject({ estado: 'concluido', com_erro: 0, contagens: { recebidas: 2, duplicadas_no_lote: 1, novas: 1 } });
    expect(t.repos.vendedores.linhas).toHaveLength(1);
    expect(t.repos.vendedores.linhas[0]).toMatchObject({ nome: 'Nova' });
  });

  it('linhas_invalidas do Conector entram como erro com origem conector, depois dos registros', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')], {
      linhas_invalidas: [{ external_id: 'F9', codigo: 'formato_invalido', campo: 'nome', mensagem: 'Nome fora do formato' }], linhas_invalidas_omitidas: 2,
    }));
    await t.rodar(id);
    const l = t.entrada.lotes[0]!;
    expect(l.erros).toEqual([{ indice: 1, external_id: 'F9', campo: 'nome', codigo: 'formato_invalido', origem: 'conector' }]);
    expect(l).toMatchObject({ estado: 'concluido_com_erros', com_erro: 1, recebidos: 4, contagens: { invalidas_omitidas: 2 } });
  });

  it('um lote por vez por entidade e conector: o trabalho do 2º lote processa o 1º antes, na ordem de chegada', async () => {
    const t = montar();
    const a = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')]));
    const b = await t.receber(corpo('vendedor', [vendedor(2, '2026-11-26T10:00:00.000Z')]));
    expect(await t.rodar(b)).toMatchObject({ processados: 2 });
    expect(t.entrada.processados).toEqual([a, b]);
    expect(t.entrada.lotes.map((l) => l.estado)).toEqual(['concluido', 'concluido']);
    expect(await t.rodar(a)).toMatchObject({ processados: 0 });
  });

  it('forma_pagamento só valida e conta (a forma entra pelo prazo que a usa); registro inválido dá erro por linha', async () => {
    const t = montar();
    const id = await t.receber(corpo('forma_pagamento', [
      { external_id: 'FP1', alterado_em: '2026-11-26T10:00:00.000Z', ativo: true, codigo: 'BOLETO', nome: 'Boleto' },
      { external_id: 'FP2', alterado_em: '2026-11-26T10:00:00.000Z', ativo: true },
    ]));
    await t.rodar(id);
    const l = t.entrada.lotes[0]!;
    expect(l).toMatchObject({ estado: 'concluido_com_erros', contagens: { inalteradas: 1, novas: 0, com_erro: 1 } });
    expect(l.erros[0]).toMatchObject({ indice: 1, external_id: 'FP2' });
  });

  it('ADR 0014 §3 (contrato ContagensLote.obsoletas): registro anterior ao cursor não grava, conta como obsoleto e o cursor do lote não recua', async () => {
    const t = montar();
    await t.rodar(await t.receber(corpo('vendedor', [vendedor(1, '2026-11-26T10:00:00.000Z')])));
    const id = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z', { nome: 'Nome antigo' })]));
    await t.rodar(id);
    const l = t.entrada.lotes[1]!;
    expect(l.contagens).toMatchObject({ obsoletas: 1, novas: 0, atualizadas: 0 });
    expect(l.cursor).toEqual({ alterado_em: '2026-11-26T10:00:00.000Z', external_id: 'V1' });
    expect(t.repos.vendedores.linhas[0]!.nome).toBe('Vendedor 1');
  });

  it('lote de carga completa guardado (não deveria existir) falha sem gravar nada', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')], { modo: 'completo', sessao: { id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2d', parte: 1, ultimo: true } }));
    await t.rodar(id);
    expect(t.entrada.lotes[0]).toMatchObject({ estado: 'falhou', erro_codigo: 'carga_completa_nao_suportada', corpo: null });
    expect(t.repos.vendedores.linhas).toHaveLength(0);
  });

  it('aoDesistir marca o lote que travou a fila como falhou (falha_processamento) e pede novo trabalho para o do trabalho', async () => {
    const t = montar();
    const a = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')]));
    const b = await t.receber(corpo('vendedor', [vendedor(2, '2026-11-26T10:00:00.000Z')]));
    await t.executor.aoDesistir?.(t.trabalho(b), { consultar: async () => [] });
    expect(t.entrada.lotes.find((l) => l.id === a)).toMatchObject({ estado: 'falhou', erro_codigo: 'falha_processamento', corpo: null });
    expect(t.entrada.lotes.find((l) => l.id === b)?.estado).toBe('recebido');
    expect(t.fila.pedidos).toMatchObject([{ tipo: TRABALHO_ENTRADA_LOTE, tenant_id: TENANT, payload: { lote_id: b } }]);
  });

  it('o trabalho de um lote que já terminou não faz nada', async () => {
    const t = montar();
    const id = await t.receber(corpo('vendedor', [vendedor(1, '2026-11-25T10:00:00.000Z')]));
    await t.rodar(id);
    expect(await t.rodar(id)).toMatchObject({ processados: 0 });
    expect(t.entrada.lotes[0]!.estado).toBe('concluido');
  });
});

describe('RN-CAD-09: aplicarIrmasDaForma (a forma do lote atualiza as condições que já a usam)', () => {
  const cond = { id: 'c1', external_id: 'PZ1', inativo: false, forma_external_id: 'FP1', forma_codigo: 'BOLETO', forma_nome: 'Boleto', forma_tpag: '15', prazos_dias: [28], prazo_medio_dias: 28, parcelas_cartao: null };
  const estado = (comSavepoint: () => Promise<unknown>) => ({ gravar: true, r: { carga: { condicoesDaForma: async () => [cond], comSavepoint }, condicoesPagamento: {} } }) as never;
  const forma = { chave: 'FP1', external_id: 'FP1', codigo: 'BOLETO', nome: 'Boleto novo', tpag: '15', linha: 2, condicoes: [] };

  it('aplica no SAVEPOINT e marca aplicada', async () => {
    const o = await aplicarIrmasDaForma(forma, estado(async () => undefined));
    expect(o).toMatchObject({ aplicada: true, erros: [] });
  });
  it('erro do banco na aplicação vira erro da linha da forma (CARGA_BANCO), sem nada aplicado', async () => {
    const o = await aplicarIrmasDaForma(forma, estado(async () => { throw new Error('falha'); }));
    expect(o.aplicada).toBe(false);
    expect(o.erros).toEqual([expect.objectContaining({ linha: 2, codigo: 'CARGA_BANCO' })]);
  });
});
