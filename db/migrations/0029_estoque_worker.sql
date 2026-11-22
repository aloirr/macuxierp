-- 0029 — o macuxierp_worker grava estoque como o app (consumidor cadastros.estoque-nota, T-0029): saldo INSERT/UPDATE, movimento só INSERT; RLS por tenant, sem worker_global. Aditiva e reexecutável. Detalhes em docs/banco/README.md (0029).

SET LOCAL lock_timeout = '5s';

GRANT INSERT, UPDATE ON cadastros.estoque_saldo TO macuxierp_worker;
GRANT INSERT ON cadastros.estoque_movimento TO macuxierp_worker;
