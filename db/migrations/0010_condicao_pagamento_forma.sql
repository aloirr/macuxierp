-- 0010 — Forma de pagamento do kit do FDV em cadastros.condicao_pagamento (T-0026; docs/desenho/T-0026.md, D12 e
-- seção 6). Aditiva e reexecutável: colunas anuláveis, sem padrão, e um índice. A versão anterior da API roda igual.
-- A forma não é tabela própria: cada linha de prazo_pagamento.csv vira uma condição, e a forma dela fica nestes campos
-- (o forma_tpag já existe desde a 0004). Tamanhos: forma_external_id segue o external_id (D3, 64); código 20; nome 60.
-- RLS, política, trigger de updated_at e grants não mudam (os grants da 0004 são por tabela e cobrem as colunas novas).
ALTER TABLE cadastros.condicao_pagamento
  ADD COLUMN IF NOT EXISTS forma_external_id text CHECK (length(forma_external_id) <= 64),
  ADD COLUMN IF NOT EXISTS forma_codigo text CHECK (length(forma_codigo) <= 20),
  ADD COLUMN IF NOT EXISTS forma_nome text CHECK (length(forma_nome) <= 60);

-- A carga da forma_pagamento.csv atualiza todas as condições da forma pelo forma_external_id (seção 3.3).
CREATE INDEX IF NOT EXISTS condicao_pagamento_forma_external_id_ix
  ON cadastros.condicao_pagamento (tenant_id, forma_external_id) WHERE forma_external_id IS NOT NULL;
