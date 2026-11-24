/**
 * T-0017 (F3): a volta de ponta a ponta — pedido aprovado no FDV → `GET /pedidos/pendentes` → o ERP cria o
 * `pedido.pedido` como `aprovado` (decisão do Alexandre de 21/11/2026, 23h10 de Manaus) → retorno ao Hub → o Hub registra.
 * Plano, matriz, achados e como rodar: docs/testes/T-0017.md.
 *
 * O lado ERP é o código do `main` (apoio/erp-pedidos.ts): API de produção com o plugin do pedido (cancelamento pela rota),
 * busca e retorno do `integracao-fdv`, porta real do pedido, despachante real da outbox, PostgreSQL com RLS (papéis
 * `macuxierp_app` e `macuxierp_worker`). O Hub é o dublê da T-0012 com as rotas da volta (apoio/hub-pedidos.ts), porque o
 * pedido de teste só nasce no FDV por um vendedor: a rodada real está PENDENTE (doc). No alvo real:
 *  - perfil tenant-teste: só `pedido-fila-real` (a fila do Hub responde e cada pedido passa no contrato lido pelo ERP);
 *  - perfil thathyany-seguro: recusado pelo `exigirCenario` (`config.test.ts`).
 * Trava de escrita (recado R-20261122-020834-gerente-projetos, 22/11/2026 02h08 de Manaus): o `GET /pedidos/pendentes`
 * marca o pedido como enviado, então até o `pedido-fila-real` é recusado no real sem `MACUXI_HUB_LIBERA_ESCRITA=1`
 * ou com a chave do Conector macuxierp (`apoio/trava-escrita.ts`, `trava-escrita.test.ts`).
 * Sem Postgres, a parte de banco pula (`bash db/scripts/pg-local.sh`).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarEvento, type PluginModulo } from '../../packages/platform-sdk/src/index';
import { envelopeDaLinha, OutboxPg, SELECT_EVENTO, type BancoPg, type LinhaEvento } from '../../packages/platform-sdk/src/pg';
import { PG_DISPONIVEL, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';
import { JWT_SEGREDO_DE_TESTE } from '../../apps/api/src/apoio-teste';
import { montarDependenciasProducao, registrarModulos } from '../../apps/api/src/modulos';
import { clienteValido, CNPJ_B, ENDERECO_AM, filialValida, produtoValido } from '../../modules/cadastros/api/fixtures-teste';
import { criarConsultaParaPedido, repositoriosSql } from '../../modules/cadastros/api/index';
import { PedidoParaErpLido, RetornoErp } from '../../modules/integracao-fdv/contracts/index';
import { criarPluginPedido, dependenciasDeProducao } from '../../modules/pedido/api/index';
import { montarApiPg } from '../apoio/api-pg';
import { prepararAlvo, type Alvo } from './apoio/alvo';
import { criarClienteHubPedidos, type ClienteHubPedidosArnes } from './apoio/cliente-hub-pedidos';
import { CredencialHub, exigirCenario, lerConfigHub, type NomeCenario } from './apoio/config';
import type { DubleHub } from './apoio/duble-hub';
import { criarLadoErpPedidos, indicesCom, type LadoErpPedidos } from './apoio/erp-pedidos';
import {
  aprovarNoFdv,
  pedidoNoHub,
  perderRespostaDoRetorno,
  PRAZO_REENTREGA_MS,
  removerNoFdv,
  rotasPedidosDuble,
  semRecebePedidos,
  type PedidoParaErp,
} from './apoio/hub-pedidos';
import type { RelogioDeTeste } from './apoio/relogio';

const config = lerConfigHub();
const DUBLE = config.alvo === 'duble';
const exigir = (n: NomeCenario) => exigirCenario(config, n);
/** Uma linha do tempo só: o relógio de teste do dublê vale na API (tokens e outbox), no worker do arnês e no Hub. */
const INICIO = new Date('2026-11-22T13:00:00.000Z');

// ---------------------------------------------------------------- massa (fictícia; os dados pessoais servem à varredura)

const OBSERVACAO = 'Entregar ao seu Joao Ferreira no portao azul';
const RAZAO_PF = 'Maria da Silva Exemplo';
const CPF_PF = '52998224725';
const CPF_REENTREGA = '11144477735';
const RAZAO_REENTREGA = 'Josefa Reentrega Pereira';
const ENTREGA_ERP = { ...ENDERECO_AM, logradouro: 'Rua do Deposito Central', numero: '5', bairro: 'Centro', cep: '69005000', tipo: 'entrega' };
const EDITADO = { logradouro: 'Rua Editada no Tablet', numero: '77', complemento: 'Fundos', bairro: 'Aleixo', cidade: 'Manaus', uf: 'AM', cep: '69060000' };
const SENSIVEIS = [OBSERVACAO, RAZAO_PF, CPF_PF, CPF_REENTREGA, RAZAO_REENTREGA, CNPJ_B, 'Cliente Exemplo Ltda', EDITADO.logradouro, ENTREGA_ERP.logradouro];
/** Chaves do kit (ADR 0010): as do kit são texto; as nascidas no ERP são o UUID do registro. */
const KIT = { cliente: 'C000123', vendedor: 'V01', produto: 'P001', prazo: 'PZ-3060' };

type Apelido = 'A' | 'B' | 'S';
interface Massa {
  filial: string;
  clienteKit: string;
  clienteErp: string;
  clienteReentrega: string;
  produtoKit: string;
  produtoErp: string;
  enderecoEntrega: string;
}

/** O `PedidoParaErp` como o FDV o entrega (cópia do contrato lido pelo ERP, P-1). Quantidade sempre na unidade base. */
function pedidoFdv(m: Massa, o: Record<string, unknown> = {}): PedidoParaErp {
  return {
    versao_contrato: 'v1',
    pedido_uuid: randomUUID(),
    cliente_external_id: KIT.cliente,
    vendedor_external_id: KIT.vendedor,
    filial: { external_id: m.filial },
    pagamento: { prazo_external_id: KIT.prazo },
    criado_em: '2026-11-21T14:00:00.000Z',
    aprovado_em: '2026-11-21T14:05:00.000Z',
    observacao: OBSERVACAO,
    itens: [
      // 2 caixas de 12: quantidade 24 na unidade base; unidade, fator e quantidade_venda só indicam a embalagem
      { sequencia: 1, produto_external_id: KIT.produto, quantidade: 24, unidade: 'CX', fator: 12, quantidade_venda: 2, preco_unitario_cents: 500, desconto_cents: 0, total_cents: 12_000 },
      { sequencia: 2, produto_external_id: m.produtoErp, quantidade: 3, unidade: 'UN', fator: 1, quantidade_venda: 3, preco_unitario_cents: 250, total_cents: 750 },
    ],
    total_cents: 12_750,
    ...o,
  } as PedidoParaErp;
}

// ---------------------------------------------------------------- alvo real ------------------------------------------

describe.runIf(config.alvo === 'real' && config.perfil === 'tenant-teste')('T-0017 — tenant-teste real: a fila de pedidos', () => {
  it('pedido-fila-real: GET /pedidos/pendentes responde 200 e cada pedido passa no PedidoParaErpLido', async () => {
    exigir('pedido-fila-real');
    if (config.alvo !== 'real') return;
    const hub = criarClienteHubPedidos({ url: config.url, credencial: config.credencial, versaoErp: config.versaoErp });
    const r = await hub.pendentes(1);
    expect(r.status).toBe(200);
    expect((r.pedidos ?? []).map((p) => PedidoParaErpLido.safeParse(p).success)).not.toContain(false);
  });
});

// ---------------------------------------------------------------- dublê + PostgreSQL ---------------------------------

describe.runIf(DUBLE && PG_DISPONIVEL)('T-0017 — volta FDV → ERP → Hub (dublê do Hub, PostgreSQL real)', () => {
  let alvo: Alvo;
  let duble: DubleHub;
  let relogio: RelogioDeTeste;
  let api: Awaited<ReturnType<typeof montarApiPg<Apelido>>>;
  let worker: BancoPg;
  let lado: LadoErpPedidos;
  const T = {} as Record<Apelido, string>;
  const FDV = {} as Record<Apelido, string>;
  const hub = {} as Record<Apelido, ClienteHubPedidosArnes>;
  const massa = {} as Record<Apelido, Massa>;
  const adm = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await api.b.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any

  const COM_PEDIDO = ['cadastros', 'pedido', 'integracao-fdv'];
  /** Os módulos de produção do main, com o plugin do pedido no lugar do manifesto (o `montarModulos` ainda não o monta). */
  const modulosComPedido = (b: BancoEfemero): readonly PluginModulo[] => {
    const producao = montarDependenciasProducao({ banco: b.banco('macuxierp_app'), chaveA1: randomBytes(32), config: { versao: 't0017', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null } });
    const pedido = criarPluginPedido(dependenciasDeProducao(criarConsultaParaPedido(repositoriosSql)));
    return registrarModulos(producao.modulos.map((m) => (m.manifesto.id === 'pedido' ? pedido : m)));
  };

  async function semear(k: Apelido): Promise<Massa> {
    const post = async (url: string, corpo: object): Promise<string> => {
      const r = await api.chamar(k, 'POST', url, corpo);
      expect(r.statusCode, `${k} ${url}: ${r.statusCode}`).toBeLessThan(300);
      return (r.json() as { id: string }).id;
    };
    const filial = await post('/v1/cadastros/filiais', filialValida());
    await post('/v1/cadastros/condicoes-pagamento', { codigo: '30/60', descricao: '30 e 60 dias', forma_tpag: '15', prazos_dias: [30, 60], external_id: KIT.prazo });
    await post('/v1/cadastros/vendedores', { codigo: 'V1', nome: 'Vendedor Um', filial_id: filial, external_id: KIT.vendedor });
    const clienteKit = await post('/v1/cadastros/clientes', clienteValido(filial, { external_id: KIT.cliente, enderecos: [{ ...ENDERECO_AM, tipo: 'principal' }, ENTREGA_ERP] }));
    const pf = { tipo_pessoa: 'PF', ie: null, ind_ie_dest: '9' };
    const clienteErp = await post('/v1/cadastros/clientes', clienteValido(filial, { ...pf, documento: CPF_PF, razao_social: RAZAO_PF }));
    const clienteReentrega = await post('/v1/cadastros/clientes', clienteValido(filial, { ...pf, documento: CPF_REENTREGA, razao_social: RAZAO_REENTREGA, external_id: 'C000777' }));
    const produtoKit = await post('/v1/cadastros/produtos', produtoValido({ cest: '0300700', external_id: KIT.produto }));
    const produtoErp = await post('/v1/cadastros/produtos', produtoValido({ codigo: 'P002', descricao: 'Agua mineral 500ml', cest: '0300700' }));
    const [e] = await adm(`SELECT id FROM cadastros.cliente_endereco WHERE tenant_id = $1 AND cliente_id = $2 AND tipo = 'entrega'`, [T[k], clienteKit]);
    await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proxima_busca_pedidos_em) VALUES ($1, $2)', [T[k], relogio.agora()]);
    return { filial, clienteKit, clienteErp, clienteReentrega, produtoKit, produtoErp, enderecoEntrega: e!.id as string };
  }

  const pedidoErp = async (k: Apelido, uuid: string) => {
    const [linha] = await adm('SELECT * FROM pedido.pedido WHERE tenant_id = $1 AND external_id = $2', [T[k], uuid]);
    if (!linha) throw new Error(`pedido do FDV ausente no tenant ${k}`);
    return linha;
  };
  const contarPedidos = async (k: Apelido, uuid: string) =>
    Number((await adm('SELECT count(*) AS n FROM pedido.pedido WHERE tenant_id = $1 AND external_id = $2', [T[k], uuid]))[0]!.n);
  const recebido = async (k: Apelido, uuid: string) =>
    (await adm('SELECT estado, erro_codigo, tentativas, pedido_id FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [T[k], uuid]))[0] ?? null;
  const retornos = async (k: Apelido, uuid: string) =>
    adm(
      `SELECT status, estado, numero_erp, corpo, tentativas, resposta_http, itens_descartados FROM integracao_fdv.retorno_enviado
        WHERE tenant_id = $1 AND pedido_uuid = $2 ORDER BY created_at, id`,
      [T[k], uuid],
    );
  const sinal = async (k: Apelido) => (await adm('SELECT proxima_busca_pedidos_em, proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [T[k]]))[0]!;
  const noHub = (k: Apelido, uuid: string) => pedidoNoHub(duble, FDV[k], uuid)!;
  const statusNoHub = (k: Apelido, uuid: string) => noHub(k, uuid).retornos.map((r) => r.status);
  const eventosDoPedido = async (k: Apelido) =>
    Number((await adm(`SELECT count(*) AS n FROM plataforma.evento WHERE tenant_id = $1 AND nome LIKE 'pedido.pedido.%'`, [T[k]]))[0]!.n);
  const aprovar = (k: Apelido, p: PedidoParaErp) => aprovarNoFdv(duble, FDV[k], p);

  beforeAll(async () => {
    alvo = await prepararAlvo(config, {
      inicioDuble: INICIO,
      duble: { rotasExtras: rotasPedidosDuble(), taxa: { geral: { balde: 10_000, porMinuto: 10_000 } } },
    });
    duble = alvo.duble!;
    relogio = alvo.relogioDeTeste!;
    api = await montarApiPg<Apelido>({ A: COM_PEDIDO, B: COM_PEDIDO, S: ['cadastros', 'integracao-fdv'] }, { modulos: modulosComPedido, relogio });
    worker = api.b.banco('macuxierp_worker', 4);
    lado = criarLadoErpPedidos({ banco: worker, relogio });
    Object.assign(T, api.t);
    FDV.A = alvo.tenant;
    hub.A = criarClienteHubPedidos({ url: alvo.url, credencial: alvo.credencial, versaoErp: config.versaoErp });
    for (const k of ['B', 'S'] as const) {
      FDV[k] = `fdv-${k.toLowerCase()}-duble`;
      const c = duble.registrarConector({ tenant: FDV[k], conectorId: `macuxierp-${k.toLowerCase()}` });
      hub[k] = criarClienteHubPedidos({ url: alvo.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: config.versaoErp });
    }
    for (const k of ['A', 'B', 'S'] as const) massa[k] = await semear(k);
  });
  afterAll(async () => {
    await api?.fechar();
    await alvo?.encerrar();
  });

  it('pedido-caminho-feliz: aprovado no FDV → pendentes → pedido.pedido aprovado (external_id = pedido_uuid) → integrado com numero_erp → o Hub registra', async () => {
    exigir('pedido-caminho-feliz');
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    const { busca, envio } = await lado.ciclo(T.A, hub.A);
    expect(busca).toMatchObject({ buscados: 1, entregues: 1, rejeitados: 0, repetidos: 0, pendentes: 0 });
    expect(envio).toMatchObject({ enviados: 1, falhou: 0, reagendados: 0 });
    expect(envio).not.toHaveProperty('motivoPausa'); // RD-0482: sem pausa, o campo opcional fica ausente

    const ped = await pedidoErp('A', p.pedido_uuid);
    expect(ped).toMatchObject({ origem: 'fdv', status: 'aprovado', external_id: p.pedido_uuid, cliente_id: massa.A.clienteKit, filial_id: massa.A.filial, observacao: OBSERVACAO });
    expect(Number(ped.total_centavos)).toBe(12_750);
    expect(new Date(ped.aprovado_origem_em).toISOString()).toBe('2026-11-21T14:05:00.000Z');
    // sem avaliarPedido e sem análise: pendências vazias (sem linha em `aprovacao`: achado A-03, corrigido pelo lote 2b da T-0015; teste abaixo)
    expect(ped.pendencias).toEqual([]);
    expect((await adm('SELECT nome FROM plataforma.evento WHERE agregado_id = $1 ORDER BY versao', [ped.id])).map((e) => e.nome)).toEqual(['pedido.pedido.recebido@1', 'pedido.pedido.aprovado@1']);
    // quantidade na unidade base (Qtd4); a embalagem só para exibição; chave do kit e UUID do ERP resolvidos (ADR 0010)
    const itens = await adm('SELECT sequencia, produto_id, quantidade, unidade_venda, fator_venda, quantidade_venda, total_centavos FROM pedido.pedido_item WHERE pedido_id = $1 ORDER BY sequencia', [ped.id]);
    expect(itens.map((i) => [i.sequencia, i.produto_id, Number(i.quantidade), i.unidade_venda, Number(i.fator_venda), Number(i.quantidade_venda), Number(i.total_centavos)])).toEqual([
      [1, massa.A.produtoKit, 240_000, 'CX', 120_000, 20_000, 12_000],
      [2, massa.A.produtoErp, 30_000, 'UN', 10_000, 30_000, 750],
    ]);
    expect(await recebido('A', p.pedido_uuid)).toMatchObject({ estado: 'entregue', pedido_id: ped.id, tentativas: 1 });

    const numero = String(ped.numero);
    expect(await retornos('A', p.pedido_uuid)).toMatchObject([{ status: 'integrado', estado: 'enviado', numero_erp: numero, resposta_http: 200 }]);
    const r = noHub('A', p.pedido_uuid);
    expect(r).toMatchObject({ estado: 'integrado', numeroErp: numero, tentativas: 1 });
    expect(r.respostas).toEqual([{ status: 200, repetido: false, codigo: null }]);
    expect(RetornoErp.safeParse((await retornos('A', p.pedido_uuid))[0]!.corpo).success).toBe(true);
    // com o retorno, o Hub não reentrega
    relogio.avancar(PRAZO_REENTREGA_MS);
    expect((await lado.buscar(T.A, hub.A)).buscados).toBe(0);
  });

  // Achado A-03 (corrigido pelo lote 2b da T-0015): a decisão é a do FDV; o ERP não grava `aprovacao` no pedido do FDV (T-0013 §2, §5.3 item 4 e critério 8).
  it('pedido-caminho-feliz (A-03): o pedido do FDV entra aprovado sem linha em pedido.aprovacao', async () => {
    exigir('pedido-caminho-feliz');
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    expect((await lado.ciclo(T.A, hub.A)).busca).toMatchObject({ entregues: 1 });
    const ped = await pedidoErp('A', p.pedido_uuid);
    expect(ped.status).toBe('aprovado');
    expect(await adm('SELECT automatica FROM pedido.aprovacao WHERE pedido_id = $1', [ped.id])).toEqual([]);
  });

  it('pedido-cancelado: cancelado no ERP depois de integrado → retorno cancelado com motivo; nunca rejeitado_erp depois de integrado', async () => {
    exigir('pedido-cancelado');
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    await lado.ciclo(T.A, hub.A);
    const ped = await pedidoErp('A', p.pedido_uuid);
    // o pedido do FDV não se aprova nem se recusa no ERP (RN-PED-02); cancelar, sim
    expect((await api.chamar('A', 'POST', `/v1/pedido/pedidos/${ped.id}/recusar`, { motivo_codigo: 'preco_divergente' }, 'gerente')).statusCode).toBe(422);
    const c = await api.chamar('A', 'POST', `/v1/pedido/pedidos/${ped.id}/cancelar`, { motivo_codigo: 'solicitacao_cliente' }, 'gerente');
    expect(c.statusCode, String((c.json() as { codigo?: string }).codigo)).toBe(200);
    await lado.despachar();
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 1, falhou: 0 });

    expect((await retornos('A', p.pedido_uuid)).map((x) => `${x.status}:${x.estado}`)).toEqual(['integrado:enviado', 'cancelado:enviado']);
    expect((await retornos('A', p.pedido_uuid))[1]!.corpo).toMatchObject({ status: 'cancelado', motivo: 'Solicitação do cliente', numero_erp: String(ped.numero) });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado', 'cancelado']);
    expect(noHub('A', p.pedido_uuid)).toMatchObject({ estado: 'cancelado', motivo: 'Solicitação do cliente', numeroErp: String(ped.numero) });
    // nem a reentrega do evento de recebimento muda o que foi ao Hub
    const [linha] = await adm(`SELECT ${SELECT_EVENTO} FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'pedido.pedido.recebido@1'`, [ped.id]);
    await worker.comTenant(T.A, (tx) => lado.consumidor.tratar(envelopeDaLinha(linha as LinhaEvento), tx));
    expect((await retornos('A', p.pedido_uuid)).map((x) => x.status)).not.toContain('rejeitado_erp');
    expect(noHub('A', p.pedido_uuid).respostas.map((x) => x.status)).toEqual([200, 200]);
  });

  it('pedido-recebimento-recusado: cliente fora do espelho, contrato inválido e sem condição → rejeitado_erp com motivo, sem pedido criado', async () => {
    exigir('pedido-recebimento-recusado');
    const eventosAntes = await eventosDoPedido('A');
    const fora = pedidoFdv(massa.A, { cliente_external_id: 'C999999' });
    const invalido = { pedido_uuid: randomUUID(), itens: [], total_cents: 'abc', observacao: OBSERVACAO } as unknown as PedidoParaErp;
    const semCondicao = pedidoFdv(massa.A, { pagamento: null });
    for (const p of [fora, invalido, semCondicao]) aprovar('A', p);
    const { busca, envio } = await lado.ciclo(T.A, hub.A);
    expect(busca).toMatchObject({ buscados: 3, entregues: 0, rejeitados: 3 });
    expect(envio).toMatchObject({ enviados: 3, falhou: 0 });
    const casos: [PedidoParaErp, string, RegExp][] = [
      [fora, 'cliente_inexistente', /^Cliente não cadastrado no ERP$/],
      [invalido, 'pedido_fora_do_contrato', /^Pedido fora do contrato: .*itens/],
      [semCondicao, 'condicao_ausente', /^Pedido sem condição de pagamento$/],
    ];
    for (const [p, codigo, motivo] of casos) {
      expect(await contarPedidos('A', p.pedido_uuid), codigo).toBe(0);
      expect(await recebido('A', p.pedido_uuid)).toMatchObject({ estado: 'rejeitado', erro_codigo: codigo, pedido_id: null });
      const [r] = await retornos('A', p.pedido_uuid);
      expect(r).toMatchObject({ status: 'rejeitado_erp', estado: 'enviado', numero_erp: null });
      expect(r!.corpo.motivo).toMatch(motivo);
      expect(r!.corpo.numero_erp).toBeUndefined();
      expect(noHub('A', p.pedido_uuid)).toMatchObject({ estado: 'rejeitado_erp', numeroErp: null });
      expect(noHub('A', p.pedido_uuid).motivo).toMatch(motivo);
    }
    // ao FDV vai só o nome do campo, nunca o valor
    expect(indicesCom([JSON.stringify(casos.map(([p]) => noHub('A', p.pedido_uuid).retornos))], ['abc', OBSERVACAO])).toEqual([]);
    expect(await eventosDoPedido('A')).toBe(eventosAntes);
  });

  it('pedido-reentrega: sem retorno em 10 min (relógio de teste) o Hub reentrega; o ERP não duplica, não rejeita o que já gravou e devolve o retorno', async () => {
    exigir('pedido-reentrega');
    const p = pedidoFdv(massa.A, { cliente_external_id: 'C000777' });
    aprovar('A', p);
    duble.programarFalha({ rota: 'POST /pedidos', status: 503, retryAfter: '900' });
    const primeira = await lado.ciclo(T.A, hub.A);
    expect(primeira.busca.entregues).toBe(1);
    expect(primeira.envio).toMatchObject({ enviados: 0, reagendados: 1 });
    expect(noHub('A', p.pedido_uuid)).toMatchObject({ estado: 'enviado', tentativas: 1 });
    expect(new Date((await sinal('A')).proximo_retorno_em).getTime()).toBe(relogio.agora().getTime() + 900_000);

    // entre as entregas, o cliente é inativado no ERP: o pedido já gravado continua, sem rejeitado_erp
    expect((await api.chamar('A', 'DELETE', `/v1/cadastros/clientes/${massa.A.clienteReentrega}`)).statusCode).toBeLessThan(300);
    relogio.avancar(PRAZO_REENTREGA_MS);
    const segunda = await lado.buscar(T.A, hub.A);
    expect(segunda).toMatchObject({ buscados: 1, repetidos: 1, entregues: 0, rejeitados: 0 });
    expect(noHub('A', p.pedido_uuid)).toMatchObject({ estado: 'enviado', tentativas: 2 });
    expect(await contarPedidos('A', p.pedido_uuid)).toBe(1);
    expect(await recebido('A', p.pedido_uuid)).toMatchObject({ estado: 'entregue', tentativas: 2 });
    // a reentrega puxa o retorno para já (least)
    expect(new Date((await sinal('A')).proximo_retorno_em).getTime()).toBeLessThanOrEqual(relogio.agora().getTime());
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 1 });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado']);
    expect((await retornos('A', p.pedido_uuid)).map((x) => x.status)).toEqual(['integrado']);
    relogio.avancar(PRAZO_REENTREGA_MS);
    expect((await lado.buscar(T.A, hub.A)).buscados).toBe(0);
  });

  it('pedido-retorno-repetido: o Hub aplica e a resposta se perde; o reenvio volta repetido e nada duplica (nem no ERP, nem no Hub)', async () => {
    exigir('pedido-retorno-repetido');
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    perderRespostaDoRetorno(duble, FDV.A, p.pedido_uuid);
    expect((await lado.ciclo(T.A, hub.A)).envio).toMatchObject({ enviados: 0, reagendados: 1 });
    expect(noHub('A', p.pedido_uuid).estado).toBe('integrado');
    relogio.avancar(5_000); // a curva: 5 s, maior que o Retry-After: 1
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 1 });
    expect(noHub('A', p.pedido_uuid).respostas.map((r) => [r.status, r.repetido])).toEqual([[503, null], [200, true]]);
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado']);
    expect(await retornos('A', p.pedido_uuid)).toMatchObject([{ status: 'integrado', estado: 'enviado', tentativas: 2, resposta_http: 200 }]);
    // o mesmo evento outra vez (despacho e consumidor direto, duas vezes): continua um retorno só
    const ped = await pedidoErp('A', p.pedido_uuid);
    const [linha] = await adm(`SELECT ${SELECT_EVENTO} FROM plataforma.evento WHERE agregado_id = $1 AND nome = 'pedido.pedido.recebido@1'`, [ped.id]);
    await lado.despachar();
    for (let i = 0; i < 2; i++) await worker.comTenant(T.A, (tx) => lado.consumidor.tratar(envelopeDaLinha(linha as LinhaEvento), tx));
    expect(await retornos('A', p.pedido_uuid)).toHaveLength(1);
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 0 });
  });

  it('pedido-retencao: 503 e 429 no retorno reagendam (curva e Retry-After); 422 vira falhou com alerta só com o código', async () => {
    exigir('pedido-retencao');
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    duble.programarFalha({ rota: 'POST /pedidos', status: 503, retryAfter: '120' });
    expect((await lado.ciclo(T.A, hub.A)).envio).toMatchObject({ reagendados: 1 });
    expect(await retornos('A', p.pedido_uuid)).toMatchObject([{ estado: 'pendente', tentativas: 1, resposta_http: 503 }]);
    expect(new Date((await sinal('A')).proximo_retorno_em).getTime()).toBe(relogio.agora().getTime() + 120_000);
    relogio.avancar(120_000);
    duble.programarFalha({ rota: 'POST /pedidos', status: 429, retryAfter: '30' });
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ reagendados: 1 });
    expect(await retornos('A', p.pedido_uuid)).toMatchObject([{ estado: 'pendente', tentativas: 2, resposta_http: 429 }]);
    expect(new Date((await sinal('A')).proximo_retorno_em).getTime()).toBe(relogio.agora().getTime() + 30_000);
    relogio.avancar(30_000);
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 1 });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado']);

    const q = pedidoFdv(massa.A);
    aprovar('A', q);
    await lado.buscar(T.A, hub.A);
    await lado.despachar();
    removerNoFdv(duble, FDV.A, q.pedido_uuid);
    const alertasAntes = lado.lgpd.alertas.length;
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ falhou: 1, enviados: 0 });
    expect(await retornos('A', q.pedido_uuid)).toMatchObject([{ status: 'integrado', estado: 'falhou', resposta_http: 422 }]);
    expect(lado.lgpd.alertas.slice(alertasAntes)).toEqual([`retorno_recusado_pelo_hub:${JSON.stringify({ pedido_uuid: q.pedido_uuid, codigo: 'pedido_desconhecido' })}`]);
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 0, falhou: 0 }); // falhou é final: não reenvia
  });

  it('pedido-endereco: sem endereço, endereço do ERP (external_id) e editado no FDV (external_id nulo → os textos)', async () => {
    exigir('pedido-endereco');
    const sem = pedidoFdv(massa.A);
    const doErp = pedidoFdv(massa.A, { endereco_entrega: { origem: 'erp', external_id: massa.A.enderecoEntrega, principal: false, logradouro: ENTREGA_ERP.logradouro, numero: '5', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: ENTREGA_ERP.cep } });
    const editado = pedidoFdv(massa.A, { endereco_entrega: { origem: 'editado', external_id: null, principal: false, ...EDITADO } });
    for (const p of [sem, doErp, editado]) aprovar('A', p);
    expect((await lado.ciclo(T.A, hub.A)).busca).toMatchObject({ entregues: 3 });
    expect((await pedidoErp('A', sem.pedido_uuid)).endereco_entrega).toBeNull();
    expect((await pedidoErp('A', doErp.pedido_uuid)).endereco_entrega.endereco_id).toBe(massa.A.enderecoEntrega);
    const ed = await pedidoErp('A', editado.pedido_uuid);
    expect(ed.endereco_entrega.endereco_id).toBeNull();
    expect(ed.endereco_entrega.retrato).toMatchObject(EDITADO);
    // o detalhe do pedido na API mostra os textos editados, não um endereço do cadastro
    const det = await api.chamar('A', 'GET', `/v1/pedido/pedidos/${ed.id}`);
    expect(det.statusCode).toBe(200);
    expect(det.json().endereco_entrega).toMatchObject({ endereco_id: null, retrato: { logradouro: EDITADO.logradouro, cep: EDITADO.cep } });
    for (const p of [sem, doErp, editado]) expect(noHub('A', p.pedido_uuid).estado).toBe('integrado');
  });

  // Achado A-01 (docs/testes/T-0017.md; corrigido pelo L3 da T-0011): a regra do Hub é o external_id, não a origem; origem ausente vale 'erp'.
  it('pedido-endereco (A-01): origem ausente com external_id preenchido entra, é integrado e usa o endereço do ERP', async () => {
    exigir('pedido-endereco');
    const p = pedidoFdv(massa.A, { endereco_entrega: { external_id: massa.A.enderecoEntrega, principal: false, logradouro: ENTREGA_ERP.logradouro, cidade: 'Manaus', uf: 'AM' } });
    aprovar('A', p);
    expect((await lado.ciclo(T.A, hub.A)).busca).toMatchObject({ entregues: 1 });
    const ped = await pedidoErp('A', p.pedido_uuid);
    expect(ped.status).toBe('aprovado');
    expect(noHub('A', p.pedido_uuid).estado).toBe('integrado');
    expect(ped.endereco_entrega.endereco_id).toBe(massa.A.enderecoEntrega);
  });

  /** O evento entra direto pela outbox; o consumidor real (modules/pedido/api/consumidor-nota.ts) fica para o lote seguinte. */
  const faturar = async (pedidoId: string, payload: Record<string, unknown>) =>
    worker.comTenant(T.A, (tx) =>
      new OutboxPg().gravar(tx, criarEvento({ nome: 'pedido.pedido.faturado@1', tenant_id: T.A, agregado_id: pedidoId, ator: 'sistema', request_id: 't0017', payload }, relogio.agora())),
    );
  const nota = (numero: number, total: number) => ({ numero, serie: 1, chave: `1326111122233300018155001${String(numero).padStart(9, '0')}1000000010`.slice(0, 44), emitida_em: relogio.agora().toISOString(), total_centavos: total });
  /**
   * Põe o produto no espelho do Conector (`registro_publicado`, entidade 'produto', `erp_id` = UUID do produto), como o
   * consumidor de cadastros faria ao publicar: é de lá que o retorno tira a chave do Hub do item faturado (A-02, L3 da T-0011).
   */
  const noEspelho = async (k: Apelido, produtoId: string, chave: string) => {
    const payload = { external_id: chave, ativo: true, sku: `SKU-${chave}`, nome: `Produto ${chave}`, unidade: 'UN' };
    await adm(
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, erp_id, payload, hash, alterado_em, fonte_ocorrido_em, ativo)
       VALUES ($1, 'produto', $2, $3, $4::jsonb, $5, $6, $6, true) ON CONFLICT (tenant_id, entidade, registro_external_id) DO NOTHING`,
      [T[k], chave, produtoId, JSON.stringify(payload), createHash('sha256').update(JSON.stringify(payload)).digest('hex'), relogio.agora()],
    );
  };

  it('pedido-faturado (só a perna do retorno; o faturamento é PENDENTE): faturado_parcial e faturado_total chegam ao Hub; homologação não volta', async () => {
    exigir('pedido-faturado');
    await noEspelho('A', massa.A.produtoErp, massa.A.produtoErp); // nascido no ERP: a chave do Hub é o UUID (ADR 0010)
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    await lado.ciclo(T.A, hub.A);
    const ped = await pedidoErp('A', p.pedido_uuid);
    const base = { pedido_id: ped.id, numero: Number(ped.numero), origem: 'fdv', pedido_uuid: p.pedido_uuid };
    await faturar(ped.id, { ...base, status: 'faturado_parcial', ambiente: 'homologacao', nota: nota(9, 250), itens_faturados: [{ sequencia: 2, produto_id: massa.A.produtoErp, quantidade: 10_000, valor_centavos: 250 }] });
    await lado.despachar();
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 0 });
    await faturar(ped.id, { ...base, status: 'faturado_parcial', ambiente: 'producao', nota: nota(1, 250), itens_faturados: [{ sequencia: 2, produto_id: massa.A.produtoErp, quantidade: 10_000, valor_centavos: 250 }] });
    await faturar(ped.id, { ...base, status: 'faturado', ambiente: 'producao', nota: nota(2, 500), itens_faturados: [{ sequencia: 2, produto_id: massa.A.produtoErp, quantidade: 20_000, valor_centavos: 500 }] });
    await lado.despachar();
    const alertasAntes = lado.lgpd.alertas.length;
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 2, falhou: 0 });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado', 'faturado_parcial', 'faturado_total']);
    expect(noHub('A', p.pedido_uuid).retornos.map((r) => r.nota)).toEqual([null, '1/1', '2/1']);
    expect((await retornos('A', p.pedido_uuid))[1]!.corpo.itens_faturados).toEqual([{ sequencia: 2, produto_external_id: massa.A.produtoErp, quantidade: 1, valor_cents: 250 }]);
    expect(lado.lgpd.alertas.slice(alertasAntes)).toEqual([]);
  });

  // T-0089, D3 do FDV: nota simulada com conta_como_real (RN-FAT-04) volta com a chave de acesso.
  it('pedido-faturado (T-0089, D3): nota simulada com conta_como_real volta faturado_total com a chave de acesso', async () => {
    exigir('pedido-faturado');
    await noEspelho('A', massa.A.produtoErp, massa.A.produtoErp);
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    expect((await lado.ciclo(T.A, hub.A)).busca).toMatchObject({ entregues: 1 });
    const ped = await pedidoErp('A', p.pedido_uuid);
    const numero = Number(ped.numero);
    const notaSimulada = nota(12, 750);
    expect(notaSimulada.chave).toMatch(/^\d{44}$/);
    await faturar(ped.id, { pedido_id: ped.id, numero, origem: 'fdv', pedido_uuid: p.pedido_uuid, status: 'faturado', ambiente: 'homologacao', conta_como_real: true, nota: notaSimulada, itens_faturados: [{ sequencia: 2, produto_id: massa.A.produtoErp, quantidade: 30_000, valor_centavos: 750 }] });
    await lado.despachar();
    const alertasAntes = lado.lgpd.alertas.length;
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 1, falhou: 0 });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado', 'faturado_total']);
    const [, fat] = await retornos('A', p.pedido_uuid);
    expect(fat).toMatchObject({ status: 'faturado_total', estado: 'enviado', numero_erp: String(numero), resposta_http: 200 });
    expect(RetornoErp.safeParse(fat!.corpo).success).toBe(true);
    expect(fat!.corpo.nota).toEqual({ numero: 12, serie: 1, chave: notaSimulada.chave, emitida_em: notaSimulada.emitida_em, total_cents: 750 });
    expect(noHub('A', p.pedido_uuid).retornos.map((r) => [r.status, r.nota, r.chave_acesso])).toEqual([
      ['integrado', null, null],
      ['faturado_total', '12/1', notaSimulada.chave],
    ]);
    expect(lado.lgpd.alertas.slice(alertasAntes)).toEqual([]);
  });

  // Achado A-02 (corrigido pelo L3 da T-0011; regra aceita pelo gerente em 22/11/2026, 01h50 de Manaus): o item faturado
  // volta com a chave do Hub do produto (registro_external_id do espelho pelo erp_id; o kit: `P001`), não com o UUID do ERP.
  it('pedido-faturado (A-02): item faturado de produto com chave do kit volta com a chave do Hub (sem itens_descartados)', async () => {
    exigir('pedido-faturado');
    await noEspelho('A', massa.A.produtoKit, KIT.produto);
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    expect((await lado.ciclo(T.A, hub.A)).busca).toMatchObject({ entregues: 1 });
    const ped = await pedidoErp('A', p.pedido_uuid);
    await faturar(ped.id, { pedido_id: ped.id, numero: Number(ped.numero), origem: 'fdv', pedido_uuid: p.pedido_uuid, status: 'faturado_parcial', ambiente: 'producao', nota: nota(3, 6000), itens_faturados: [{ sequencia: 1, produto_id: massa.A.produtoKit, quantidade: 120_000, valor_centavos: 6000 }] });
    await lado.despachar();
    const alertasAntes = lado.lgpd.alertas.length;
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 1, falhou: 0 });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado', 'faturado_parcial']);
    const [, fat] = await retornos('A', p.pedido_uuid);
    expect(fat!.corpo.itens_faturados).toEqual([{ sequencia: 1, produto_external_id: KIT.produto, quantidade: 12, valor_cents: 6000 }]);
    expect(fat!.itens_descartados).toBeNull();
    expect(lado.lgpd.alertas.slice(alertasAntes)).toEqual([]);
  });

  // Regra do A-02 sem chave: produto fora do espelho aguarda até 24 h do ocorrido_em do faturamento; depois, 'falhou'
  // (itens_descartados, itens_faturados vazio, nada ao Hub) e o alerta `retorno_sem_chave_produto` com o pedido_uuid.
  it('pedido-faturado (A-02, sem chave): produto fora do espelho aguarda até 24 h; passado o prazo, falhou com itens_descartados e alerta', async () => {
    exigir('pedido-faturado');
    const r = await api.chamar('A', 'POST', '/v1/cadastros/produtos', produtoValido({ codigo: 'P003', descricao: 'Suco de caju 1L', cest: '0300700' }));
    expect(r.statusCode).toBeLessThan(300);
    const foraDoEspelho = (r.json() as { id: string }).id;
    const p = pedidoFdv(massa.A);
    aprovar('A', p);
    expect((await lado.ciclo(T.A, hub.A)).busca).toMatchObject({ entregues: 1 });
    const ped = await pedidoErp('A', p.pedido_uuid);
    const ocorrido = relogio.agora().getTime();
    await faturar(ped.id, { pedido_id: ped.id, numero: Number(ped.numero), origem: 'fdv', pedido_uuid: p.pedido_uuid, status: 'faturado_parcial', ambiente: 'producao', nota: nota(4, 250), itens_faturados: [{ sequencia: 2, produto_id: foraDoEspelho, quantidade: 10_000, valor_centavos: 250 }] });
    const alertasAntes = lado.lgpd.alertas.length;
    // antes das 24 h: aguarda (nada vai ao Hub, nada falha)
    await lado.despachar();
    expect(await lado.enviar(T.A, hub.A)).toMatchObject({ enviados: 0, falhou: 0 });
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado']);
    // passadas as 24 h do ocorrido_em do faturamento
    relogio.avancar(ocorrido + 24 * 3_600_000 + 60_000 - relogio.agora().getTime());
    await lado.despachar();
    await lado.enviar(T.A, hub.A);
    const fat = (await retornos('A', p.pedido_uuid)).filter((x) => x.status === 'faturado_parcial');
    expect(fat).toMatchObject([{ estado: 'falhou', itens_descartados: [{ produto_id: foraDoEspelho }] }]);
    expect(fat[0]!.corpo.itens_faturados).toEqual([]);
    expect(statusNoHub('A', p.pedido_uuid)).toEqual(['integrado']);
    expect(lado.lgpd.alertas.slice(alertasAntes)).toContain(`retorno_sem_chave_produto:${JSON.stringify({ pedido_uuid: p.pedido_uuid })}`);
  });

  it('pedido-multi-tenant: o mesmo pedido_uuid em dois tenants vira dois pedidos; o do tenant A não aparece no B (banco, API e fila do Hub)', async () => {
    exigir('pedido-multi-tenant');
    const pa = pedidoFdv(massa.A);
    aprovar('A', pa);
    expect((await lado.buscar(T.B, hub.B)).buscados).toBe(0); // a fila de A não sai para o Conector de B
    await lado.ciclo(T.A, hub.A);
    const pb = pedidoFdv(massa.B, { pedido_uuid: pa.pedido_uuid });
    aprovar('B', pb);
    expect((await lado.ciclo(T.B, hub.B)).busca).toMatchObject({ entregues: 1 });
    const a = await pedidoErp('A', pa.pedido_uuid);
    const b = await pedidoErp('B', pa.pedido_uuid);
    expect(a.id).not.toBe(b.id);
    expect(b).toMatchObject({ tenant_id: T.B, filial_id: massa.B.filial, cliente_id: massa.B.clienteKit });
    for (const papel of [worker, api.b.banco('macuxierp_app')]) {
      expect(await papel.comTenant(T.B, (tx) => tx.consultar('SELECT 1 FROM pedido.pedido WHERE id = $1', [a.id]))).toEqual([]);
      const vistos = await papel.comTenant(T.B, (tx) => tx.consultar<{ tenant_id: string }>('SELECT tenant_id FROM integracao_fdv.retorno_enviado UNION ALL SELECT tenant_id FROM integracao_fdv.pedido_recebido'));
      expect(vistos.every((v) => v.tenant_id === T.B)).toBe(true);
    }
    expect((await api.chamar('B', 'GET', `/v1/pedido/pedidos/${a.id}`)).statusCode).toBe(404);
    expect(noHub('A', pa.pedido_uuid).numeroErp).toBe(String(a.numero));
    expect(noHub('B', pa.pedido_uuid).numeroErp).toBe(String(b.numero));
    expect(Number(b.numero)).toBe(1); // o número começa em 1 em cada tenant
  });

  it('pedido-licenca: sem o módulo pedido a busca desliga sem rejeitar ao FDV e a rota dá 403; Conector sem "recebe pedidos" pausa', async () => {
    exigir('pedido-licenca');
    const p = pedidoFdv(massa.S);
    aprovar('S', p);
    const alertasAntes = lado.lgpd.alertas.length;
    expect(await lado.buscar(T.S, hub.S)).toMatchObject({ proxima: 'desligada', buscados: 1, entregues: 0, rejeitados: 0 });
    expect(await recebido('S', p.pedido_uuid)).toMatchObject({ estado: 'recebido', erro_codigo: null });
    expect(await retornos('S', p.pedido_uuid)).toEqual([]);
    // decisão A4 (T-0011): sem a licença do pedido a busca segue agendada, adiada ~1 h a partir do relógio do arnês
    const proximaBuscaS = (await sinal('S')).proxima_busca_pedidos_em;
    expect(proximaBuscaS).not.toBeNull();
    const adiadaMs = new Date(proximaBuscaS).getTime() - relogio.agora().getTime();
    expect(adiadaMs).toBeGreaterThanOrEqual(55 * 60_000);
    expect(adiadaMs).toBeLessThanOrEqual(65 * 60_000);
    expect(lado.lgpd.alertas.slice(alertasAntes)).toEqual(['recebimento_pedidos_desligado:{}']);
    expect(noHub('S', p.pedido_uuid)).toMatchObject({ estado: 'enviado', retornos: [] });
    const r = await api.chamar('S', 'GET', '/v1/pedido/pedidos');
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'MODULO_INATIVO']);

    // o Conector do ERP sem "recebe pedidos" (a thathyany até a T-0027): 403 do Hub = pausa, nada gravado
    const c = duble.registrarConector({ tenant: 'fdv-seguro-duble', conectorId: 'macuxierp-seguro' });
    semRecebePedidos(duble, 'fdv-seguro-duble', 'macuxierp-seguro');
    aprovarNoFdv(duble, 'fdv-seguro-duble', pedidoFdv(massa.B));
    const seguro = criarClienteHubPedidos({ url: alvo.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: config.versaoErp });
    const antes = Number((await adm('SELECT count(*) AS n FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1', [T.B]))[0]!.n);
    expect(await lado.buscar(T.B, seguro)).toMatchObject({ proxima: 'pausa', buscados: 0 });
    expect(Number((await adm('SELECT count(*) AS n FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1', [T.B]))[0]!.n)).toBe(antes);
  });

  it('pedido-lgpd: nenhum log, alerta, log do dublê ou registro de chamada traz dado pessoal (por índice, nunca pelo valor); só o motivo do catálogo vai ao Hub', () => {
    exigir('pedido-lgpd');
    expect(lado.lgpd.logs.length).toBeGreaterThan(0);
    expect(indicesCom(lado.lgpd.logs, SENSIVEIS)).toEqual([]);
    expect(indicesCom(lado.lgpd.alertas, SENSIVEIS)).toEqual([]);
    expect(indicesCom(duble.log, SENSIVEIS)).toEqual([]);
    for (const k of ['A', 'B', 'S'] as const) expect(indicesCom(hub[k].chamadas.map((x) => JSON.stringify(x)), SENSIVEIS)).toEqual([]);
    // o que o Hub recebeu de volta: status, número, motivo do catálogo e nota; nunca observação, nome ou documento
    const motivos = [...duble.estado(FDV.A).extras.values()].flatMap((f) => [...(f as { pedidos: Map<string, { retornos: { motivo: string | null }[] }> }).pedidos.values()]).flatMap((x) => x.retornos.map((r) => r.motivo ?? ''));
    expect(motivos.length).toBeGreaterThan(0);
    expect(indicesCom(motivos, SENSIVEIS)).toEqual([]);
  });
});
