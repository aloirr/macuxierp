/**
 * Recebimento e retorno dos pedidos do FDV no worker (T-0016; T-0013 §5 e §6; recados R-20261121-231157,
 * R-20261121-234202 e R-20261121-235111). O worker só liga as portas; a regra mora nos módulos:
 * - **recebedor** (`criarRecebedorFdv` do `pedido/api`): as dependências de produção do pedido sobre a
 *   `criarConsultaParaPedido` do cadastros, com a licença, a outbox e a auditoria em PostgreSQL, na transação do tenant
 *   que o `integracao-fdv` abre para gravar o `pedido_recebido`;
 * - **alerta do monitor** (`Alertar` do `integracao-fdv`): sem tabela própria na v1, vai ao log do worker como `warn`
 *   com `alerta`, `tenant_id` e `modulo`; do contexto só passam chave e valor com cara de código ou id (LGPD);
 * - **resolvedor de chaves** (`ResolvedorChaveErp`, ADR 0010, item 2): `criarResolvedorChaveErp(repositoriosSql)` do
 *   `cadastros/api` (#115), ligado no `main.ts`; o tipo vem do mesmo subcaminho público.
 *
 * Desligamento (até a virada, T-0027): `MACUXIERP_FDV_RECEBIMENTO` = `ligado` | `desligado` (padrão `desligado`; outro
 * valor derruba a partida). Desligado, nada sai para `GET /pedidos/pendentes` nem para `POST /pedidos/{uuid}/retorno`.
 * Ligar hoje também derruba a partida: faltam as agendas do `integracao-fdv` (busca e retorno; o módulo ainda não exporta o
 * `./api` com elas, o consumidor `integracao-fdv.retorno-pedido` e o `ClienteHubPedidos` sobre o cliente do Hub).
 */
import { criarConsultaParaPedido, repositoriosSql, type ResolvedorChaveErp } from '@macuxierp/cadastros/api';
import { criarRecebedorFdv, dependenciasDeProducao, type LogPedido, type RecebedorPedidoFdv } from '@macuxierp/pedido/api';
import type { DestinoAuditoria, FonteLicencas, Outbox, Relogio } from '@macuxierp/platform-sdk';
import { AuditoriaPg, LicencasPg, OutboxPg } from '@macuxierp/platform-sdk/pg';

export type EstadoRecebimentoFdv = 'ligado' | 'desligado';

/** `MACUXIERP_FDV_RECEBIMENTO`: ausente ou vazio = `desligado`. Valor fora da lista derruba a partida (cita só o nome). */
export function configurarRecebimentoFdv(env: Readonly<Record<string, string | undefined>>): EstadoRecebimentoFdv {
  const v = env.MACUXIERP_FDV_RECEBIMENTO?.trim().toLowerCase();
  if (!v || v === 'desligado') return 'desligado';
  if (v === 'ligado') return 'ligado';
  throw new Error('configuração inválida: MACUXIERP_FDV_RECEBIMENTO (ligado ou desligado)');
}

export interface DependenciasRecebedorWorker {
  relogio: Relogio;
  log: LogPedido;
  /** Padrão: `plataforma.tenant_modulo` (PG). */
  licencas?: FonteLicencas;
  /** Padrão: `plataforma.evento` (PG), na transação do chamador. */
  outbox?: Outbox;
  /** Padrão: `plataforma.auditoria` (PG), na transação do chamador. */
  auditoria?: DestinoAuditoria;
}

/** Porta `RecebedorPedidoFdv` com os adaptadores de produção (R-20261121-234202). */
export function montarRecebedorPedidoFdv(d: DependenciasRecebedorWorker): RecebedorPedidoFdv {
  return criarRecebedorFdv({
    ...dependenciasDeProducao(criarConsultaParaPedido(repositoriosSql), { log: d.log }),
    licencas: d.licencas ?? new LicencasPg(),
    outbox: d.outbox ?? new OutboxPg(),
    auditoria: d.auditoria ?? new AuditoriaPg(),
    relogio: d.relogio,
  });
}

/** Log mínimo do alerta (o pino satisfaz). */
export interface LogAlerta {
  warn(dados: Record<string, unknown>, mensagem: string): void;
}

const CHAVE_SEGURA = /^[a-z][a-z0-9_]{0,39}$/;
/** Código, uuid ou número: nada de espaço, `@` ou texto livre (nome, documento, motivo). */
const VALOR_SEGURO = /^[A-Za-z0-9_.:-]{1,100}$/;
const CHAVES_RESERVADAS = new Set(['alerta', 'tenant_id', 'modulo', 'msg', 'level', 'time']);

/**
 * `Alertar` do `integracao-fdv` ligado ao monitor (log do worker). `codigo` e o contexto já vêm do módulo só com código e
 * ids; aqui é a defesa: chave fora de `[a-z0-9_]`, chave reservada ou valor com cara de texto livre é descartado.
 */
export function criarAlertaMonitor(log: LogAlerta): (tenantId: string, codigo: string, contexto?: Record<string, string>) => void {
  return (tenantId, codigo, contexto = {}) => {
    const seguro = Object.fromEntries(
      Object.entries(contexto).filter(([k, v]) => CHAVE_SEGURA.test(k) && !CHAVES_RESERVADAS.has(k) && typeof v === 'string' && VALOR_SEGURO.test(v)),
    );
    log.warn({ ...seguro, alerta: VALOR_SEGURO.test(codigo) ? codigo : 'codigo_invalido', tenant_id: tenantId, modulo: 'integracao-fdv' }, 'alerta do monitor');
  };
}

export interface MontagemPedidosFdv {
  recebimento: EstadoRecebimentoFdv;
  recebedor: RecebedorPedidoFdv;
  resolvedor: ResolvedorChaveErp;
  alertar: ReturnType<typeof criarAlertaMonitor>;
}

export class RecebimentoFdvIndisponivel extends Error {
  override readonly name = 'RecebimentoFdvIndisponivel';
}

/**
 * Peças do recebimento para a agenda do `integracao-fdv`. Com `ligado`, exige as agendas do módulo (`agendaDoModulo`),
 * senão derruba a partida: ligar sem elas não buscaria pedido nem enviaria retorno ao Hub.
 */
export function montarPedidosFdv(d: DependenciasRecebedorWorker & {
  log: LogPedido & LogAlerta;
  recebimento: EstadoRecebimentoFdv;
  resolvedor: ResolvedorChaveErp;
  /** `true` quando o `integracao-fdv/api` entregar as agendas de busca e de retorno (hoje, sempre `false`). */
  agendaDoModulo: boolean;
}): MontagemPedidosFdv {
  if (d.recebimento === 'ligado') {
    if (!d.agendaDoModulo) throw new RecebimentoFdvIndisponivel('MACUXIERP_FDV_RECEBIMENTO=ligado sem: agendas do integracao-fdv');
  }
  return { recebimento: d.recebimento, recebedor: montarRecebedorPedidoFdv(d), resolvedor: d.resolvedor, alertar: criarAlertaMonitor(d.log) };
}
