/** Adaptador PostgreSQL dos títulos a receber (migração 0013: `faturamento.titulo` e `titulo_baixa`). Roda na transação do tenant (RLS). */
import { paginar, type Pagina, type Transacao } from '@macuxierp/platform-sdk';
import type { BaixaTituloResumo, FiltroTitulos, TituloDetalhe, TituloResumo } from '../contracts';
import type { RepositorioTitulos } from './portas';

const ISO = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const DE = 'faturamento.titulo t JOIN faturamento.nota n ON n.tenant_id = t.tenant_id AND n.id = t.nota_id';
const SAVEPOINT = 'titulos_da_nota';
const COLUNAS = `t.id, t.nota_id, n.numero, n.destinatario_retrato->>'nome' AS cliente_razao_social, t.filial_id, t.cliente_id, t.ambiente, t.parcela::int AS parcela, t.total_parcelas::int AS total_parcelas,
  to_char(t.vencimento, 'YYYY-MM-DD') AS vencimento, t.valor_centavos::float8 AS valor_centavos, t.saldo_centavos::float8 AS saldo_centavos, t.status`;
const COLUNAS_BAIXA = `b.id, b.titulo_id, b.valor_centavos::float8 AS valor_centavos, b.forma, ${ISO('b.baixado_em')} AS baixado_em, ${ISO('b.estornada_em')} AS estornada_em`;

export const repositorioTitulosSql: RepositorioTitulos = {
  async inserirParcelas(tx, nota, parcelas) {
    if (parcelas.length === 0) return [];
    // Filial, cliente e ambiente são conferidos contra a nota pelo gatilho, que também põe o saldo inicial (= valor, RD-0603).
    return tx.consultar<TituloResumo>(
      `WITH ins AS (INSERT INTO faturamento.titulo (tenant_id, nota_id, filial_id, cliente_id, ambiente, conta_como_real, parcela, total_parcelas, vencimento, valor_centavos)
       SELECT plataforma.tenant_atual(), $1, $2, $3, x.ambiente, $5::boolean, x.parcela, x.total_parcelas, x.vencimento::date, x.valor_centavos
         FROM jsonb_to_recordset($4::jsonb) AS x(ambiente text, parcela int, total_parcelas int, vencimento text, valor_centavos bigint)
       ON CONFLICT ON CONSTRAINT titulo_parcela_uq DO NOTHING
       RETURNING *)
       SELECT ${COLUNAS} FROM ${DE.replace('faturamento.titulo t', 'ins t')} ORDER BY t.parcela`,
      [nota.id, nota.filial_id, nota.cliente_id, JSON.stringify(parcelas.map((p) => ({ ambiente: p.ambiente, parcela: p.parcela, total_parcelas: p.total_parcelas, vencimento: p.vencimento, valor_centavos: p.valor_centavos }))), nota.conta_como_real],
    );
  },

  listarDaNota: (tx, nota_id, opcoes) =>
    tx.consultar<TituloResumo>(`SELECT ${COLUNAS} FROM ${DE} WHERE t.nota_id = $1 AND t.deleted_at IS NULL ORDER BY t.parcela ${opcoes?.travar ? 'FOR UPDATE OF t' : ''}`, [nota_id]),

  async obter(tx, id, opcoes) {
    const [l] = await tx.consultar<TituloResumo>(`SELECT ${COLUNAS} FROM ${DE} WHERE t.id = $1 AND t.deleted_at IS NULL ${opcoes?.travar ? 'FOR UPDATE OF t' : ''}`, [id]);
    return l ?? null;
  },

  baixasDoTitulo: (tx, titulo_id) =>
    tx.consultar<BaixaTituloResumo>(`SELECT ${COLUNAS_BAIXA} FROM faturamento.titulo_baixa b WHERE b.titulo_id = $1 ORDER BY b.created_at, b.id`, [titulo_id]),

  async registrarBaixa(tx, titulo_id, b) {
    const [l] = await tx.consultar<BaixaTituloResumo>(
      `INSERT INTO faturamento.titulo_baixa AS b (tenant_id, titulo_id, valor_centavos, baixado_em, usuario_id, forma)
       VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5)
       RETURNING ${COLUNAS_BAIXA}`,
      [titulo_id, b.valor_centavos, b.baixado_em.toISOString(), b.usuario_id, b.forma],
    );
    if (!l) throw new Error('RN-FAT-06: a baixa não devolveu linha');
    return l;
  },

  async estornarBaixa(tx, baixa_id, estornada_em) {
    const r = await tx.consultar<{ id: string }>('UPDATE faturamento.titulo_baixa SET estornada_em = $2 WHERE id = $1 AND estornada_em IS NULL RETURNING id', [baixa_id, estornada_em.toISOString()]);
    if (r.length === 0) throw new Error('RN-FAT-06: baixa inexistente ou já estornada');
  },

  async emSavepoint(tx, fn) {
    // A falha desfaz só o que `fn` gravou (títulos e eventos); a transação, e com ela o nfeProc já guardado, segue viva (RN-FAT-03).
    await tx.consultar(`SAVEPOINT ${SAVEPOINT}`);
    try {
      const valor = await fn();
      await tx.consultar(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return { ok: true, valor };
    } catch (erro) {
      await tx.consultar(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      await tx.consultar(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      return { ok: false, erro };
    }
  },

  async notasBoletoSemTitulo(tx, { ha_minutos, limite, excluir = [] }) {
    // Só o boleto gera título (tPag 15). A nota autorizada há `ha_minutos` e sem nenhuma parcela é pendência de geração (a reconciliação do lote já passou).
    return tx.consultar<{ id: string }>(
      `SELECT n.id FROM faturamento.nota n
        WHERE n.status = 'autorizada' AND n.deleted_at IS NULL AND n.pagamento->'pagamentos'->0->>'tPag' = '15'
          AND n.autorizada_em <= now() - make_interval(mins => $1::int)
          AND NOT EXISTS (SELECT 1 FROM faturamento.titulo t WHERE t.tenant_id = n.tenant_id AND t.nota_id = n.id)
          AND n.id <> ALL($3::uuid[])
        ORDER BY n.autorizada_em LIMIT $2`,
      [ha_minutos, limite, excluir],
    ).then((l) => l.map((x) => x.id));
  },

  async cancelar(tx, ids) {
    if (ids.length === 0) return;
    await tx.consultar(`UPDATE faturamento.titulo SET status = 'cancelado', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'aberto'`, [ids]);
  },

  async listar(tx, f: FiltroTitulos): Promise<Pagina<TituloResumo>> {
    const linhas = await tx.consultar<TituloResumo>(
      `SELECT ${COLUNAS} FROM ${DE}
        WHERE t.deleted_at IS NULL
          AND ($1::uuid IS NULL OR t.cliente_id = $1) AND ($2::uuid IS NULL OR t.nota_id = $2) AND ($3::text IS NULL OR t.status = $3)
          AND ($4::text IS NULL OR t.ambiente = $4) AND ($5::date IS NULL OR t.vencimento >= $5) AND ($6::date IS NULL OR t.vencimento <= $6)
          AND ($7::uuid IS NULL OR t.id > $7)
        ORDER BY t.id LIMIT $8`,
      [f.cliente_id ?? null, f.nota_id ?? null, f.status ?? null, f.ambiente ?? null, f.vencimento_de ?? null, f.vencimento_ate ?? null, f.cursor ?? null, f.limite + 1],
    );
    return paginar(linhas, f.limite);
  },

  async detalhar(tx, id): Promise<TituloDetalhe | null> {
    const t = await repositorioTitulosSql.obter(tx, id);
    return t ? { ...t, baixas: await repositorioTitulosSql.baixasDoTitulo(tx, id) } : null;
  },

  async saldoAbertoCliente(tx: Transacao, cliente_id) {
    const [l] = await tx.consultar<{ saldo: number }>(
      `SELECT COALESCE(SUM(t.saldo_centavos), 0)::float8 AS saldo
         FROM ${DE}
        WHERE t.cliente_id = $1 AND t.status = 'aberto' AND (t.ambiente = 'producao' OR t.conta_como_real) AND n.status <> 'cancelada' AND t.deleted_at IS NULL`,
      [cliente_id],
    );
    return l?.saldo ?? 0;
  },
};
