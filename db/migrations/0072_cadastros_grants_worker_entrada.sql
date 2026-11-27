-- 0072 — o macuxierp_worker grava o lote da /entrada/v1 (T-0057, modules/cadastros/api/entrada-lote.ts) nos cadastros:
-- INSERT e UPDATE, sem DELETE (exclusão = deleted_at, RN-CAD-08). Os ids são gen_random_uuid(): sem sequence, sem USAGE.
-- O estoque fica como está (0029/0030). A RLS por tenant continua valendo. Aditiva e reexecutável. Motivo em docs/banco/README.md (0072).

SET LOCAL lock_timeout = '5s';

GRANT INSERT, UPDATE ON cadastros.vendedor, cadastros.filial, cadastros.condicao_pagamento, cadastros.produto,
  cadastros.produto_unidade, cadastros.tabela_preco, cadastros.tabela_preco_item, cadastros.cliente,
  cadastros.cliente_endereco, cadastros.cliente_contato TO macuxierp_worker;
