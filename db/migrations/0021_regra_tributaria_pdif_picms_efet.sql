-- 0021 — fiscal.regra_tributaria: p_dif e p_icms_efet (T-0020, lote 4 do motor; contrato fiscal.calculo@1). Aditiva e
-- reexecutável. Percentuais em integer escala 4 (18% = 180000), nulos e sem padrão, como aliquota_icms na 0013.
-- Grants da 0013 são por tabela (app SELECT/INSERT/UPDATE, leitura SELECT): as colunas novas entram sozinhas.

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE fiscal.regra_tributaria ADD COLUMN IF NOT EXISTS p_dif integer;
ALTER TABLE fiscal.regra_tributaria ADD COLUMN IF NOT EXISTS p_icms_efet integer;

-- CHECKs nomeados, com a mesma faixa de aliquota_icms (0013); idempotentes por pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'fiscal.regra_tributaria'::regclass AND conname = 'regra_tributaria_p_dif_ck') THEN
    ALTER TABLE fiscal.regra_tributaria
      ADD CONSTRAINT regra_tributaria_p_dif_ck CHECK (p_dif BETWEEN 0 AND 1000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'fiscal.regra_tributaria'::regclass AND conname = 'regra_tributaria_p_icms_efet_ck') THEN
    ALTER TABLE fiscal.regra_tributaria
      ADD CONSTRAINT regra_tributaria_p_icms_efet_ck CHECK (p_icms_efet BETWEEN 0 AND 1000000);
  END IF;
END $$;

-- Só a linha do ICMS aceita p_dif e p_icms_efet: o CHECK da 0013 é recriado num comando só (um ALTER TABLE, sem
-- janela sem o CHECK), com as duas colunas no ramo que não é de ICMS. Validado na hora, sem NOT VALID.
ALTER TABLE fiscal.regra_tributaria
  DROP CONSTRAINT IF EXISTS regra_tributaria_so_o_tributo,
  ADD CONSTRAINT regra_tributaria_so_o_tributo CHECK (tributo = 'icms' OR (
    num_nonnulls(codigo, aliquota_icms, reducao_bc, p_cred_sn, mod_bc_st, mva_original, mva_ajustada, reducao_bc_st,
      aliquota_interna_destino, p_fcp, p_fcp_st, p_dif, p_icms_efet) = 0
    AND (tributo = 'ipi' OR num_nonnulls(cst_ipi, aliquota_ipi, valor_unidade_ipi) = 0)
    AND (tributo = 'pis' OR num_nonnulls(cst_pis, aliquota_pis, valor_unidade_pis) = 0)
    AND (tributo = 'cofins' OR num_nonnulls(cst_cofins, aliquota_cofins, valor_unidade_cofins) = 0)
    AND (tributo = 'ibs_cbs' OR num_nonnulls(cst_ibs_cbs, c_class_trib, p_ibs_uf, p_ibs_mun, p_cbs, p_red_ibs,
      p_red_cbs) = 0)
    AND (tributo = 'is' OR num_nonnulls(p_is, cst_is, c_class_trib_is, valor_unidade_is) = 0)));

COMMENT ON COLUMN fiscal.regra_tributaria.p_dif IS
  'pDif: percentual do diferimento do ICMS (CST 51), escala 4 (100% = 1000000); nulo = sem diferimento';
COMMENT ON COLUMN fiscal.regra_tributaria.p_icms_efet IS
  'pICMSEfet: alíquota do ICMS efetivo (CST 60 e CSOSN 500, consumidor final), escala 4 (18% = 180000); nulo = sem';
