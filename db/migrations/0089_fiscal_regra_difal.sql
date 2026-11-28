-- 0089 — DIFAL: p_fcp_uf_dest e difal_base_dupla em fiscal.regra_tributaria e fiscal.regra_base (v0.3.32, T-0128;
-- RN-FIS-06; pedido R-20261128-072809-modulo-fiscal). Aditiva e reexecutável. O porquê: docs/banco/README.md, seção
-- "DIFAL na regra (0089)".
--
-- - p_fcp_uf_dest: pFCPUFDest, FCP da UF de destino no DIFAL, integer escala 4 (2% = 20000), faixa 0 a 1000000 como
--   as outras alíquotas (0013); nulo = não informado; 0 = a UF de destino não tem FCP.
-- - difal_base_dupla: boolean SEM padrão; true = base dupla, false = base única; nulo = não informado. O fiscal não
--   inventa: sem as duas colunas o cálculo do DIFAL devolve REGRA_INCOMPLETA.
-- - Nomes, tipos e nulidade iguais nas duas tabelas (paridade da 0082). As duas entram no CHECK so_o_tributo como
--   campos de ICMS (linha de outro tributo não as aceita), recriado num ALTER só, sem janela sem o CHECK. Ficam fora
--   do regra_base_sem_st_interestadual (DIFAL não é ST).
-- - Sem tabela de alíquota interna e FCP por UF: cada regra traz os valores, com a fonte e a vigência da regra.
-- Versão anterior sobre o esquema novo: ela não conhece as colunas; as linhas que grava ficam com as duas nulas, e o
-- CHECK recriado só acrescenta colunas que ela nunca preenche.

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE fiscal.regra_tributaria
  ADD COLUMN IF NOT EXISTS p_fcp_uf_dest integer,
  ADD COLUMN IF NOT EXISTS difal_base_dupla boolean;
ALTER TABLE fiscal.regra_base
  ADD COLUMN IF NOT EXISTS p_fcp_uf_dest integer,
  ADD COLUMN IF NOT EXISTS difal_base_dupla boolean;

-- CHECKs de faixa nomeados (padrão da 0021), idempotentes por pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'fiscal.regra_tributaria'::regclass
                 AND conname = 'regra_tributaria_p_fcp_uf_dest_ck') THEN
    ALTER TABLE fiscal.regra_tributaria
      ADD CONSTRAINT regra_tributaria_p_fcp_uf_dest_ck CHECK (p_fcp_uf_dest BETWEEN 0 AND 1000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'fiscal.regra_base'::regclass
                 AND conname = 'regra_base_p_fcp_uf_dest_ck') THEN
    ALTER TABLE fiscal.regra_base
      ADD CONSTRAINT regra_base_p_fcp_uf_dest_ck CHECK (p_fcp_uf_dest BETWEEN 0 AND 1000000);
  END IF;
END $$;

-- so_o_tributo com as duas colunas no ramo de ICMS (validado na hora, sem NOT VALID).
ALTER TABLE fiscal.regra_tributaria
  DROP CONSTRAINT IF EXISTS regra_tributaria_so_o_tributo,
  ADD CONSTRAINT regra_tributaria_so_o_tributo CHECK (tributo = 'icms' OR (
    num_nonnulls(codigo, aliquota_icms, reducao_bc, p_cred_sn, mod_bc_st, mva_original, mva_ajustada, reducao_bc_st,
      aliquota_interna_destino, p_fcp, p_fcp_st, p_dif, p_icms_efet, p_fcp_uf_dest, difal_base_dupla) = 0
    AND (tributo = 'ipi' OR num_nonnulls(cst_ipi, aliquota_ipi, valor_unidade_ipi) = 0)
    AND (tributo = 'pis' OR num_nonnulls(cst_pis, aliquota_pis, valor_unidade_pis) = 0)
    AND (tributo = 'cofins' OR num_nonnulls(cst_cofins, aliquota_cofins, valor_unidade_cofins) = 0)
    AND (tributo = 'ibs_cbs' OR num_nonnulls(cst_ibs_cbs, c_class_trib, p_ibs_uf, p_ibs_mun, p_cbs, p_red_ibs,
      p_red_cbs) = 0)
    AND (tributo = 'is' OR num_nonnulls(p_is, cst_is, c_class_trib_is, valor_unidade_is) = 0)));
ALTER TABLE fiscal.regra_base
  DROP CONSTRAINT IF EXISTS regra_base_so_o_tributo,
  ADD CONSTRAINT regra_base_so_o_tributo CHECK (tributo = 'icms' OR (
    num_nonnulls(codigo, aliquota_icms, reducao_bc, p_cred_sn, mod_bc_st, mva_original, mva_ajustada, reducao_bc_st,
      aliquota_interna_destino, p_fcp, p_fcp_st, p_dif, p_icms_efet, p_fcp_uf_dest, difal_base_dupla) = 0
    AND (tributo = 'ipi' OR num_nonnulls(cst_ipi, aliquota_ipi, valor_unidade_ipi) = 0)
    AND (tributo = 'pis' OR num_nonnulls(cst_pis, aliquota_pis, valor_unidade_pis) = 0)
    AND (tributo = 'cofins' OR num_nonnulls(cst_cofins, aliquota_cofins, valor_unidade_cofins) = 0)
    AND (tributo = 'ibs_cbs' OR num_nonnulls(cst_ibs_cbs, c_class_trib, p_ibs_uf, p_ibs_mun, p_cbs, p_red_ibs,
      p_red_cbs) = 0)
    AND (tributo = 'is' OR num_nonnulls(p_is, cst_is, c_class_trib_is, valor_unidade_is) = 0)));

COMMENT ON COLUMN fiscal.regra_tributaria.p_fcp_uf_dest IS
  'pFCPUFDest: FCP da UF de destino no DIFAL, escala 4 (2% = 20000); nulo = não informado (REGRA_INCOMPLETA no '
  'DIFAL); 0 = a UF de destino não tem FCP. RN-FIS-06, T-0128.';
COMMENT ON COLUMN fiscal.regra_tributaria.difal_base_dupla IS
  'DIFAL: true = base dupla, false = base única; nulo = não informado (sem padrão; REGRA_INCOMPLETA no DIFAL). '
  'RN-FIS-06, T-0128.';
COMMENT ON COLUMN fiscal.regra_base.p_fcp_uf_dest IS
  'pFCPUFDest: igual a fiscal.regra_tributaria.p_fcp_uf_dest (paridade do catálogo). T-0128.';
COMMENT ON COLUMN fiscal.regra_base.difal_base_dupla IS
  'DIFAL base única ou dupla: igual a fiscal.regra_tributaria.difal_base_dupla (sem padrão). T-0128.';
-- Grants: regra_tributaria por tabela (0013) e regra_base só SELECT (0082); as colunas novas entram sozinhas.
