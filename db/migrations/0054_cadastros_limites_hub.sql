-- 0054 — limites do Hub no cadastros (T-0092, ADR 0019 opção A): external_id e forma_external_id até 200 (eram 64) e
-- forma_codigo até 30 (era 20). Aditiva e reexecutável; só alarga CHECK, sem reescrever dado. Como e por que:
-- docs/banco/README.md (0054).

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  r record;
  v_rel regclass;
  v_nome text;
  v_velho text;
BEGIN
  FOR r IN
    SELECT v.tabela, v.coluna, v.antes, v.depois FROM (VALUES
      ('carga_portal', 'external_id', 64, 200),
      ('cest', 'external_id', 64, 200),
      ('cest_ncm', 'external_id', 64, 200),
      ('cfop', 'external_id', 64, 200),
      ('classificacao_tributaria', 'external_id', 64, 200),
      ('cliente', 'external_id', 64, 200),
      ('cliente_contato', 'external_id', 64, 200),
      ('cliente_endereco', 'external_id', 64, 200),
      ('condicao_pagamento', 'external_id', 64, 200),
      ('condicao_pagamento', 'forma_external_id', 64, 200),
      ('condicao_pagamento', 'forma_codigo', 20, 30),
      ('consulta_externa', 'external_id', 64, 200),
      ('cst', 'external_id', 64, 200),
      ('estoque_movimento', 'external_id', 64, 200),
      ('estoque_saldo', 'external_id', 64, 200),
      ('filial', 'external_id', 64, 200),
      ('municipio', 'external_id', 64, 200),
      ('ncm', 'external_id', 64, 200),
      ('produto', 'external_id', 64, 200),
      ('produto_unidade', 'external_id', 64, 200),
      ('tabela_oficial_versao', 'external_id', 64, 200),
      ('tabela_preco', 'external_id', 64, 200),
      ('tabela_preco_item', 'external_id', 64, 200),
      ('uf', 'external_id', 64, 200),
      ('vendedor', 'external_id', 64, 200)
    ) AS v(tabela, coluna, antes, depois)
  LOOP
    v_rel := format('cadastros.%I', r.tabela)::regclass;
    v_nome := format('%s_%s_check', r.tabela, r.coluna);
    FOR v_velho IN
      SELECT k.conname FROM pg_constraint k
       WHERE k.conrelid = v_rel AND k.contype = 'c'
         AND pg_get_constraintdef(k.oid) = format('CHECK ((length(%I) <= %s))', r.coluna, r.antes)
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_rel, v_velho);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = v_rel AND k.conname = v_nome) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (length(%I) <= %s) NOT VALID', v_rel, v_nome, r.coluna, r.depois);
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', v_rel, v_nome);
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN cadastros.condicao_pagamento.forma_codigo IS
  'Código da forma de pagamento do Hub (até 30, LIMITE_CODIGO_FORMA_PAGAMENTO do hub-v1; 0054, ADR 0019)';
COMMENT ON COLUMN cadastros.condicao_pagamento.forma_external_id IS
  'external_id da forma de pagamento do Hub (até 200, EXTERNAL_ID_MAX do hub-v1; 0054, ADR 0019)';
