-- 0052 — prazo médio digitado no prazo de pagamento e no cliente (T-0085, v0.3.12; ADR 0020). Aditiva e reexecutável;
-- sem NOT NULL e sem backfill. Regras e motivo: docs/banco/README.md (0052).

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE cadastros.condicao_pagamento ADD COLUMN IF NOT EXISTS prazo_medio_dias integer;
ALTER TABLE cadastros.cliente ADD COLUMN IF NOT EXISTS prazo_medio_dias integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.condicao_pagamento'::regclass AND conname = 'condicao_prazo_medio_dias_ck') THEN
    ALTER TABLE cadastros.condicao_pagamento
      ADD CONSTRAINT condicao_prazo_medio_dias_ck CHECK (prazo_medio_dias BETWEEN 0 AND 999);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.cliente'::regclass AND conname = 'cliente_prazo_medio_dias_ck') THEN
    ALTER TABLE cadastros.cliente
      ADD CONSTRAINT cliente_prazo_medio_dias_ck CHECK (prazo_medio_dias BETWEEN 0 AND 999);
  END IF;

  -- À vista (FORMAS_A_VISTA do cadastros): prazo médio nulo ou 0; NOT VALID e linha inativa fora, como na 0019.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.condicao_pagamento'::regclass
                   AND conname = 'condicao_prazo_medio_a_vista_ck') THEN
    ALTER TABLE cadastros.condicao_pagamento
      ADD CONSTRAINT condicao_prazo_medio_a_vista_ck CHECK (
        deleted_at IS NOT NULL OR forma_tpag NOT IN ('01', '04', '17') OR coalesce(prazo_medio_dias, 0) = 0
      ) NOT VALID;
  END IF;
END $$;

-- Prazos que o cliente pode usar (prazo médio <= o do cliente; RN do pedido da T-0085).
CREATE INDEX IF NOT EXISTS condicao_pagamento_prazo_medio_ix ON cadastros.condicao_pagamento (tenant_id, prazo_medio_dias)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN cadastros.condicao_pagamento.prazo_medio_dias IS
  'Prazo médio digitado, em dias (0 a 999); à vista (tPag 01, 04, 17) = 0; NULL = prazo incompleto (legado antes da 0052), não sai ao FDV (T-0085)';
COMMENT ON COLUMN cadastros.cliente.prazo_medio_dias IS
  'Prazo médio máximo do cliente, em dias (0 a 999): usa os prazos com prazo médio <= este; NULL = não informado (legado antes da 0052) (T-0085)';
