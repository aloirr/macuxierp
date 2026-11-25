/**
 * T-0017: o lado ERP da volta, montado com o código do `main` como o `apps/worker` vai ligá-lo (T-0013 §5 e §6; a ligação
 * no worker ainda não existe, pendência na docs/testes/T-0017.md):
 *  - busca: `buscarPedidosPendentes` (integracao-fdv/api) com a porta `RecebedorPedidoFdv` real (`criarRecebedorFdv` do
 *    pedido/api, `repositorioSql`, consulta de cadastros `criarConsultaParaPedido` com o `repositoriosSql` do cadastros);
 *  - retorno: o consumidor `integracao-fdv.retorno-pedido` pelo despachante real da outbox (`despacharOutbox` do worker,
 *    `FilaOutboxPg`, `RegistroConsumoPg`) e o envio `enviarRetornosPendentes`;
 *  - Hub: `criarClienteHubPedidos` (cliente HTTP do SDK);
 *  - chaves do Hub: `criarResolvedorChaveErp` do `cadastros/api` (ADR 0010, item 2), a mesma porta que o worker vai ligar.
 * Logs e alertas ficam em memória para a varredura de LGPD (por contagem e índice, nunca pelo valor).
 */
import { randomUUID } from 'node:crypto';
import type { Banco, Relogio } from '../../../packages/platform-sdk/src/index';
import { AuditoriaPg, LicencasPg, OutboxPg } from '../../../packages/platform-sdk/src/pg';
import { despacharOutbox } from '../../../apps/worker/src/despachante';
import { FilaOutboxPg, RegistroConsumoPg } from '../../../apps/worker/src/pg';
import { criarConsultaParaPedido, criarResolvedorChaveErp, repositoriosSql } from '../../../modules/cadastros/api/index';
import type { Alertar, LogPedidos } from '../../../modules/integracao-fdv/api/portas';
import { buscarPedidosPendentes, type ResumoBusca } from '../../../modules/integracao-fdv/api/recebimento-pedidos';
import {
  criarConsumidorRetornoPedido,
  enviarRetornosPendentes,
  type ResumoEnvio,
} from '../../../modules/integracao-fdv/api/retorno-pedidos';
import { criarRecebedorFdv, dependenciasDeProducao } from '../../../modules/pedido/api/index';
import { clienteValido, ENDERECO_AM, filialValida, produtoValido } from '../../../modules/cadastros/api/fixtures-teste';
import type { ClienteHubPedidosArnes } from './cliente-hub-pedidos';
import type { PedidoParaErp } from './hub-pedidos';

export interface RegistroLgpd {
  /** Uma linha por chamada de log (objeto + mensagem), em JSON. */
  logs: string[];
  /** `codigo:contexto` de cada alerta do monitor. */
  alertas: string[];
}

type LogWorker = Parameters<typeof despacharOutbox>[0]['log'];

/** Despacha a outbox (todos os tenants) para os consumidores até esvaziar (teto de 10 voltas). */
export async function despacharAteEsvaziar(o: { banco: Banco; relogio: Relogio; consumidores: Parameters<typeof despacharOutbox>[0]['consumidores']; log: LogWorker }): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const r = await despacharOutbox({ banco: o.banco, fila: new FilaOutboxPg(), consumo: new RegistroConsumoPg(), consumidores: o.consumidores, relogio: o.relogio, log: o.log });
    if (r.publicados + r.falhas === 0) return;
  }
}

/** Logs e alertas em memória para a varredura de LGPD (o `pino` é o mesmo registro no formato do logger do worker). */
export function criarRegistroLgpd(): RegistroLgpd & { log: LogPedidos; alertar: Alertar; pino: LogWorker } {
  const r: RegistroLgpd = { logs: [], alertas: [] };
  const linha = (o: Record<string, unknown>, m: string) => void r.logs.push(JSON.stringify([o, m]));
  const log: LogPedidos = { info: linha, warn: linha, error: linha };
  const alertar: Alertar = (_t, codigo, ctx) => void r.alertas.push(`${codigo}:${JSON.stringify(ctx ?? {})}`);
  const pino = {
    info: (o: Record<string, unknown>, m: string) => linha(o, m),
    warn: (o: Record<string, unknown>, m: string) => linha(o, m),
    error: (o: Record<string, unknown>, m: string) => linha(o, m),
    child: () => pino,
  };
  return { ...r, log, alertar, pino: pino as unknown as LogWorker };
}

/** Índices das linhas que contêm algum dos valores (o teste compara só os índices: o valor nunca vai à mensagem). */
export function indicesCom(linhas: readonly string[], valores: readonly string[]): number[] {
  return linhas.flatMap((l, i) => (valores.some((v) => l.includes(v)) ? [i] : []));
}

export interface LadoErpPedidos {
  buscar(tenantErp: string, hub: ClienteHubPedidosArnes): Promise<ResumoBusca>;
  /** Despacha a outbox (todos os tenants) para o consumidor do retorno. */
  despachar(): Promise<void>;
  enviar(tenantErp: string, hub: ClienteHubPedidosArnes): Promise<ResumoEnvio>;
  /** Uma volta inteira do worker: busca, despacho e envio. */
  ciclo(tenantErp: string, hub: ClienteHubPedidosArnes): Promise<{ busca: ResumoBusca; envio: ResumoEnvio }>;
  lgpd: RegistroLgpd;
  consumidor: ReturnType<typeof criarConsumidorRetornoPedido>;
}

export function criarLadoErpPedidos(o: { banco: Banco; relogio: Relogio }): LadoErpPedidos {
  const reg = criarRegistroLgpd();
  const pedido = dependenciasDeProducao(criarConsultaParaPedido(repositoriosSql), { log: reg.log });
  const recebedor = criarRecebedorFdv({ ...pedido, licencas: new LicencasPg(), outbox: new OutboxPg(), auditoria: new AuditoriaPg(), relogio: o.relogio });
  // L3 da T-0011: `alertar` opcional (`retorno_sem_chave_produto`); em objeto à parte para tipar também sem o parâmetro.
  const opcoesRetorno = { log: reg.log, relogio: o.relogio, alertar: reg.alertar };
  const consumidor = criarConsumidorRetornoPedido(opcoesRetorno);
  const resolvedor = criarResolvedorChaveErp(repositoriosSql);
  const comum = { banco: o.banco, relogio: o.relogio, log: reg.log, alertar: reg.alertar };
  const lado: LadoErpPedidos = {
    lgpd: reg,
    consumidor,
    buscar: (t, hub) => buscarPedidosPendentes({ ...comum, hub, recebedor, resolvedor }, t),
    despachar: () => despacharAteEsvaziar({ banco: o.banco, relogio: o.relogio, consumidores: [consumidor], log: reg.pino }),
    enviar: (t, hub) => enviarRetornosPendentes({ ...comum, hub }, t),
    async ciclo(t, hub) {
      const busca = await lado.buscar(t, hub);
      await lado.despachar();
      return { busca, envio: await lado.enviar(t, hub) };
    },
  };
  return lado;
}

/** Chaves do kit no Hub (ADR 0010): as do kit são texto; as nascidas no ERP são o UUID do registro. */
export interface KitPedidos {
  cliente: string;
  vendedor: string;
  produto: string;
  prazo: string;
}

/** O que o `semearKitPedidos` usa da API de teste (`montarApiPg`). */
export interface ApiDoKit<K extends string> {
  t: Record<K, string>;
  b: { admin: { query(sql: string, p?: unknown[]): Promise<unknown> } };
  chamar(quem: K, metodo: 'POST', url: string, corpo: object): Promise<{ statusCode: number; body: string; json(): unknown }>;
}

/**
 * Massa mínima para o ERP receber um pedido do kit: filial, condição 30/60, vendedor, cliente e produto com as chaves do
 * kit, pela API (perfil administrador), e o sinal da busca de pedidos. `enderecos`: os do cliente do kit (padrão: só o
 * principal). Devolve também o `post` para a massa a mais de cada teste. Dados fictícios.
 */
export async function semearKitPedidos<K extends string>(
  api: ApiDoKit<K>,
  apelido: K,
  kit: KitPedidos,
  relogio: Relogio,
  o: { enderecos?: readonly object[] } = {},
): Promise<{ filial: string; clienteKit: string; produtoKit: string; post: (url: string, corpo: object) => Promise<string> }> {
  const post = async (url: string, corpo: object): Promise<string> => {
    const r = await api.chamar(apelido, 'POST', url, corpo);
    if (r.statusCode >= 300) throw new Error(`${apelido} ${url}: ${r.statusCode} ${r.body}`);
    return (r.json() as { id: string }).id;
  };
  const filial = await post('/v1/cadastros/filiais', filialValida());
  await post('/v1/cadastros/condicoes-pagamento', { codigo: '30/60', descricao: '30 e 60 dias', forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45, external_id: kit.prazo });
  await post('/v1/cadastros/vendedores', { codigo: 'V1', nome: 'Vendedor Um', filial_id: filial, external_id: kit.vendedor });
  const clienteKit = await post('/v1/cadastros/clientes', clienteValido(filial, { external_id: kit.cliente, enderecos: o.enderecos ?? [{ ...ENDERECO_AM, tipo: 'principal' }] }));
  const produtoKit = await post('/v1/cadastros/produtos', produtoValido({ cest: '0300700', external_id: kit.produto }));
  await api.b.admin.query('INSERT INTO integracao_fdv.sinal (tenant_id, proxima_busca_pedidos_em) VALUES ($1, $2)', [api.t[apelido], relogio.agora()]);
  return { filial, clienteKit, produtoKit, post };
}

/**
 * O `PedidoParaErp` aprovado como o FDV o entrega (cópia do contrato lido pelo ERP, P-1), com as chaves do kit e um
 * `pedido_uuid` novo. `itens` padrão: 3 UN do produto do kit a R$ 2,50; `total_cents` = soma dos itens. Quantidade sempre
 * na unidade base.
 */
export function pedidoFdvDoKit(kit: KitPedidos, filial: string, itens?: PedidoParaErp['itens']): PedidoParaErp {
  const lista: PedidoParaErp['itens'] = itens ?? [{ sequencia: 1, produto_external_id: kit.produto, quantidade: 3, unidade: 'UN', fator: 1, quantidade_venda: 3, preco_unitario_cents: 250, desconto_cents: 0, total_cents: 750 }];
  return {
    versao_contrato: 'v1',
    pedido_uuid: randomUUID(),
    cliente_external_id: kit.cliente,
    vendedor_external_id: kit.vendedor,
    filial: { external_id: filial },
    pagamento: { prazo_external_id: kit.prazo },
    criado_em: '2026-11-21T14:00:00.000Z',
    aprovado_em: '2026-11-21T14:05:00.000Z',
    itens: lista,
    total_cents: lista.reduce((s, i) => s + Number(i.total_cents), 0),
  } as PedidoParaErp;
}
