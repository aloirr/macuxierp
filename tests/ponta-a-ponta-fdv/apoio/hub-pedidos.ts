/**
 * T-0017: a volta no dublê do Hub — `GET /pedidos/pendentes` e `POST /pedidos/{uuid}/retorno`, registrados pelo ponto de
 * extensão `rotasExtras` do dublê da T-0012 (sem tocar nas rotas da ida). O estado fica em `estado.extras` do tenant.
 *
 * Contrato do Hub (guia-api-hub.md e estados.ts do FDV, b75ab88) e premissas a conferir na rodada real:
 * docs/testes/T-0017.md, seção "Contrato do Hub usado".
 */
import { StatusRetornoHub } from '../../../modules/integracao-fdv/contracts/index';
import { VERSAO_CONTRATO } from './contrato-hub';
import type { ContextoRota, DubleHub, EstadoTenantDuble, RespostaRota, RotaExtra } from './duble-hub';

/** O Hub devolve o pedido `enviado` a `pendente` sem retorno depois deste prazo. */
export const PRAZO_REENTREGA_MS = 10 * 60_000;
const LIMITE_PENDENTES = 50;

/** O enum do contrato (`RetornoErp.status`), não regra: os oráculos do lado FDV seguem o RD-0221. */
const STATUS_RETORNO: readonly string[] = StatusRetornoHub.options;
export type StatusRetorno = StatusRetornoHub;
export type EstadoPedidoHub = 'pendente' | 'enviado' | StatusRetorno;

/** Cópia de `TRANSICOES_PEDIDO_ERP` (FDV, `modules/integracao/domain/estados.ts`, b75ab88): integrado → rejeitado_erp não existe. */
export const TRANSICOES_PEDIDO_ERP: Readonly<Record<EstadoPedidoHub, readonly EstadoPedidoHub[]>> = {
  pendente: ['enviado'],
  enviado: ['integrado', 'rejeitado_erp', 'pendente', 'cancelado'],
  integrado: ['faturado_parcial', 'faturado_total', 'cancelado'],
  rejeitado_erp: [],
  faturado_parcial: ['faturado_total', 'cancelado'],
  faturado_total: ['cancelado'],
  cancelado: [],
};

/** `PedidoParaErp` como o FDV entrega (sem a `tentativa`, que o Hub põe na saída). */
export type PedidoParaErp = Record<string, unknown> & {
  pedido_uuid: string;
  itens: readonly (Record<string, unknown> & { sequencia: number; produto_external_id: string })[];
};

export interface RetornoAplicado {
  status: StatusRetorno;
  numero_erp: string | null;
  motivo: string | null;
  nota: string | null;
  /** Chave de acesso, se o ERP a mandou em `nota.chave` (o `NotaRetorno` do Hub ainda não tem o campo e a ignora; T-0089, D3); senão, nulo. */
  chave_acesso: string | null;
  em: string;
}

export interface PedidoNaFila {
  pedido: PedidoParaErp;
  estado: EstadoPedidoHub;
  tentativas: number;
  enviadoEm: number | null;
  numeroErp: string | null;
  motivo: string | null;
  retornos: RetornoAplicado[];
  /** Respostas de retorno recebidas (com status HTTP e `repetido`), na ordem. */
  respostas: { status: number; repetido: boolean | null; codigo: string | null }[];
  removido: boolean;
  ordem: number;
}

interface FilaPedidos {
  pedidos: Map<string, PedidoNaFila>;
  semRecebePedidos: Set<string>;
  /** Retornos que o Hub aplica e cuja resposta "se perde" (503): prova a idempotência na reentrega do retorno. */
  perderResposta: Map<string, number>;
  ordem: number;
}

const CHAVE_EXTRA = 't0017:pedidos';
export const UUID_HUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O Conector está sem "Recebe pedidos" (a mesma permissão vale para pedidos e para o pré-cadastro de cliente). */
export function conectorSemRecebe(estado: EstadoTenantDuble, conectorId: string): boolean {
  return filaDe(estado).semRecebePedidos.has(conectorId);
}

function filaDe(estado: EstadoTenantDuble): FilaPedidos {
  let f = estado.extras.get(CHAVE_EXTRA) as FilaPedidos | undefined;
  if (!f) {
    f = { pedidos: new Map(), semRecebePedidos: new Set(), perderResposta: new Map(), ordem: 0 };
    estado.extras.set(CHAVE_EXTRA, f);
  }
  return f;
}

/** Corpo de erro do Hub (`codigo`, `mensagem` e `erros` com o campo); também usado pelo dublê de clientes. */
export const erroHub = (status: number, codigo: string, mensagem: string, campo: string | null = null): RespostaRota => ({
  status,
  corpo: { codigo, mensagem, erros: [{ codigo, campo, mensagem }] },
});

function pendentes(ctx: ContextoRota): RespostaRota {
  const fila = filaDe(ctx.estado);
  if (fila.semRecebePedidos.has(ctx.conector.conectorId))
    return erroHub(403, 'acesso_negado', 'Este Conector não recebe pedidos (cadastro do Conector no BKO).');
  const bruto = ctx.consulta.get('limite');
  const limite = bruto === null ? LIMITE_PENDENTES : Number(bruto);
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_PENDENTES)
    return erroHub(422, 'valor_fora_da_faixa', `O limite vai de 1 a ${LIMITE_PENDENTES}.`, 'limite');
  const agora = ctx.agora.getTime();
  for (const p of fila.pedidos.values()) {
    if (p.estado === 'enviado' && p.enviadoEm !== null && agora - p.enviadoEm >= PRAZO_REENTREGA_MS) p.estado = 'pendente';
  }
  const saida = [...fila.pedidos.values()]
    .filter((p) => p.estado === 'pendente' && !p.removido)
    .sort((a, b) => a.ordem - b.ordem)
    .slice(0, limite);
  for (const p of saida) {
    p.estado = 'enviado';
    p.tentativas += 1;
    p.enviadoEm = agora;
  }
  return { status: 200, corpo: { pedidos: saida.map((p) => ({ ...p.pedido, tentativa: p.tentativas })) } };
}

function comoNota(nota: unknown): { numero?: unknown; serie?: unknown; chave?: unknown } | null {
  return nota && typeof nota === 'object' ? (nota as { numero?: unknown; serie?: unknown; chave?: unknown }) : null;
}

function chaveAcesso(nota: unknown): string | null {
  const chave = comoNota(nota)?.chave;
  return typeof chave === 'string' ? chave : null;
}

function chaveNota(nota: unknown): string | null {
  const n = comoNota(nota);
  return n ? `${String(n.numero)}/${n.serie == null ? '-' : String(n.serie)}` : null;
}

function itensDescartados(item: PedidoNaFila, itens: unknown): Record<string, unknown>[] {
  if (!Array.isArray(itens)) return [];
  const porSequencia = new Map(item.pedido.itens.map((i) => [i.sequencia, i.produto_external_id]));
  const fora: Record<string, unknown>[] = [];
  itens.forEach((i: Record<string, unknown>, indice) => {
    const esperado = porSequencia.get(i.sequencia as number);
    const codigo =
      esperado === undefined ? 'sequencia_inexistente' : esperado !== i.produto_external_id ? 'produto_divergente' : null;
    if (codigo) fora.push({ indice, sequencia: i.sequencia, codigo, campo: `itens_faturados[${indice}]` });
  });
  return fora;
}

function retorno(ctx: ContextoRota): RespostaRota {
  const fila = filaDe(ctx.estado);
  const uuid = ctx.caminho.split('/')[2] ?? '';
  if (!UUID_HUB.test(uuid)) return erroHub(400, 'requisicao_invalida', 'O pedido_uuid do caminho precisa ser um UUID.', 'pedido_uuid');
  const c = (ctx.corpo ?? {}) as Record<string, unknown>;
  if (c.versao_contrato !== VERSAO_CONTRATO)
    return erroHub(422, 'versao_nao_suportada', `versao_contrato deve ser "${VERSAO_CONTRATO}".`, 'versao_contrato');
  // corpo inválido = 400 requisicao_invalida (openapi `retorno_pedido` do FDV)
  if (typeof c.pedido_uuid !== 'string' || c.pedido_uuid.toLowerCase() !== uuid.toLowerCase())
    return erroHub(400, 'requisicao_invalida', 'O pedido_uuid do corpo difere do caminho.', 'pedido_uuid');
  const status = c.status as StatusRetorno;
  if (!STATUS_RETORNO.includes(status)) return erroHub(400, 'requisicao_invalida', 'Status de retorno desconhecido.', 'status');
  if (status === 'rejeitado_erp' && (typeof c.motivo !== 'string' || !c.motivo.trim()))
    return erroHub(400, 'requisicao_invalida', 'O retorno rejeitado_erp exige o motivo.', 'motivo');
  if (status === 'integrado' && (typeof c.numero_erp !== 'string' || !c.numero_erp))
    return erroHub(400, 'requisicao_invalida', 'O retorno integrado leva o numero_erp.', 'numero_erp');
  if ((status === 'faturado_parcial' || status === 'faturado_total') && !c.nota)
    return erroHub(400, 'requisicao_invalida', 'O retorno faturado leva a nota.', 'nota');
  if (c.nota) {
    // `NotaRetorno` do OpenAPI real do Hub (24/11/2026): `numero` texto de 1 a 40, `serie` texto até 10 ou nulo; inteiro = 400.
    // O Hub não tem campo de chave de acesso: `chave` não é exigida (se vier, o dublê só a anota, para o D3 da T-0089).
    const n = comoNota(c.nota);
    if (!n || typeof n.numero !== 'string' || n.numero.length < 1 || n.numero.length > 40)
      return erroHub(400, 'requisicao_invalida', 'nota.numero é texto de 1 a 40 caracteres.', 'nota.numero');
    if (n.serie !== undefined && n.serie !== null && (typeof n.serie !== 'string' || n.serie.length > 10))
      return erroHub(400, 'requisicao_invalida', 'nota.serie é texto de até 10 caracteres ou nulo.', 'nota.serie');
  }

  const item = fila.pedidos.get(uuid.toLowerCase());
  const registrar = (r: RespostaRota): RespostaRota => {
    const corpo = (r.corpo ?? {}) as { repetido?: boolean; codigo?: string };
    item?.respostas.push({ status: r.status, repetido: corpo.repetido ?? null, codigo: corpo.codigo ?? null });
    return r;
  };
  if (!item || item.removido)
    return registrar(erroHub(422, 'pedido_desconhecido', 'O Hub não conhece este pedido. Confira o pedido_uuid; não reenvie igual.', 'pedido_uuid'));
  const nota = chaveNota(c.nota);
  const numeroErp = typeof c.numero_erp === 'string' ? c.numero_erp : null;
  if (numeroErp && item.numeroErp && numeroErp !== item.numeroErp)
    return registrar(erroHub(422, 'numero_erp_divergente', 'O mesmo pedido não tem dois números no ERP.', 'numero_erp'));
  // como o FDV: repetido só se o estado atual já é o status (no parcial, com a mesma nota do último retorno)
  const jaAplicado = item.estado === status && (status !== 'faturado_parcial' || item.retornos.at(-1)?.nota === nota);
  if (jaAplicado) return registrar({ status: 200, corpo: { pedido_uuid: uuid, status: item.estado, repetido: true } });

  let de = item.estado;
  if (de === 'pendente') {
    if (item.tentativas === 0)
      return registrar(erroHub(422, 'pedido_nao_entregue', 'Este pedido ainda não saiu em /pedidos/pendentes. Busque-o antes de devolver o retorno.', 'pedido_uuid'));
    de = 'enviado'; // voltou a pendente por prazo, mas o ERP já o tinha: a confirmação vale
  }
  const possiveis = de === 'faturado_parcial' ? [...TRANSICOES_PEDIDO_ERP[de], 'faturado_parcial'] : TRANSICOES_PEDIDO_ERP[de];
  if (!possiveis.includes(status))
    return registrar(
      erroHub(422, 'transicao_invalida', `O pedido está ${de}; daqui só vai para: ${possiveis.join(', ') || 'nenhum'}.`, 'status'),
    );
  const descartados = status.startsWith('faturado') ? itensDescartados(item, c.itens_faturados) : [];
  item.estado = status;
  item.numeroErp ??= numeroErp;
  if (typeof c.motivo === 'string') item.motivo = c.motivo;
  item.retornos.push({ status, numero_erp: numeroErp, motivo: typeof c.motivo === 'string' ? c.motivo : null, nota, chave_acesso: chaveAcesso(c.nota), em: ctx.agora.toISOString() });
  const perder = fila.perderResposta.get(uuid.toLowerCase()) ?? 0;
  if (perder > 0) {
    fila.perderResposta.set(uuid.toLowerCase(), perder - 1);
    return registrar({ ...erroHub(503, 'servico_indisponivel', 'Resposta perdida (dublê).'), cabecalhos: { 'retry-after': '1' } });
  }
  return registrar({
    status: 200,
    corpo: { pedido_uuid: uuid, status, repetido: false, ...(descartados.length ? { itens_descartados: descartados } : {}) },
  });
}

/** As duas rotas da volta, para `criarDubleHub({ rotasExtras })` (ou `prepararAlvo(..., { duble: { rotasExtras } })`). */
export function rotasPedidosDuble(): RotaExtra[] {
  return [
    { metodo: 'GET', padrao: /^\/pedidos\/pendentes$/, tratar: pendentes },
    { metodo: 'POST', padrao: /^\/pedidos\/[^/]+\/retorno$/, tratar: retorno },
  ];
}

// ---------------------------------------------------------------- o lado do FDV, sob comando do teste ------------------

/** O vendedor teve o pedido aprovado no FDV: entra na fila do ERP como `pendente`. */
export function aprovarNoFdv(duble: DubleHub, tenant: string, pedido: PedidoParaErp): void {
  const fila = filaDe(duble.estado(tenant));
  fila.pedidos.set(pedido.pedido_uuid.toLowerCase(), {
    pedido,
    estado: 'pendente',
    tentativas: 0,
    enviadoEm: null,
    numeroErp: null,
    motivo: null,
    retornos: [],
    respostas: [],
    removido: false,
    ordem: ++fila.ordem,
  });
}

export function pedidoNoHub(duble: DubleHub, tenant: string, uuid: string): PedidoNaFila | null {
  return filaDe(duble.estado(tenant)).pedidos.get(uuid.toLowerCase()) ?? null;
}

/** Cadastro do Conector no BKO do FDV sem "recebe pedidos" (como o Conector do ERP na thathyany até a T-0027). */
export function semRecebePedidos(duble: DubleHub, tenant: string, conectorId: string): void {
  filaDe(duble.estado(tenant)).semRecebePedidos.add(conectorId);
}

/** O Hub aplica os próximos `vezes` retornos do pedido e a resposta se perde (503 com `Retry-After: 1`). */
export function perderRespostaDoRetorno(duble: DubleHub, tenant: string, uuid: string, vezes = 1): void {
  filaDe(duble.estado(tenant)).perderResposta.set(uuid.toLowerCase(), vezes);
}

/** O pedido some do Hub (removido no FDV): o retorno seguinte dá 422 `pedido_desconhecido`. */
export function removerNoFdv(duble: DubleHub, tenant: string, uuid: string): void {
  const p = pedidoNoHub(duble, tenant, uuid);
  if (p) p.removido = true;
}
