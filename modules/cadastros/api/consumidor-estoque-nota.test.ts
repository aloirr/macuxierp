import type { EnvelopeEvento, Outbox, Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EVENTOS } from '../contracts';
import { TENANT } from './apoio-teste';
import { criarConsumidorEstoqueNota, EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_CANCELADA } from './consumidor-estoque-nota';
import { filialValida, CNPJ_A } from './fixtures-teste';
import { repositoriosEmMemoria } from './memoria';

const tx: Transacao = { consultar: async () => [] };
const EV1 = '44444444-4444-4444-8444-444444444441';

async function ambiente(saldoInicial = 100_000) {
  const repos = repositoriosEmMemoria();
  const f = await repos.filiais.inserir(filialValida({ cnpj: CNPJ_A }) as never);
  const p = await repos.produtos.inserir({ codigo: 'P1', descricao: 'X', ncm: '22021000', unidade_comercial: 'UN', unidade_tributavel: 'UN', grupo_tributacao: 'B' } as never);
  if (saldoInicial) {
    const s = await repos.estoque.saldoParaAtualizar(f.id, p.id);
    await repos.estoque.gravarMovimento({ filial_id: f.id, produto_id: p.id, tipo: 'entrada', quantidade: saldoInicial, motivo: 'inicial', usuario_id: null }, s + saldoInicial);
  }
  const publicados: EnvelopeEvento[] = [];
  const outbox: Outbox = { gravar: async (_tx, e) => publicados.push(e) };
  const logs: string[] = [];
  const consumidor = criarConsumidorEstoqueNota({ repositorios: () => repos, outbox, registrar: (m) => logs.push(m), agora: () => new Date('2026-11-22T15:00:00Z') });
  const saldo = async () => (await repos.estoque.saldos({ filial_id: f.id, produto_id: p.id }))[0]?.quantidade ?? 0;
  const nota = (o: Record<string, unknown> = {}, qtd = 30_000) => ({
    ambiente: 'producao', nota: { numero: 12, serie: 1, campo_novo: 'x' },
    itens: [{ sequencia: 1, quantidade: qtd, valor_centavos: 100, produto_id: p.id, filial_id: f.id }], ...o,
  });
  const enviar = (payload: unknown, nome = EVENTO_NOTA_AUTORIZADA, id = EV1, tenant = TENANT, notaId = EV1) =>
    consumidor.tratar({ id, nome, tenant_id: tenant, agregado_id: notaId, versao: 1, ocorrido_em: '2026-11-22T15:00:00.000Z', ator: 'sistema', request_id: 'r', payload } as EnvelopeEvento, tx);
  return { logs, repos, publicados, consumidor, saldo, nota, enviar, f, p };
}

describe('consumidor de estoque das notas (RN-CAD-07, T-0021)', () => {
  it('declara os dois eventos que consome', async () => {
    expect((await ambiente()).consumidor.eventos).toEqual([EVENTO_NOTA_AUTORIZADA, EVENTO_NOTA_CANCELADA]);
  });
  it('RN-CAD-07: nota autorizada de produção baixa o estoque e publica cadastros.estoque.alterado@1', async () => {
    const a = await ambiente();
    await a.enviar(a.nota());
    expect(await a.saldo()).toBe(70_000);
    expect(a.publicados).toHaveLength(1);
    expect(a.publicados[0]?.nome).toBe('cadastros.estoque.alterado@1');
    expect(EVENTOS['cadastros.estoque.alterado@1'].parse(a.publicados[0]?.payload)).toMatchObject({ quantidade: 70_000 });
  });
  it('RN-CAD-07: homologação não move o estoque', async () => {
    const a = await ambiente();
    await a.enviar(a.nota({ ambiente: 'homologacao' }));
    expect(await a.saldo()).toBe(100_000);
    expect(a.publicados).toHaveLength(0);
  });
  it('RN-CAD-07: homologação com conta_como_real move o estoque', async () => {
    const a = await ambiente();
    await a.enviar(a.nota({ ambiente: 'homologacao', conta_como_real: true }));
    expect(await a.saldo()).toBe(70_000);
  });
  it('RN-CAD-07: o mesmo evento duas vezes move uma vez só', async () => {
    const a = await ambiente();
    await a.enviar(a.nota());
    await a.enviar(a.nota());
    expect(await a.saldo()).toBe(70_000);
    expect(a.publicados).toHaveLength(1);
  });
  it('RN-CAD-07: a nota cancelada devolve a quantidade', async () => {
    const a = await ambiente();
    await a.enviar(a.nota());
    await a.enviar({ ...a.nota(), protocolo_cancelamento: '1', motivo: 'cancelamento de teste' }, EVENTO_NOTA_CANCELADA, '44444444-4444-4444-8444-444444444442');
    expect(await a.saldo()).toBe(100_000);
  });
  it('RN-CAD-07: o saldo pode ficar negativo (a nota autorizada é fato consumado)', async () => {
    const a = await ambiente(10_000);
    await a.enviar(a.nota({}, 30_000));
    expect(await a.saldo()).toBe(-20_000);
  });
  it('RN-CAD-07: payload inválido ou sem os campos novos é ignorado, sem falhar', async () => {
    const a = await ambiente();
    await a.enviar({ lixo: true });
    await a.enviar({ ambiente: 'producao', nota: { numero: 1, serie: 1 }, itens: [{ sequencia: 1, quantidade: 10_000, valor_centavos: 1 }] });
    expect(await a.saldo()).toBe(100_000);
    expect(a.publicados).toHaveLength(0);
  });
  it('RN-CAD-07: dois eventos com ids diferentes para a mesma nota movem uma vez só', async () => {
    const a = await ambiente();
    await a.enviar(a.nota(), EVENTO_NOTA_AUTORIZADA, EV1);
    await a.enviar(a.nota(), EVENTO_NOTA_AUTORIZADA, '44444444-4444-4444-8444-444444444443');
    expect(await a.saldo()).toBe(70_000);
    expect(a.publicados).toHaveLength(1);
  });
  it('RN-CAD-07: cancelada sem autorizada antes não move', async () => {
    const a = await ambiente();
    await a.enviar(a.nota(), EVENTO_NOTA_CANCELADA);
    expect(await a.saldo()).toBe(100_000);
    expect(a.publicados).toHaveLength(0);
  });
  it('RN-CAD-07: cancelada de outra nota (sem a saída dela) não devolve', async () => {
    const a = await ambiente();
    await a.enviar(a.nota());
    await a.enviar(a.nota(), EVENTO_NOTA_CANCELADA, '44444444-4444-4444-8444-444444444444', TENANT, '44444444-4444-4444-8444-444444444449');
    expect(await a.saldo()).toBe(70_000);
  });
  it('RN-CAD-07: nota com dois itens do mesmo produto gera dois movimentos e o saldo soma os dois', async () => {
    const a = await ambiente();
    const n = a.nota();
    const item = n.itens[0] as Record<string, unknown>;
    await a.enviar({ ...n, itens: [item, { ...item, sequencia: 2, quantidade: 10_000 }] });
    expect(await a.saldo()).toBe(60_000);
    expect(a.publicados).toHaveLength(2);
    await a.enviar({ ...n, itens: [item, { ...item, sequencia: 2, quantidade: 10_000 }] }, EVENTO_NOTA_CANCELADA, '44444444-4444-4444-8444-444444444445');
    expect(await a.saldo()).toBe(100_000);
  });
  it('RN-CAD-07: item de produto ou filial inexistente é ignorado, com log só de ids, sem travar o evento', async () => {
    const a = await ambiente();
    const n = a.nota();
    const item = n.itens[0] as Record<string, unknown>;
    await a.enviar({ ...n, itens: [{ ...item, produto_id: '44444444-4444-4444-8444-4444444444a1' }, { ...item, sequencia: 2, filial_id: '44444444-4444-4444-8444-4444444444a2' }, { ...item, sequencia: 3 }] });
    expect(await a.saldo()).toBe(70_000);
    expect(a.logs).toHaveLength(2);
  });
  it('RN-CAD-07: o movimento leva origem nfe e o id da nota', async () => {
    const a = await ambiente();
    await a.enviar(a.nota());
    const m = (a.repos.estoque as unknown as { movimentos?: { origem_tipo?: string; origem_id?: string }[] }).movimentos;
    expect(m?.at(-1)).toMatchObject({ origem_tipo: 'nfe', origem_id: EV1 });
  });
});
