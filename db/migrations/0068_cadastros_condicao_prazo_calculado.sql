-- 0068 — Prazo médio calculado na condição de pagamento e UPDATE por coluna ao worker (T-0108, v0.3.16).
-- Aditiva e reexecutável. O porquê: docs/banco/README.md, seção da 0068.

SET LOCAL lock_timeout = '5s';

ALTER TABLE cadastros.condicao_pagamento ADD COLUMN IF NOT EXISTS prazo_medio_calculado boolean NOT NULL DEFAULT false;

GRANT UPDATE (prazo_medio_dias, prazo_medio_calculado, updated_at) ON cadastros.condicao_pagamento TO macuxierp_worker;

COMMENT ON COLUMN cadastros.condicao_pagamento.prazo_medio_calculado IS
  'true = prazo_medio_dias calculado pela média das parcelas (RN-CAD-15); false = digitado ou legado (T-0108).';
