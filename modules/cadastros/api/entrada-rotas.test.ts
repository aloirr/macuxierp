/**
 * T-0057 C4 (ADR 0014 §3): os handlers da `/entrada/v1` (POST lotes, GET lote, GET cursores, POST sinal), em memória. A autenticação do
 * conector, a licença do módulo e a transação do tenant são do plugin da apps/api (entrada.test.ts); aqui vale o que é do módulo.
 */
import {
  CABECALHO_IDEMPOTENCIA_ENTRADA, CAMINHOS_ENTRADA, ErroApi, PREFIXO_ENTRADA, TRABALHO_ENTRADA_LOTE, type ContextoEntrada, type PedidoTrabalho, type RotaEntrada,
} from '@macuxierp/platform-sdk';
import { CursorEntidade, LoteAceito, LoteResultado, RespostaSinal } from '@macuxierp/platform-sdk/hub-v1';
import { describe, expect, it } from 'vitest';
import { EntradaMemoria } from './entrada-memoria';
import { criarRotasEntrada } from './entrada-rotas';

const TENANT = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const AGORA = new Date('2026-11-26T16:00:00.000Z');
const KEY = 'chave-lote-0001';

const registro = (n: number) => ({ external_id: `V${n}`, alterado_em: '2026-11-26T10:00:00.000Z', ativo: true, nome: `Vendedor ${n}` });
const corpoLote = (extra: Record<string, unknown> = {}) => ({
  versao_contrato: 'v1', entidade: 'vendedor', modo: 'delta', enviado_em: '2026-11-26T15:59:00.000Z', cursor: null, registros: [registro(1), registro(2)],
  linhas_invalidas: [], linhas_invalidas_omitidas: 0, ...extra,
});

function montar(conector = 'conector-1') {
  const entrada = new EntradaMemoria();
  const rotas = criarRotasEntrada({ entrada: () => entrada });
  const trabalhos: PedidoTrabalho[] = [];
  const contexto = (c = conector): ContextoEntrada => ({
    conector: { tenant_id: TENANT, credencial_id: 'cred-1', conector_id: c },
    tx: { consultar: async () => [] }, request_id: 'req-1', agora: AGORA,
    enfileirar: async (p) => { trabalhos.push({ ...p, tenant_id: TENANT }); return { id: `t${trabalhos.length}` }; },
  });
  /** Como a apps/api: valida corpo e consulta pelo schema da rota e chama o `executar`. */
  const chamar = async (metodo: 'GET' | 'POST', caminho: string, o: { corpo?: unknown; consulta?: unknown; params?: Record<string, string>; chave?: string | null; conector?: string } = {}) => {
    const rota = rotas.find((r) => r.metodo === metodo && r.caminho === caminho) as RotaEntrada;
    expect(rota).toBeDefined();
    const corpo = rota.corpo ? rota.corpo.parse(o.corpo) : undefined;
    const consulta = rota.consulta ? rota.consulta.parse(o.consulta ?? {}) : undefined;
    const cabecalhos: Record<string, string> = o.chave === null ? {} : { [CABECALHO_IDEMPOTENCIA_ENTRADA]: o.chave ?? KEY };
    return rota.executar(contexto(o.conector), { corpo, consulta, params: o.params ?? {}, cabecalhos, arquivos: {}, todosArquivos: {} });
  };
  const erro = async (p: Promise<unknown>) => p.then(() => { throw new Error('devia recusar'); }, (e: unknown) => e as ErroApi);
  return { entrada, rotas, trabalhos, chamar, erro };
}

describe('T-0057 C4: rotas da /entrada/v1', () => {
  it('declara exatamente as 4 rotas do contrato do SDK', () => {
    const t = montar();
    expect(t.rotas.map((r) => `${r.metodo} ${r.caminho}`).sort()).toEqual([
      `GET ${CAMINHOS_ENTRADA.cursor}`, `GET ${CAMINHOS_ENTRADA.lote}`, `POST ${CAMINHOS_ENTRADA.lotes}`, `POST ${CAMINHOS_ENTRADA.sinal}`,
    ]);
  });

  describe('POST /lotes', () => {
    it('ADR 0014 §3: 202 com status "recebido" (nunca estado), recebidos e o caminho da consulta, e enfileira o trabalho do módulo', async () => {
      const t = montar();
      const r = await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote({ linhas_invalidas: [{ external_id: 'V9', codigo: 'formato_invalido', mensagem: 'x' }], linhas_invalidas_omitidas: 3 }) });
      expect(r.status).toBe(202);
      const aceito = LoteAceito.parse(r.corpo);
      expect(aceito).toMatchObject({ status: 'recebido', entidade: 'vendedor', modo: 'delta', recebidos: 6, consulta: `${PREFIXO_ENTRADA}/lotes/${aceito.lote_id}` });
      expect(r.corpo).not.toHaveProperty('estado');
      expect(t.trabalhos).toEqual([{ tipo: TRABALHO_ENTRADA_LOTE, tenant_id: TENANT, payload: { lote_id: aceito.lote_id }, external_id: aceito.lote_id }]);
      expect(t.entrada.lotes[0]).toMatchObject({ estado: 'recebido', conector_id: 'conector-1', idempotency_key: KEY, credencial_id: 'cred-1' });
    });

    it('idempotência: a mesma Idempotency-Key com o mesmo corpo devolve o mesmo lote (repetido) sem novo trabalho, mesmo com as chaves em outra ordem', async () => {
      const t = montar();
      const a = LoteAceito.parse((await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote() })).corpo);
      const reordenado = { registros: [registro(1), registro(2)], modo: 'delta', cursor: null, entidade: 'vendedor', enviado_em: '2026-11-26T15:59:00.000Z', versao_contrato: 'v1', linhas_invalidas_omitidas: 0, linhas_invalidas: [] };
      const r = await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: reordenado });
      expect(r.status).toBe(202);
      expect(LoteAceito.parse(r.corpo)).toMatchObject({ lote_id: a.lote_id, repetido: true });
      expect(t.trabalhos).toHaveLength(1);
      expect(t.entrada.lotes).toHaveLength(1);
    });

    it('idempotência: a mesma Idempotency-Key com outro corpo dá 409 CONFLITO e nada novo', async () => {
      const t = montar();
      await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote() });
      const e = await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote({ registros: [registro(3)] }) }));
      expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO' });
      expect(t.entrada.lotes).toHaveLength(1);
      expect(t.trabalhos).toHaveLength(1);
    });

    it('a mesma chave de outro conector é outro lote', async () => {
      const t = montar();
      await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote() });
      await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote(), conector: 'conector-2' });
      expect(t.entrada.lotes.map((l) => l.conector_id)).toEqual(['conector-1', 'conector-2']);
    });

    it('sem Idempotency-Key ou com chave fora do padrão: 400 VALIDACAO', async () => {
      const t = montar();
      expect(await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote(), chave: null }))).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
      expect(await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote(), chave: 'curta' }))).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
    });

    it('RN-INT-06: carga completa responde 422 CARGA_COMPLETA_NAO_SUPORTADA, sem lote nem trabalho', async () => {
      const t = montar();
      const e = await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote({ modo: 'completo', sessao: { id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2d', parte: 1, ultimo: true } }) }));
      expect(e).toMatchObject({ status: 422, codigo: 'CARGA_COMPLETA_NAO_SUPORTADA', message: 'Carga completa não aceita: envie só as alterações (delta)' });
      expect(t.entrada.lotes).toHaveLength(0);
      expect(t.trabalhos).toHaveLength(0);
    });

    it('ADR 0014 §2: entidade fora da fase responde 422 ENTIDADE_FORA_DA_FASE, sem lote', async () => {
      const t = montar();
      const e = await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote({ entidade: 'titulo' }) }));
      expect(e).toMatchObject({ status: 422, codigo: 'ENTIDADE_FORA_DA_FASE' });
      expect(t.entrada.lotes).toHaveLength(0);
    });

    it('lote sem nenhum registro nem linha inválida: 400 (recebidos sempre >= 1)', async () => {
      const t = montar();
      expect(await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote({ registros: [] }) }))).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
      expect(t.entrada.lotes).toHaveLength(0);
    });

    it('corpo fora do contrato do Hub é recusado pelo schema da rota (a API responde 400)', async () => {
      const t = montar();
      await expect(t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: { ...corpoLote(), versao_contrato: 'v2' } })).rejects.toThrow();
    });
  });

  describe('GET /lotes/:id', () => {
    it('devolve o LoteResultado com status; o lote na fila vem sem cursor e sem conclusão', async () => {
      const t = montar();
      const { lote_id } = LoteAceito.parse((await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote() })).corpo);
      const r = await t.chamar('GET', CAMINHOS_ENTRADA.lote, { params: { id: lote_id } });
      expect(r.status ?? 200).toBe(200);
      expect(LoteResultado.parse(r.corpo)).toMatchObject({ lote_id, status: 'recebido', cursor: null, concluido_em: null, erros: [] });
      expect(r.corpo).not.toHaveProperty('estado');
    });

    it('depois do processamento traz os erros por linha (sem o dado) e o cursor; limite_erros corta a lista', async () => {
      const t = montar();
      const { lote_id } = LoteAceito.parse((await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote() })).corpo);
      const l = t.entrada.lotes[0]!;
      Object.assign(l, {
        estado: 'concluido_com_erros', corpo: null, concluido_em: AGORA, com_erro: 2, cursor: { alterado_em: '2026-11-26T10:00:00.000Z', external_id: 'V1' },
        contagens: { recebidas: 2, novas: 0, erros_total: 2 },
        erros: [{ indice: 0, external_id: 'V1', campo: 'nome', codigo: 'campo_obrigatorio' }, { indice: 1, external_id: 'V2', campo: null, codigo: 'falha_processamento' }],
      });
      const r = LoteResultado.parse((await t.chamar('GET', CAMINHOS_ENTRADA.lote, { params: { id: lote_id }, consulta: { limite_erros: '1' } })).corpo);
      expect(r).toMatchObject({ status: 'concluido_com_erros', erros_total: 2, erros_omitidos: 1, cursor: { external_id: 'V1' } });
      expect(r.erros).toHaveLength(1);
      expect(r.erros[0]).toMatchObject({ codigo: 'campo_obrigatorio', reprocessavel: false });
    });

    it('lote inexistente, de outro conector ou id fora do formato: 404', async () => {
      const t = montar();
      const { lote_id } = LoteAceito.parse((await t.chamar('POST', CAMINHOS_ENTRADA.lotes, { corpo: corpoLote() })).corpo);
      expect(await t.erro(t.chamar('GET', CAMINHOS_ENTRADA.lote, { params: { id: '1f2e3d4c-5b6a-4789-8a9b-0c1d2e3f4a5b' } }))).toMatchObject({ status: 404 });
      expect(await t.erro(t.chamar('GET', CAMINHOS_ENTRADA.lote, { params: { id: lote_id }, conector: 'conector-2' }))).toMatchObject({ status: 404 });
      expect(await t.erro(t.chamar('GET', CAMINHOS_ENTRADA.lote, { params: { id: 'nao-e-uuid' } }))).toMatchObject({ status: 404 });
    });
  });

  describe('GET /cursores/:entidade', () => {
    it('sem lote concluído o cursor é nulo; depois traz alterado_em e external_id do último aplicado', async () => {
      const t = montar();
      const vazio = CursorEntidade.parse((await t.chamar('GET', CAMINHOS_ENTRADA.cursor, { params: { entidade: 'vendedor' } })).corpo);
      expect(vazio).toEqual({ entidade: 'vendedor', cursor: null, atualizado_em: null });
      await t.entrada.avancarCursor('conector-1', 'vendedor', { alterado_em: '2026-11-26T10:00:00.000Z', external_id: 'V2' }, 'lote-1');
      const r = CursorEntidade.parse((await t.chamar('GET', CAMINHOS_ENTRADA.cursor, { params: { entidade: 'vendedor' } })).corpo);
      expect(r).toMatchObject({ entidade: 'vendedor', cursor: { alterado_em: '2026-11-26T10:00:00.000Z', external_id: 'V2' } });
      expect(r.atualizado_em).not.toBeNull();
    });

    it('o cursor é do conector: outro conector não vê o de quem chamou', async () => {
      const t = montar();
      await t.entrada.avancarCursor('conector-1', 'vendedor', { alterado_em: '2026-11-26T10:00:00.000Z', external_id: 'V2' }, 'lote-1');
      const r = CursorEntidade.parse((await t.chamar('GET', CAMINHOS_ENTRADA.cursor, { params: { entidade: 'vendedor' }, conector: 'conector-2' })).corpo);
      expect(r.cursor).toBeNull();
    });

    it('entidade fora da F2: 404', async () => {
      const t = montar();
      expect(await t.erro(t.chamar('GET', CAMINHOS_ENTRADA.cursor, { params: { entidade: 'titulo' } }))).toMatchObject({ status: 404 });
    });
  });

  describe('POST /sinal', () => {
    const sinal = (extra: Record<string, unknown> = {}) => ({
      versao_contrato: 'v1', conector_id: 'conector-1', versao_conector: '1.5.0', em: '2026-11-26T15:58:00.000Z', fila: [], entidades: [], ...extra,
    });

    it('grava o último sinal e a versão e responde RespostaSinal (sem restrição de versão)', async () => {
      const t = montar();
      const r = await t.chamar('POST', CAMINHOS_ENTRADA.sinal, { corpo: sinal({ parado_por_versao: true }) });
      expect(r.status ?? 200).toBe(200);
      expect(RespostaSinal.parse(r.corpo)).toMatchObject({ conector_id: 'conector-1', recebido_em: AGORA.toISOString() });
      expect(t.entrada.sinais.get('conector-1')).toMatchObject({ versao_conector: '1.5.0', parado_por_versao: true, em: AGORA });
    });

    it('o conector_id do corpo tem de ser o da credencial: outro dá 400', async () => {
      const t = montar();
      expect(await t.erro(t.chamar('POST', CAMINHOS_ENTRADA.sinal, { corpo: sinal({ conector_id: 'conector-9' }) }))).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
      expect(t.entrada.sinais.size).toBe(0);
    });
  });
});
