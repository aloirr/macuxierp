-- 0064 — o macuxierp_worker cria o cliente do pré-cadastro do FDV (T-0059) e a empresa da filial padrão (T-0100): só INSERT.
-- O porquê: docs/banco/README.md, seção da 0064.

SET LOCAL lock_timeout = '5s';

GRANT INSERT ON cadastros.cliente, cadastros.cliente_endereco, cadastros.cliente_contato TO macuxierp_worker;
GRANT INSERT ON core.empresa TO macuxierp_worker;
