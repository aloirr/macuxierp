-- 0041 — desconto máximo do produto e herança do desconto no item da tabela de preço (T-0058/T-0060, v0.3.6; RN-CAD-11).
-- cadastros.produto.desconto_maximo_bp: pontos-base (0 a 10.000 = 0% a 100%), NULL = não informado; base do preço mínimo =
-- preço de venda × (1 − desconto máximo), para cima ao centavo (como o FDV, RN-VEN-11).
-- cadastros.tabela_preco_item.desconto_herdado: true = o desconto_maximo_bp do item foi herdado da carga ou integração (FDV),
-- não digitado no ERP; backfill true nas linhas com external_id, só na criação da coluna (a reexecução não desfaz o que o
-- app gravou depois).
-- Aditiva e reexecutável. Grants por tabela (0004): as colunas novas entram sozinhas.

-- lock_timeout de 5 s: motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE cadastros.produto ADD COLUMN IF NOT EXISTS desconto_maximo_bp integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.produto'::regclass AND conname = 'produto_desconto_maximo_bp_ck') THEN
    ALTER TABLE cadastros.produto
      ADD CONSTRAINT produto_desconto_maximo_bp_ck CHECK (desconto_maximo_bp BETWEEN 0 AND 10000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'cadastros.tabela_preco_item'::regclass AND attname = 'desconto_herdado'
                   AND NOT attisdropped) THEN
    ALTER TABLE cadastros.tabela_preco_item ADD COLUMN desconto_herdado boolean NOT NULL DEFAULT false;
    -- O backfill não é mudança de cadastro: o updated_at fica como estava.
    ALTER TABLE cadastros.tabela_preco_item DISABLE TRIGGER tocar_updated_at;
    UPDATE cadastros.tabela_preco_item SET desconto_herdado = true WHERE external_id IS NOT NULL;
    ALTER TABLE cadastros.tabela_preco_item ENABLE TRIGGER tocar_updated_at;
  END IF;
END $$;

COMMENT ON COLUMN cadastros.produto.desconto_maximo_bp IS
  'Desconto máximo do produto em pontos-base (0 a 10000 = 0% a 100%; NULL = não informado); base do preço mínimo (RN-CAD-11)';
COMMENT ON COLUMN cadastros.tabela_preco_item.desconto_herdado IS
  'true = desconto_maximo_bp do item herdado da carga ou integração (FDV), não digitado no ERP; com external_id antes da 0041 = true (RN-CAD-11)';
