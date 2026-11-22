/**
 * Leitura de `fiscal.regra_tributaria` (0013 e 0021) e `fiscal.carga_aproximada` na transação do tenant: a RLS (`app.tenant_id`, definido pelo
 * `comTenant` do SDK) isola os tenants, por isso não há `tenant_id` de parâmetro. Percentuais saem em inteiros de 4 casas, como no contrato;
 * bigint (`valor_unidade_*`) volta como float8 (cabe em 2^53). Regras fora da vigência (RN-FIS-04) nem chegam ao motor.
 */
import { RegraTributaria, type CargaAproximada } from '../contracts';
import type { RepositorioFiscal } from './portas';

const D = (c: string): string => `to_char(${c}, 'YYYY-MM-DD')`;

const COLUNAS_REGRA = `id, tributo, ncm_prefixo, uf_origem, uf_destino, tipo_cliente, crt::int AS crt, cfop, codigo, mod_bc::int AS mod_bc,
  aliquota_icms, reducao_bc, mod_bc_st::int AS mod_bc_st, mva_original, mva_ajustada, ajustar_mva, reducao_bc_st, aliquota_interna_destino,
  p_fcp, p_fcp_st, p_cred_sn, p_dif, p_icms_efet, cst_ipi, aliquota_ipi, c_enq, valor_unidade_ipi::float8 AS valor_unidade_ipi,
  cst_pis, aliquota_pis, valor_unidade_pis::float8 AS valor_unidade_pis, cst_cofins, aliquota_cofins, valor_unidade_cofins::float8 AS valor_unidade_cofins,
  cst_ibs_cbs, c_class_trib, p_ibs_uf, p_ibs_mun, p_cbs, p_red_ibs, p_red_cbs, cst_is, c_class_trib_is, p_is,
  valor_unidade_is::float8 AS valor_unidade_is, versao_nt_rtc, excluir_icms_bc, fonte_tipo, fonte_referencia, versao,
  ${D('vigencia_inicio')} AS vigencia_inicio, ${D('vigencia_fim')} AS vigencia_fim`;

type Linha = Record<string, unknown>;

function regraDaLinha(l: Linha): RegraTributaria {
  const { fonte_tipo, fonte_referencia, ...resto } = l;
  return RegraTributaria.parse({ ...resto, fonte: fonte_tipo && fonte_referencia ? { tipo: fonte_tipo, referencia: fonte_referencia } : null });
}

export const repositorioFiscalSql: RepositorioFiscal = {
  async regras(tx, f) {
    const linhas = await tx.consultar<Linha>(
      `SELECT ${COLUNAS_REGRA}
         FROM fiscal.regra_tributaria
        WHERE deleted_at IS NULL
          AND vigencia_inicio <= $1::date AND (vigencia_fim IS NULL OR vigencia_fim >= $1::date)
          AND (uf_origem IS NULL OR uf_origem = $2) AND (uf_destino IS NULL OR uf_destino = $3) AND (crt IS NULL OR crt = $4)
          AND (ncm_prefixo IS NULL OR EXISTS (SELECT 1 FROM unnest($5::text[]) AS n WHERE n LIKE ncm_prefixo || '%'))
        ORDER BY id`,
      [f.data_emissao, f.uf_origem, f.uf_destino, f.crt, f.ncms],
    );
    return linhas.map(regraDaLinha);
  },

  async cargas(tx, f) {
    if (f.ncms.length === 0) return new Map();
    const linhas = await tx.consultar<{
      ncm: string; aliquota_federal_nacional: number; aliquota_federal_importado: number; aliquota_estadual: number; aliquota_municipal: number; versao: string; fonte: string;
    }>(
      `SELECT DISTINCT ON (ncm) ncm, aliquota_federal_nacional, aliquota_federal_importado, aliquota_estadual, aliquota_municipal, versao, fonte
         FROM fiscal.carga_aproximada
        WHERE deleted_at IS NULL AND ex IS NULL AND ncm = ANY($1::text[]) AND uf = $2
          AND vigencia_inicio <= $3::date AND (vigencia_fim IS NULL OR vigencia_fim >= $3::date)
        ORDER BY ncm, (tenant_id = plataforma.tenant_atual()) DESC, vigencia_inicio DESC`,
      [f.ncms, f.uf, f.data_emissao],
    );
    const mapa = new Map<string, CargaAproximada>();
    for (const l of linhas) {
      mapa.set(l.ncm, {
        federal_nacional: l.aliquota_federal_nacional,
        federal_importado: l.aliquota_federal_importado,
        estadual: l.aliquota_estadual,
        municipal: l.aliquota_municipal,
        versao: l.versao,
        fonte: l.fonte,
      });
    }
    return mapa;
  },
};
