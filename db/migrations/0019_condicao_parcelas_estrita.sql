-- 0019 — parcelas do cartão: invariante estrita na condição e novo sentido de pedido.a_vista (T-0015). Aditiva e
-- reexecutável. Regras, motivo e a validação futura: docs/banco/README.md (0017 e 0019).

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

-- CHECK estrito NOT VALID (vale em INSERT e UPDATE; linha inativa fora). Motivo e validação futura: docs/banco/README.md (0019).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.condicao_pagamento'::regclass
                   AND conname = 'condicao_parcelas_cartao_forma_ck') THEN
    ALTER TABLE cadastros.condicao_pagamento
      ADD CONSTRAINT condicao_parcelas_cartao_forma_ck CHECK (
        deleted_at IS NOT NULL OR (parcelas_cartao IS NOT NULL) = (forma_tpag = '03')
      ) NOT VALID;
  END IF;
END $$;

-- Novo sentido de a_vista (troca o comentário da 0016).
COMMENT ON COLUMN pedido.pedido.a_vista IS
  'pedido fora do crédito do cliente (à vista ou cartão), gravado na criação, na edição e na aprovação';
