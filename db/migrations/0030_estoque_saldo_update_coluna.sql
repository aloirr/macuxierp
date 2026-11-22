-- 0030 — UPDATE do macuxierp_worker em cadastros.estoque_saldo só na coluna quantidade (🟡 da revisão da 0029, T-0029). O app não muda. Restritiva e reexecutável. Detalhes em docs/banco/README.md (0030).

SET LOCAL lock_timeout = '5s';

REVOKE UPDATE ON cadastros.estoque_saldo FROM macuxierp_worker;
GRANT UPDATE (quantidade) ON cadastros.estoque_saldo TO macuxierp_worker;
