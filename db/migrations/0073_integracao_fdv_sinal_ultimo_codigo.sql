-- 0073 — integracao_fdv.sinal.ultimo_codigo (v0.3.18). O worker já tem UPDATE (0007); a RLS não muda. Aditiva e reexecutável. Motivo em docs/banco/README.md (0073).

SET LOCAL lock_timeout = '5s';

ALTER TABLE integracao_fdv.sinal ADD COLUMN IF NOT EXISTS ultimo_codigo text CONSTRAINT sinal_ultimo_codigo_check CHECK (ultimo_codigo ~ '^[a-z0-9_]{1,80}$');

COMMENT ON COLUMN integracao_fdv.sinal.ultimo_codigo IS
  'Código do Hub ou http_<status> da última falha do sinal (0073, v0.3.18); nulo sem falha registrada.';
