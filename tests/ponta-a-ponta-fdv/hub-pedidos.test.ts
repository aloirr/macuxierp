/**
 * T-0017: as rotas da volta no dublê do Hub (`apoio/hub-pedidos.ts`, registradas por `rotasExtras`), pelo mesmo cliente
 * HTTP do SDK que o recebimento usa (`apoio/cliente-hub-pedidos.ts`). Sem banco e sem FDV.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RetornoErp } from '../../modules/integracao-fdv/contracts/index';
import { criarClienteHubPedidos } from './apoio/cliente-hub-pedidos';
import { CredencialHub } from './apoio/config';
import { criarDubleHub, type DubleHub } from './apoio/duble-hub';
import {
  aprovarNoFdv,
  perderRespostaDoRetorno,
  pedidoNoHub,
  PRAZO_REENTREGA_MS,
  removerNoFdv,
  rotasPedidosDuble,
  semRecebePedidos,
  TRANSICOES_PEDIDO_ERP,
  type PedidoParaErp,
} from './apoio/hub-pedidos';
import { RelogioDeTeste } from './apoio/relogio';

const T = 'tenant-pedidos';
const OUTRO = 'tenant-outro';
const pedido = (o: Partial<PedidoParaErp> = {}): PedidoParaErp => ({
  pedido_uuid: randomUUID(),
  cliente_external_id: 'C000123',
  vendedor_external_id: 'V01',
  criado_em: '2026-11-21T14:00:00Z',
  aprovado_em: '2026-11-21T14:05:00Z',
  total_cents: 2000,
  itens: [{ sequencia: 1, produto_external_id: 'P001', quantidade: 2, preco_unitario_cents: 1000, total_cents: 2000 }],
  ...o,
});
const ret = (uuid: string, status: RetornoErp['status'], o: Partial<RetornoErp> = {}): RetornoErp => ({
  versao_contrato: 'v1',
  pedido_uuid: uuid,
  status,
  ocorrido_em: '2026-11-21T15:00:00.000Z',
  ...(status === 'integrado' || status === 'cancelado' || status.startsWith('faturado') ? { numero_erp: '7' } : {}),
  ...(status === 'rejeitado_erp' ? { motivo: 'Cliente não cadastrado no ERP' } : {}),
  ...o,
});
// `NotaRetorno` do OpenAPI real do Hub (T-0085): `numero` e `serie` em texto; `chave` o ERP manda, mas o Hub não exige.
const nota = (numero: number) => ({ numero: String(numero), serie: '1', chave: '1'.repeat(44), emitida_em: '2026-11-21T16:00:00Z', total_cents: 1000 });

describe('T-0017 — dublê do Hub: pedidos pendentes e retorno', () => {
  let relogio: RelogioDeTeste;
  let duble: DubleHub;
  let erp: ReturnType<typeof criarClienteHubPedidos>;

  beforeEach(async () => {
    relogio = new RelogioDeTeste(new Date('2026-11-21T15:00:00Z'));
    duble = await criarDubleHub({ relogio, rotasExtras: rotasPedidosDuble() });
    const c = duble.registrarConector({ tenant: T, conectorId: 'macuxierp-t0017' });
    erp = criarClienteHubPedidos({ url: duble.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: 'dev' });
  });
  afterEach(() => duble.fechar());

  it('sem rotasExtras as rotas da volta seguem 501 (contrato da T-0012); com elas, a fila vazia é 200 com lista vazia', async () => {
    const sem = await criarDubleHub({ relogio });
    const c = sem.registrarConector({ tenant: T, conectorId: 'macuxierp-sem' });
    const cli = criarClienteHubPedidos({ url: sem.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: 'dev' });
    expect((await cli.pendentes(50)).status).toBe(501);
    await sem.fechar();
    expect(await erp.pendentes(50)).toEqual({ status: 200, pedidos: [] });
  });

  it('pendentes marca como enviado (tentativa 1); sem retorno em 10 min o pedido volta e sai com a tentativa 2; com retorno, não volta', async () => {
    const a = pedido();
    const b = pedido();
    aprovarNoFdv(duble, T, a);
    aprovarNoFdv(duble, T, b);
    const r1 = await erp.pendentes(50);
    expect(r1.pedidos?.map((p) => (p as { tentativa: number }).tentativa)).toEqual([1, 1]);
    expect((await erp.pendentes(50)).pedidos).toEqual([]);
    expect((await erp.enviarRetorno(a.pedido_uuid, ret(a.pedido_uuid, 'integrado'))).status).toBe(200);
    relogio.avancar(PRAZO_REENTREGA_MS - 1);
    expect((await erp.pendentes(50)).pedidos).toEqual([]);
    relogio.avancar(1);
    const r2 = await erp.pendentes(50);
    expect(r2.pedidos).toEqual([{ ...b, tentativa: 2 }]);
    expect(pedidoNoHub(duble, T, a.pedido_uuid)?.estado).toBe('integrado');
  });

  it('o limite corta a lista e vale de 1 a 50 (fora disso, 422)', async () => {
    for (let i = 0; i < 3; i++) aprovarNoFdv(duble, T, pedido());
    expect((await erp.pendentes(2)).pedidos).toHaveLength(2);
    expect((await erp.pendentes(51)).status).toBe(422);
    expect((await erp.pendentes(0)).status).toBe(422);
    expect((await erp.pendentes(50)).pedidos).toHaveLength(1);
  });

  it('Conector sem "recebe pedidos" recebe 403 acesso_negado (o retorno pausa o conector do ERP)', async () => {
    semRecebePedidos(duble, T, 'macuxierp-t0017');
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    expect(await erp.pendentes(50)).toEqual({ status: 403 });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)).toMatchObject({ estado: 'pendente', tentativas: 0 });
  });

  it('retorno: desconhecido e ainda não entregue dão 422; corpo inválido (sem numero_erp, sem motivo, uuid ou status fora) dá 400 requisicao_invalida', async () => {
    const p = pedido();
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 422, codigo: 'pedido_desconhecido' });
    aprovarNoFdv(duble, T, p);
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 422, codigo: 'pedido_nao_entregue' });
    await erp.pendentes(50);
    const semNumero = ret(p.pedido_uuid, 'integrado');
    delete semNumero.numero_erp;
    expect(await erp.enviarRetorno(p.pedido_uuid, semNumero)).toEqual({ status: 400, codigo: 'requisicao_invalida' });
    const semMotivo = ret(p.pedido_uuid, 'rejeitado_erp');
    delete semMotivo.motivo;
    expect(await erp.enviarRetorno(p.pedido_uuid, semMotivo)).toEqual({ status: 400, codigo: 'requisicao_invalida' });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(randomUUID(), 'integrado'))).toEqual({ status: 400, codigo: 'requisicao_invalida' });
    const semNota = ret(p.pedido_uuid, 'faturado_total');
    expect(await erp.enviarRetorno(p.pedido_uuid, semNota)).toEqual({ status: 400, codigo: 'requisicao_invalida' });
    const statusFora = { ...ret(p.pedido_uuid, 'integrado'), status: 'aprovado' } as unknown as RetornoErp;
    expect(await erp.enviarRetorno(p.pedido_uuid, statusFora)).toEqual({ status: 400, codigo: 'requisicao_invalida' });
    // a versão do contrato segue 422 (premissa a conferir na rodada real)
    const versao = { ...ret(p.pedido_uuid, 'integrado'), versao_contrato: 'v2' } as unknown as RetornoErp;
    expect(await erp.enviarRetorno(p.pedido_uuid, versao)).toEqual({ status: 422, codigo: 'versao_nao_suportada' });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.estado).toBe('enviado');
  });

  it('TRANSICOES_PEDIDO_ERP: integrado → rejeitado_erp é 422 transicao_invalida; integrado → cancelado vale; cancelado é final', async () => {
    expect(TRANSICOES_PEDIDO_ERP.integrado).not.toContain('rejeitado_erp');
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 200, repetido: false });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'rejeitado_erp'))).toEqual({ status: 422, codigo: 'transicao_invalida' });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'cancelado', { motivo: 'Solicitação do cliente' }))).toEqual({ status: 200, repetido: false });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'faturado_total', { nota: nota(1) }))).toEqual({ status: 422, codigo: 'transicao_invalida' });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)).toMatchObject({ estado: 'cancelado', motivo: 'Solicitação do cliente', numeroErp: '7' });
  });

  it('integrado → cancelado → integrado é 422 transicao_invalida: o repetido compara com o estado atual, como o FDV', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 200, repetido: false });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'cancelado', { motivo: 'Solicitação do cliente' }))).toEqual({ status: 200, repetido: false });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 422, codigo: 'transicao_invalida' });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.retornos.map((r) => r.status)).toEqual(['integrado', 'cancelado']);
  });

  it('idempotente: o mesmo status devolve repetido sem mudar nada; o número do ERP não muda (422 numero_erp_divergente)', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'));
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado', { ocorrido_em: '2026-11-21T15:09:00.000Z' }))).toEqual({ status: 200, repetido: true });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'cancelado', { numero_erp: '8' }))).toEqual({ status: 422, codigo: 'numero_erp_divergente' });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.retornos.map((r) => r.status)).toEqual(['integrado']);
  });

  it('confirmação depois do prazo vale (o pedido já voltou a pendente, mas tinha sido entregue)', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    relogio.avancar(PRAZO_REENTREGA_MS);
    await erp.pendentes(1); // devolve a pendente e entrega de novo (tentativa 2)
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.tentativas).toBe(2);
    expect((await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).status).toBe(200);
  });

  it('resposta perdida: o Hub aplica e responde 503 com Retry-After; o mesmo retorno de novo é repetido', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    perderRespostaDoRetorno(duble, T, p.pedido_uuid);
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 503, codigo: 'servico_indisponivel', retryAfterS: 1 });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.estado).toBe('integrado');
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 200, repetido: true });
  });

  it('faturado: duas notas parciais são dois retornos, a mesma nota é repetida; item com produto divergente vai em itens_descartados', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'));
    const itens = (produto: string) => [{ sequencia: 1, produto_external_id: produto, quantidade: 1, valor_cents: 1000 }];
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'faturado_parcial', { nota: nota(1), itens_faturados: itens('P001') }))).toEqual({ status: 200, repetido: false });
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'faturado_parcial', { nota: nota(1), itens_faturados: itens('P001') }))).toEqual({ status: 200, repetido: true });
    const r = await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'faturado_parcial', { nota: nota(2), itens_faturados: itens('outra-chave') }));
    expect(r).toMatchObject({ status: 200, repetido: false, itens_descartados: [{ indice: 0, sequencia: 1, codigo: 'produto_divergente' }] });
    expect((await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'faturado_total', { nota: nota(3) }))).status).toBe(200);
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.retornos.map((x) => `${x.status}:${x.nota ?? '-'}`)).toEqual([
      'integrado:-', 'faturado_parcial:1/1', 'faturado_parcial:2/1', 'faturado_total:3/1',
    ]);
  });

  it('NotaRetorno (OpenAPI real, T-0085): numero e serie inteiros = 400 requisicao_invalida; sem chave e com serie nula vale', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    await erp.pendentes(50);
    await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'));
    const comNota = (n: Record<string, unknown>) => ret(p.pedido_uuid, 'faturado_parcial', { nota: n as RetornoErp['nota'] });
    expect(await erp.enviarRetorno(p.pedido_uuid, comNota({ ...nota(1), numero: 1 }))).toMatchObject({ status: 400, codigo: 'requisicao_invalida' });
    expect(await erp.enviarRetorno(p.pedido_uuid, comNota({ ...nota(1), serie: 1 }))).toMatchObject({ status: 400, codigo: 'requisicao_invalida' });
    expect(await erp.enviarRetorno(p.pedido_uuid, comNota({ ...nota(1), numero: '' }))).toMatchObject({ status: 400, codigo: 'requisicao_invalida' });
    expect(await erp.enviarRetorno(p.pedido_uuid, comNota({ ...nota(1), serie: '12345678901' }))).toMatchObject({ status: 400, codigo: 'requisicao_invalida' });
    const { chave: _chave, ...semChave } = nota(4);
    expect(await erp.enviarRetorno(p.pedido_uuid, comNota({ ...semChave, serie: null }))).toEqual({ status: 200, repetido: false });
    expect(pedidoNoHub(duble, T, p.pedido_uuid)?.retornos.at(-1)).toMatchObject({ status: 'faturado_parcial', nota: '4/-', chave_acesso: null });
  });

  it('pedido removido no FDV: o retorno seguinte é 422 pedido_desconhecido; a fila de um tenant não aparece no outro', async () => {
    const p = pedido();
    aprovarNoFdv(duble, T, p);
    const c = duble.registrarConector({ tenant: OUTRO, conectorId: 'macuxierp-outro' });
    const outro = criarClienteHubPedidos({ url: duble.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: 'dev' });
    expect((await outro.pendentes(50)).pedidos).toEqual([]);
    await erp.pendentes(50);
    expect(await outro.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 422, codigo: 'pedido_desconhecido' });
    removerNoFdv(duble, T, p.pedido_uuid);
    expect(await erp.enviarRetorno(p.pedido_uuid, ret(p.pedido_uuid, 'integrado'))).toEqual({ status: 422, codigo: 'pedido_desconhecido' });
    // o log do dublê e o do arnês não guardam corpo: só método, caminho e status
    expect(duble.log.every((l) => !l.includes('C000123') && !l.includes('{'))).toBe(true);
    expect(erp.chamadas.every((x) => !x.rota.includes(p.pedido_uuid))).toBe(true);
  });
});
