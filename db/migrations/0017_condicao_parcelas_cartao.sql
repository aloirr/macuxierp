-- 0017 — parcelas do cartão na condição (T-0015). Regras, motivo e a divisão com a 0019: docs/banco/README.md.

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE cadastros.condicao_pagamento ADD COLUMN IF NOT EXISTS parcelas_cartao smallint NULL;

-- CHECK permissivo e validado (docs/banco/README.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.condicao_pagamento'::regclass
                   AND conname = 'condicao_parcelas_cartao_ck') THEN
    ALTER TABLE cadastros.condicao_pagamento
      ADD CONSTRAINT condicao_parcelas_cartao_ck CHECK (
        parcelas_cartao IS NULL OR (forma_tpag = '03' AND parcelas_cartao BETWEEN 1 AND 12)
      );
  END IF;
END $$;
