-- 0023 — cadastros.filial.regime_pis_cofins e cadastros.produto.producao_propria (T-0021, recado R-20261122-020606 do
-- modulo-cadastros). Aditiva e reexecutável. O default constante de producao_propria não reescreve a tabela (PG 11+).
-- Grants de filial e produto são por tabela (0004: app SELECT/INSERT/UPDATE; worker e leitura SELECT): as colunas novas
-- entram sozinhas. A visão cadastros.filial_resumo lista colunas e não precisa das novas.

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE cadastros.filial ADD COLUMN IF NOT EXISTS regime_pis_cofins text;
ALTER TABLE cadastros.produto ADD COLUMN IF NOT EXISTS producao_propria boolean NOT NULL DEFAULT false;

-- CHECK nomeado, idempotente por pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.filial'::regclass AND conname = 'filial_regime_pis_cofins_ck') THEN
    ALTER TABLE cadastros.filial
      ADD CONSTRAINT filial_regime_pis_cofins_ck CHECK (regime_pis_cofins IN ('cumulativo', 'nao_cumulativo'));
  END IF;
END $$;

COMMENT ON COLUMN cadastros.filial.regime_pis_cofins IS
  'Regime do PIS/COFINS da filial: cumulativo ou nao_cumulativo; nulo = não informado';
COMMENT ON COLUMN cadastros.produto.producao_propria IS
  'Produto de fabricação própria do tenant (true) ou revenda (false, o padrão)';
