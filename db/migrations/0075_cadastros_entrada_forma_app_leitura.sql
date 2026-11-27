-- 0075 — cadastros.entrada_forma só leitura para o macuxierp_app (v0.3.19, revisão do #790). Reexecutável. Motivo em docs/banco/README.md (0075).

SET LOCAL lock_timeout = '5s';

REVOKE INSERT, UPDATE ON cadastros.entrada_forma FROM macuxierp_app;
