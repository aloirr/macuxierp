/**
 * Adaptador PostgreSQL da contingência por filial e ambiente: `faturamento.contingencia` (0013 + 0032) e a lista das EPEC pendentes em `faturamento.nota`
 * (tipo_emissao 4, epec_protocolo e epec_autorizada_em da 0032). Só o schema faturamento. O índice `contingencia_uma_aberta` faz a trava de uma aberta
 * por (tenant, filial, ambiente); o gatilho do banco só aceita o fim uma vez. Sem dado pessoal: motivo é a justificativa fiscal digitada pelo operador.
 */
import type { RepositorioContingencia, EpecPendenteRegistro } from './portas';
import type { ContingenciaResumo } from '../contracts';

const ISO = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const COLUNAS = `c.id, c.filial_id, c.ambiente, c.modalidade, c.motivo, ${ISO('c.inicio_em')} AS inicio_em, ${ISO('c.fim_em')} AS fim_em, c.ligada_por, c.desligada_por`;

export const repositorioContingenciaSql: RepositorioContingencia = {
  async abrir(tx, c) {
    const [l] = await tx.consultar<ContingenciaResumo>(
      `WITH c AS (
         INSERT INTO faturamento.contingencia (tenant_id, filial_id, ambiente, modalidade, motivo, inicio_em, ligada_por)
         VALUES (plataforma.tenant_atual(), $1, $2, $3, $4, $5::timestamptz, $6) RETURNING *)
       SELECT ${COLUNAS} FROM c`,
      [c.filial_id, c.ambiente, c.modalidade, c.motivo, c.inicio_em.toISOString(), c.ligada_por],
    );
    return l as ContingenciaResumo;
  },

  async encerrar(tx, filial_id, ambiente, fim_em, desligada_por) {
    const [l] = await tx.consultar<ContingenciaResumo>(
      `WITH c AS (
         UPDATE faturamento.contingencia SET fim_em = $3::timestamptz, desligada_por = $4
          WHERE filial_id = $1 AND ambiente = $2 AND fim_em IS NULL AND deleted_at IS NULL RETURNING *)
       SELECT ${COLUNAS} FROM c`,
      [filial_id, ambiente, fim_em.toISOString(), desligada_por],
    );
    return l ?? null;
  },

  async aberta(tx, filial_id, ambiente) {
    const [l] = await tx.consultar<ContingenciaResumo>(
      `SELECT ${COLUNAS} FROM faturamento.contingencia c WHERE c.filial_id = $1 AND c.ambiente = $2 AND c.fim_em IS NULL AND c.deleted_at IS NULL`,
      [filial_id, ambiente],
    );
    return l ?? null;
  },

  async historico(tx, filial_id, ambiente, limite) {
    return tx.consultar<ContingenciaResumo>(
      `SELECT ${COLUNAS} FROM faturamento.contingencia c
        WHERE c.filial_id = $1 AND c.ambiente = $2 AND c.fim_em IS NOT NULL AND c.deleted_at IS NULL
        ORDER BY c.fim_em DESC, c.id LIMIT $3`,
      [filial_id, ambiente, limite],
    );
  },

  async epecPendentes(tx, f) {
    return tx.consultar<EpecPendenteRegistro>(
      `SELECT n.id, n.filial_id, n.ambiente, n.serie::int AS serie, n.numero, n.chave_acesso, n.status, n.epec_protocolo, ${ISO('n.epec_autorizada_em')} AS epec_autorizada_em
         FROM faturamento.nota n
        WHERE n.deleted_at IS NULL AND n.tipo_emissao = 4 AND n.epec_protocolo IS NOT NULL AND n.status IN ('emitida_contingencia', 'rejeitada')
          AND ($1::uuid IS NULL OR n.filial_id = $1)
        ORDER BY n.epec_autorizada_em, n.id`,
      [f.filial_id ?? null],
    );
  },
};
