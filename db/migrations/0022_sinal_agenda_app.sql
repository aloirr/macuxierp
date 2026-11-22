-- 0022 (T-0011, L3; R-20261122-013506): o app atualiza só a agenda do sinal no próprio tenant (RLS). Aditiva e reexecutável. Detalhes: docs/banco/README.md (0022).
-- O updated_at entra no GRANT porque o modules/integracao-fdv grava `updated_at = now()` à mão em todo UPDATE do sinal
-- (sem ele, 42501). É inofensivo: o gatilho tocar_updated_at (BEFORE UPDATE, 0001) sobrescreve o valor mandado
-- pelo app com o relógio do banco (desde a 0006, greatest(clock_timestamp(), OLD.updated_at + 1 ms)).
GRANT UPDATE (proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em, updated_at)
  ON integracao_fdv.sinal TO macuxierp_app;
