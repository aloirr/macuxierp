/**
 * Seção "Clientes recebidos do FDV" do BKO (T-0059 §5.5): uma linha por `cliente_uuid`, a da revisão mais recente, com os mais
 * recentes primeiro. Só colunas nomeadas, nunca o `payload` (o papel do app nem o enxerga) e sempre com `tenant_id`. O
 * documento sai só mascarado; a linha expurgada (RN-INF-06) sai com o texto fixo "—" (`linhaDaRotaClienteRecebido`).
 */
import { PaginaClientesRecebidosFdv, type ClienteRecebidoFdv, type SituacaoClienteRecebidoFdv, type Transacao } from '@macuxierp/platform-sdk';
import { linhaDaRotaClienteRecebido, type LinhaClienteRecebido } from '../domain';

interface FiltroClientesRecebidos {
  situacao?: SituacaoClienteRecebidoFdv;
  cursor?: string;
  limite: number;
}

const COLUNAS = `c.id, c.cliente_uuid, c.codigo_fdv, c.razao_social, c.documento_mascarado, c.vendedor_external_id, c.recebido_em,
  c.revisao, c.situacao, c.motivo, c.erros, c.cliente_id, c.payload_expurgado_em, c.chegou_em`;

/** Só a última revisão por `cliente_uuid`. */
const FILTRO_ULTIMA_REVISAO = `AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_recebido h
                         WHERE h.tenant_id = c.tenant_id AND h.cliente_uuid = c.cliente_uuid AND h.revisao > c.revisao AND h.deleted_at IS NULL)`;

/** Linhas cruas (só colunas nomeadas, nunca o payload): o Log do cadastro de cliente (RN-INF-09) e a rota /clientes-recebidos leem daqui. */
export async function lerLinhasClientesRecebidos(tx: Transacao, tenantId: string, f: FiltroClientesRecebidos): Promise<LinhaClienteRecebido[]> {
  return await tx.consultar<LinhaClienteRecebido>(
    `SELECT ${COLUNAS},
            (SELECT r.estado FROM integracao_fdv.cliente_retorno r
              WHERE r.tenant_id = c.tenant_id AND r.cliente_uuid = c.cliente_uuid AND r.revisao = c.revisao AND r.deleted_at IS NULL
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS retorno
       FROM integracao_fdv.cliente_recebido c
      WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        ${FILTRO_ULTIMA_REVISAO}
        AND ($2::text IS NULL OR c.situacao = $2)
        AND ($3::uuid IS NULL OR (c.chegou_em, c.id) < (SELECT k.chegou_em, k.id FROM integracao_fdv.cliente_recebido k WHERE k.tenant_id = $1 AND k.id = $3))
      ORDER BY c.chegou_em DESC, c.id DESC LIMIT $4`,
    [tenantId, f.situacao ?? null, f.cursor ?? null, f.limite + 1],
  );
}

/** Total de clientes recebidos (última revisão por `cliente_uuid`), do tenant (e da situação, quando vier), para o Log e o export. */
export async function contarClientesRecebidos(tx: Transacao, tenantId: string, situacao?: SituacaoClienteRecebidoFdv): Promise<number> {
  const r = await tx.consultar<{ n: number }>(
    `SELECT count(*)::int AS n FROM integracao_fdv.cliente_recebido c
      WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        ${FILTRO_ULTIMA_REVISAO}
        AND ($2::text IS NULL OR c.situacao = $2)`,
    [tenantId, situacao ?? null],
  );
  return r[0]?.n ?? 0;
}

export async function listarClientesRecebidos(tx: Transacao, tenantId: string, f: FiltroClientesRecebidos): Promise<PaginaClientesRecebidosFdv> {
  const linhas = await lerLinhasClientesRecebidos(tx, tenantId, f);
  const itens = linhas.slice(0, f.limite).map((l) => linhaDaRotaClienteRecebido(l));
  return { itens, proximo_cursor: linhas.length > f.limite ? (itens.at(-1)?.id ?? null) : null };
}

/** Teto de linhas de todo CSV do módulo (lotes, log de erros, recebidos) e tamanho da página de leitura dos recebidos (keyset por `chegou_em`, `id`). */
export const MAXIMO_LINHAS_CSV = 10_000;
const PAGINA_RECEBIDOS_CSV = 500;

interface RecebidosParaExportar {
  itens: ClienteRecebidoFdv[];
  /** Há mais recebidos além do teto: o arquivo parou nele e a tela avisa. */
  cortado: boolean;
}

/**
 * Export completo (decisão 21 A): lê todos os recebidos do tenant, em páginas por cursor (sempre com `tenant_id`), até o teto. Passou do
 * teto: devolve só o teto, os mais recentes, com `cortado = true`. Só o que a rota já devolve (documento mascarado, nunca o payload).
 */
export async function lerRecebidosParaExportar(
  tx: Transacao, tenantId: string, f: { situacao?: SituacaoClienteRecebidoFdv; teto?: number; pagina?: number } = {},
): Promise<RecebidosParaExportar> {
  const teto = f.teto ?? MAXIMO_LINHAS_CSV;
  const pagina = f.pagina ?? PAGINA_RECEBIDOS_CSV;
  const itens: ClienteRecebidoFdv[] = [];
  let cursor: string | undefined;
  for (;;) {
    const linhas = await lerLinhasClientesRecebidos(tx, tenantId, { situacao: f.situacao, cursor, limite: pagina });
    const daPagina = linhas.slice(0, pagina);
    for (const l of daPagina) {
      if (itens.length >= teto) return { itens, cortado: true };
      itens.push(linhaDaRotaClienteRecebido(l));
    }
    if (linhas.length <= pagina) return { itens, cortado: false };
    if (itens.length >= teto) return { itens, cortado: true };
    cursor = daPagina.at(-1)!.id;
  }
}
