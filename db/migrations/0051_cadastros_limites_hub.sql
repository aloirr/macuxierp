-- 0051 — Limites do cadastros alinhados aos do Hub (/integracao/v1) (T-0057, v0.3.11, cenário B; decisão do Alexandre:
-- "entra nesta"). Aditiva e reexecutável: só alarga limites, então a versão anterior da API roda igual sobre o esquema
-- novo (o que ela grava, até 64 e 20, continua valendo). Não muda nenhuma linha de dado.
--
-- O que muda, só no schema cadastros (RN-CAD-08: o external_id é o código da carga; RN-CORE-05):
-- (a) external_id de toda tabela do schema (as 23 da 0004, 0005 e 0040) e o forma_external_id da condicao_pagamento
--     (segue o external_id desde a 0010): de 64 para 200;
-- (b) forma_codigo da condicao_pagamento (0010): de 20 para 30.
-- Os CHECKs sem nome do CREATE/ALTER TABLE (<tabela>_<coluna>_check, 'length(<coluna>) <= 64' ou '<= 20') saem, achados
-- pelo pg_constraint (pg_get_constraintdef), e entram CHECKs com nome: <tabela>_<coluna>_tamanho. Reexecutar não
-- muda nada: o CHECK antigo já saiu e o com nome só entra se faltar.
--
-- Fora do escopo (seguem em 64): plataforma, core, pedido, faturamento, fiscal, integracao_fdv e sefaz_simulador. Nenhuma
-- função do banco tem 64 ou 20 fixo para essas colunas (a carga do portal, 0040/0044/0046, só registra a execução; quem
-- grava os cadastros é o módulo, como macuxierp_app): nada de CREATE OR REPLACE aqui.
-- Pendência fora do banco: IdExternoValor (max 64) e forma_codigo (max 20) em modules/cadastros/contracts e a
-- validação CARGA_TAMANHO da carga (modulo-cadastros), por recado.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  -- [coluna, limite antigo, limite novo]; a tabela vem do pg_constraint (todas as do schema cadastros).
  v_regras text[][] := ARRAY[
    ARRAY['external_id', '64', '200'],
    ARRAY['forma_external_id', '64', '200'],
    ARRAY['forma_codigo', '20', '30']];
  v_regra text[];
  r record;
  v_nome text;
BEGIN
  FOREACH v_regra SLICE 1 IN ARRAY v_regras LOOP
    -- 1) Tira o CHECK antigo (qualquer nome) da coluna, nas tabelas do schema cadastros.
    FOR r IN
      SELECT c.conrelid::regclass AS tabela, c.conname
        FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'cadastros' AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) = format('CHECK ((length(%s) <= %s))', v_regra[1], v_regra[2])
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabela, r.conname);
    END LOOP;
    -- 2) Põe o CHECK com nome em toda tabela (não partição) do schema que tem a coluna, se ainda não tiver.
    FOR r IN
      SELECT t.oid, t.relname
        FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = v_regra[1] AND NOT a.attisdropped
       WHERE n.nspname = 'cadastros' AND t.relkind IN ('r', 'p') AND NOT t.relispartition
    LOOP
      v_nome := r.relname || '_' || v_regra[1] || '_tamanho';
      IF length(v_nome) > 63 THEN
        RAISE EXCEPTION 'nome de CHECK acima de 63 caracteres: %', v_nome;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.oid AND conname = v_nome) THEN
        EXECUTE format('ALTER TABLE cadastros.%I ADD CONSTRAINT %I CHECK (length(%I) <= %s)', r.relname, v_nome,
          v_regra[1], v_regra[3]);
      END IF;
    END LOOP;
  END LOOP;
END $$;
