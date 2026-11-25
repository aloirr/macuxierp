-- 0064 — o macuxierp_worker cria o cliente do pré-cadastro do FDV (porta CriadorClienteFdv, T-0059): INSERT no cliente,
-- no endereço e no contato. Sem UPDATE e sem DELETE; RLS por tenant (isolamento_tenant), sem worker_global. Aditiva e
-- reexecutável. O porquê: docs/banco/README.md, seção da 0064.

SET LOCAL lock_timeout = '5s';

GRANT INSERT ON cadastros.cliente, cadastros.cliente_endereco, cadastros.cliente_contato TO macuxierp_worker;
