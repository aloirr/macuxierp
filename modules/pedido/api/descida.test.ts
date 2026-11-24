import type { FonteLicencas, Licenca } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { criarConsumidorDescida } from './consumidor-descida';
import { criarServicoDescida } from './descida';
import { FilaDescidaMemoria } from './descida-memoria';
import { IDS, pedidoFdv, pedidoManual, prepararCadastros } from './fixtures-teste';
import { dependenciasEmMemoria, TENANT_MEMORIA } from './memoria';
import { criarRecebedorFdv } from './recebedor';
import type { Efeitos } from './servico';
import { criarServico } from './servico';

const tx = { consultar: async () => [] };
const AGORA = new Date('2026-11-24T14:00:00Z');
const RETORNO_EM = '2026-11-24T15:00:00.000Z';
// Entrada do Hub (texto) e a referência gravada (inteiros).
const NOTA = { numero: '1234', serie: '1', emitida_em: '2026-11-24T13:30:00.000Z', total_centavos: 2000 };
const NOTA_2 = { numero: '1240', serie: '1', emitida_em: '2026-11-24T13:45:00.000Z', total_centavos: 3500 };
const REF = { numero: 1234, serie: 1, emitida_em: '2026-11-24T13:30:00.000Z', total_centavos: 2000 };
const REF_2 = { numero: 1240, serie: 1, emitida_em: '2026-11-24T13:45:00.000Z', total_centavos: 3500 };

function montar(o: { faturamento?: boolean; pedido?: boolean } = {}) {
  const m = dependenciasEmMemoria();
  prepararCadastros(m.cadastros);
  const outbox = new OutboxMemoria();
  const auditoria = new AuditoriaMemoria();
  const relogio = new RelogioFixo(AGORA);
  const licencas: FonteLicencas = {
    async ler(): Promise<Licenca[]> {
      return [
        ...(o.pedido === false ? [] : [{ modulo: 'pedido' as const, ativo: true, valido_ate: null }]),
        ...(o.faturamento ? [{ modulo: 'faturamento' as const, ativo: true, valido_ate: null }] : []),
      ];
    },
  };
  const recebedor = criarRecebedorFdv({ ...m.deps, licencas, outbox, auditoria, relogio });
  const fila = new FilaDescidaMemoria((id) => m.armazem.pedidos.find((p) => p.id === id)?.status);
  const d = { ...m.deps, fila: () => fila, licencas };
  const servico = criarServicoDescida(d);
  const fx: Efeitos = {
    tenant_id: TENANT_MEMORIA, ator: { tipo: 'sistema' }, agora: AGORA,
    publicar: async (e) => (outbox.eventos[outbox.eventos.push({ ...e, id: `ev-${outbox.eventos.length}` } as never) - 1] as { id: string }).id,
    auditar: async (r) => { auditoria.registros.push(r as never); },
  };
  return { ...m, outbox, auditoria, relogio, recebedor, fila, servico, fx, d };
}

async function pedidoAprovadoNaFila(t: ReturnType<typeof montar>) {
  const r = await t.recebedor.receber(tx, pedidoFdv());
  if (r.resultado !== 'criado') throw new Error('esperava criado');
  await t.servico.enfileirar(tx, t.fx, r.pedido_id);
  return r.pedido_id;
}

describe('fila de descida (ADR 0014 §13)', () => {
  it('RN-PED-01: todo pedido aprovado entra na fila uma vez, com o faturamento ligado ou desligado', async () => {
    for (const faturamento of [true, false]) {
      const t = montar({ faturamento });
      const id = await pedidoAprovadoNaFila(t);
      expect(await t.servico.enfileirar(tx, t.fx, id)).toBe(false);
      expect(t.fila.linhas).toHaveLength(1);
      expect(t.fila.linhas[0]).toMatchObject({ pedido_id: id, pedido_uuid: IDS.pedidoFdv, descido_em: null });
    }
  });
  it('RN-PED-01: o pedido manual aprovado desce com o próprio id como pedido_uuid', async () => {
    const t = montar();
    const servico = criarServico(t.deps);
    const ator = { tipo: 'usuario' as const, id: '22222222-2222-4222-8222-222222222222', perfil: 'administrador' as const };
    const manual = await servico.lancar(tx, { ...t.fx, ator }, pedidoManual());
    expect(manual.pedido.status).toBe('aprovado');
    await t.servico.enfileirar(tx, t.fx, manual.pedido.id);
    expect(t.fila.linhas[0]?.pedido_uuid).toBe(manual.pedido.id);
  });
  it('RN-PED-01: pendentes entrega o pedido no formato do contrato, e depois de marcado descido não volta', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    const [item, ...resto] = await t.servico.pendentes(tx, t.fx);
    expect(resto).toEqual([]);
    expect(item).toMatchObject({ pedido_id: id, pedido_uuid: IDS.pedidoFdv, origem: 'fdv', numero: 1 });
    expect(item?.pedido.itens).toHaveLength(1);
    expect(await t.servico.marcarDescido(tx, t.fx, IDS.pedidoFdv)).toEqual({ resultado: 'marcado', pedido_id: id });
    expect(await t.servico.marcarDescido(tx, t.fx, IDS.pedidoFdv.toUpperCase())).toEqual({ resultado: 'repetido', pedido_id: id });
    expect(await t.servico.pendentes(tx, t.fx)).toEqual([]);
    expect(t.fila.linhas[0]?.descido_em).toBe(AGORA.toISOString());
  });
  it('RN-PED-02: pedido cancelado antes de o Conector buscar sai das pendentes', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    (t.armazem.pedidos[0] as { status: string }).status = 'cancelado';
    expect(await t.servico.pendentes(tx, t.fx)).toEqual([]);
  });
  it('RN-CORE-02: sem a licença do módulo pedido, pendentes, marcarDescido e retorno dão 403 MODULO_INATIVO', async () => {
    const t = montar({ pedido: false });
    await expect(t.servico.pendentes(tx, t.fx)).rejects.toMatchObject({ status: 403, codigo: 'MODULO_INATIVO' });
    await expect(t.servico.marcarDescido(tx, t.fx, IDS.pedidoFdv)).rejects.toMatchObject({ status: 403 });
    await expect(t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'cancelado', ocorrido_em: RETORNO_EM })).rejects.toMatchObject({ status: 403 });
  });
  it('RN-PED-01: pedido_uuid desconhecido é 404', async () => {
    const t = montar();
    await expect(t.servico.marcarDescido(tx, t.fx, IDS.desconhecido)).rejects.toMatchObject({ status: 404 });
  });
  it('RN-PED-01: o consumidor de aprovado@1 enfileira e a reentrega do evento não duplica', async () => {
    const t = montar();
    const r = await t.recebedor.receber(tx, pedidoFdv());
    const consumidor = criarConsumidorDescida({ ...t.d, relogio: t.relogio });
    const evento = { id: 'e', nome: 'pedido.pedido.aprovado@1', tenant_id: TENANT_MEMORIA, agregado_id: (r as { pedido_id: string }).pedido_id, versao: 1, ocorrido_em: AGORA.toISOString(), ator: 'sistema' as const, request_id: 'r', payload: {} };
    await consumidor.tratar(evento, tx);
    await consumidor.tratar(evento, tx);
    expect(consumidor.eventos).toEqual(['pedido.pedido.aprovado@1']);
    expect(t.fila.linhas).toHaveLength(1);
  });
});

describe('referência da nota do cliente no pedido (T-0057)', () => {
  const retorno = (status: 'faturado_parcial' | 'faturado_total' | 'cancelado', nota?: typeof NOTA) => ({ pedido_uuid: IDS.pedidoFdv, status, ...(nota ? { nota } : {}), ocorrido_em: RETORNO_EM });
  it('RN-PED-02: faturado_total grava a referência, e o evento faturado_cliente@1 leva a mesma nota', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA));
    expect(t.fila.notas.get(id)).toEqual(REF);
    expect(t.outbox.eventos.at(-1)?.payload).toMatchObject({ nota_cliente: NOTA });
  });
  it('RN-PED-02: parcial com a nota A, parcial com a B troca a referência e PUBLICA faturado_cliente@1 (parcial → parcial) com histórico e auditoria; depois total com a C', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_parcial', NOTA));
    const eventos = t.outbox.eventos.length;
    const historico = t.armazem.eventos.length;
    const auditorias = t.auditoria.registros.length;
    expect(await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_parcial', NOTA_2))).toEqual({ resultado: 'aplicado', pedido_id: id, status: 'faturado_parcial' });
    expect(t.fila.notas.get(id)).toEqual(REF_2);
    expect(t.outbox.eventos).toHaveLength(eventos + 1);
    expect(t.outbox.eventos.at(-1)).toMatchObject({ nome: 'pedido.pedido.faturado_cliente@1', payload: { status: 'faturado_parcial', status_anterior: 'faturado_parcial', nota_cliente: NOTA_2 } });
    expect(t.armazem.eventos).toHaveLength(historico + 1);
    expect(t.armazem.eventos.at(-1)).toMatchObject({ de: 'faturado_parcial', para: 'faturado_parcial' });
    expect(t.auditoria.registros).toHaveLength(auditorias + 1);
    // o retorno repetido não gera evento
    expect((await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_parcial', NOTA_2))).resultado).toBe('repetido');
    expect(t.outbox.eventos).toHaveLength(eventos + 1);
    const C = { ...NOTA, numero: '1300' };
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', C));
    expect(t.fila.notas.get(id)).toEqual({ ...REF, numero: 1300 });
  });
  it('RN-PED-02: a chave de 44 dígitos vai só no evento; a referência gravada não a tem', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    const c43 = '1326111234567800019555001000001234100000001';
    let soma = 0;
    let peso = 2;
    for (let i = 42; i >= 0; i--) { soma += Number(c43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const chave = `${c43}${soma % 11 < 2 ? 0 : 11 - (soma % 11)}`;
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', { ...NOTA, chave } as typeof NOTA));
    expect(t.outbox.eventos.at(-1)?.payload).toMatchObject({ nota_cliente: { ...NOTA, chave } });
    expect(t.fila.notas.get(id)).toEqual(REF);
  });
  it('RN-PED-02: nota inválida (data no futuro, número com zero à esquerda) é 422 e não grava', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    await expect(t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', { ...NOTA, emitida_em: '2026-11-24T14:06:00.000Z' }))).rejects.toMatchObject({ status: 422, detalhes: { codigo: 'nota_cliente_invalida', campo: 'emitida_em' } });
    await expect(t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', { ...NOTA, numero: '0012' }))).rejects.toMatchObject({ status: 422 });
    expect(t.fila.notas.has(id)).toBe(false);
  });
  it('RN-PED-02: faturado_parcial obsoleto (depois de faturado), mesmo com nota diferente, responde obsoleto e não grava nem publica', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA));
    const eventos = t.outbox.eventos.length;
    expect(await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_parcial', NOTA_2))).toEqual({ resultado: 'obsoleto', pedido_id: id, status: 'faturado' });
    expect(t.fila.notas.get(id)).toEqual(REF);
    expect(t.outbox.eventos).toHaveLength(eventos);
  });
  it('RN-PED-02: a mesma nota repetida responde repetido e não grava de novo', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA));
    expect((await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA))).resultado).toBe('repetido');
  });
  it('RN-PED-02: nota diferente sem avanço de status é 409 CONFLITO com detalhes.codigo nota_cliente_divergente, e a referência fica', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA));
    await expect(t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA_2))).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO', detalhes: { codigo: 'nota_cliente_divergente' } });
    expect(t.fila.notas.get(id)).toEqual(REF);
  });
  it('RN-PED-02: cancelado não mexe na referência de um parcial', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_parcial', NOTA));
    await t.servico.aplicarRetorno(tx, t.fx, retorno('cancelado', NOTA_2));
    expect(t.fila.notas.get(id)).toEqual(REF);
  });
  it('RN-CORE-02: com o faturamento ligado nenhuma referência do cliente é gravada', async () => {
    const t = montar({ faturamento: true });
    await pedidoAprovadoNaFila(t);
    await expect(t.servico.aplicarRetorno(tx, t.fx, retorno('faturado_total', NOTA))).rejects.toMatchObject({ status: 422 });
    expect(t.fila.notas.size).toBe(0);
  });
});

describe('retorno do cliente, modo ponte (ADR 0014 §15)', () => {
  it('RN-PED-02: faturado_total com o faturamento desligado leva a faturado, publica faturado_cliente@1 com a nota opaca e grava o histórico', async () => {
    const t = montar();
    const id = await pedidoAprovadoNaFila(t);
    t.outbox.eventos.length = 0;
    const r = await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', nota: NOTA, ocorrido_em: RETORNO_EM });
    expect(r).toEqual({ resultado: 'aplicado', pedido_id: id, status: 'faturado' });
    expect(t.outbox.eventos.map((e) => e.nome)).toEqual(['pedido.pedido.faturado_cliente@1']);
    expect(t.outbox.eventos[0]?.payload).toMatchObject({ status: 'faturado', status_anterior: 'aprovado', nota_cliente: NOTA, pedido_uuid: IDS.pedidoFdv });
    expect(t.armazem.eventos.at(-1)).toMatchObject({ de: 'aprovado', para: 'faturado', ator_tipo: 'sistema', motivo_codigo: null });
  });
  it('RN-PED-02: retorno repetido responde repetido, sem evento novo nem histórico novo', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', ocorrido_em: RETORNO_EM });
    const eventos = t.outbox.eventos.length;
    const historico = t.armazem.eventos.length;
    const r = await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', ocorrido_em: RETORNO_EM });
    expect(r.resultado).toBe('repetido');
    expect(t.outbox.eventos).toHaveLength(eventos);
    expect(t.armazem.eventos).toHaveLength(historico);
  });
  it('RN-PED-02: faturado_parcial depois de faturado é obsoleto (200, sem mudança)', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', ocorrido_em: RETORNO_EM });
    const r = await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_parcial', ocorrido_em: RETORNO_EM });
    expect(r).toMatchObject({ resultado: 'obsoleto', status: 'faturado' });
  });
  it('RN-PED-02: faturado_parcial e depois faturado_total passam pelo faturado_parcial', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    expect((await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_parcial', ocorrido_em: RETORNO_EM })).status).toBe('faturado_parcial');
    expect((await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', ocorrido_em: RETORNO_EM })).status).toBe('faturado');
    expect(t.armazem.eventos.slice(-2).map((e) => [e.de, e.para])).toEqual([['aprovado', 'faturado_parcial'], ['faturado_parcial', 'faturado']]);
  });
  it('RN-CORE-02 e RN-PED-02: com o faturamento ligado o faturado_* do cliente é recusado em 422 e nada muda', async () => {
    const t = montar({ faturamento: true });
    await pedidoAprovadoNaFila(t);
    await expect(t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', ocorrido_em: RETORNO_EM })).rejects.toMatchObject({ status: 422, detalhes: { codigo: 'faturamento_ligado' } });
    expect(t.armazem.pedidos[0]?.status).toBe('aprovado');
  });
  it('RN-PED-02: cancelado do cliente cancela o pedido e publica cancelado@1 com motivo "outro" e o texto do cliente', async () => {
    const t = montar({ faturamento: true });
    await pedidoAprovadoNaFila(t);
    t.outbox.eventos.length = 0;
    const r = await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'cancelado', motivo: 'Cliente desistiu', ocorrido_em: RETORNO_EM });
    expect(r.status).toBe('cancelado');
    expect(t.outbox.eventos.map((e) => [e.nome, (e.payload as { motivo_codigo?: string; motivo_texto?: string }).motivo_codigo, (e.payload as { motivo_texto?: string }).motivo_texto])).toEqual([['pedido.pedido.cancelado@1', 'outro', 'Cliente desistiu']]);
    expect((await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'cancelado', ocorrido_em: RETORNO_EM })).resultado).toBe('repetido');
  });
  it('RN-PED-02: cancelado de pedido já faturado é 422 com a lista de possíveis', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'faturado_total', ocorrido_em: RETORNO_EM });
    await expect(t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'cancelado', ocorrido_em: RETORNO_EM })).rejects.toMatchObject({ status: 422, detalhes: { possiveis: [] } });
  });
  it('regra 8: o log não leva documento, nome nem texto do motivo', async () => {
    const t = montar();
    await pedidoAprovadoNaFila(t);
    await t.servico.aplicarRetorno(tx, t.fx, { pedido_uuid: IDS.pedidoFdv, status: 'cancelado', motivo: 'Joao desistiu', ocorrido_em: RETORNO_EM });
    const texto = t.log.linhas.join('\n');
    expect(texto).not.toMatch(/Joao|Maria|52998224725/);
  });
});
