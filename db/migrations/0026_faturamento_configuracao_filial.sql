-- 0026 — faturamento.configuracao_filial (bandeira faturamento_real_nfe_simulada, com histórico por gatilho) e
-- faturamento.titulo.conta_como_real, gravada na geração e imutável (T-0021, pedido do modulo-faturamento; a bandeira
-- diz se a filial conta como real o faturamento com a NF-e simulada, R-20261122-022626). Aditiva e reexecutável.
-- Detalhes em docs/banco/README.md (0026).

SET LOCAL lock_timeout = '5s';

-- ============================================================================================================
-- faturamento.configuracao_filial
-- Uma linha por filial (filial_id opaco); UNIQUE total e sem exclusão lógica (README, 0026).
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.configuracao_filial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  faturamento_real_nfe_simulada boolean NOT NULL DEFAULT false,
  alterado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT configuracao_filial_uq UNIQUE (tenant_id, filial_id),
  CONSTRAINT configuracao_filial_sem_exclusao_logica CHECK (deleted_at IS NULL)
);
SELECT controle.preparar_tabela('faturamento.configuracao_filial');

-- Histórico: só INSERT, gravado pelo gatilho AFTER da configuracao_filial (valor_anterior nulo no INSERT).
CREATE TABLE IF NOT EXISTS faturamento.configuracao_filial_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  configuracao_id uuid NOT NULL,
  filial_id uuid NOT NULL,
  valor_anterior boolean,
  valor_novo boolean NOT NULL,
  alterado_por uuid NOT NULL,
  alterado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT configuracao_filial_historico_sem_exclusao_logica CHECK (deleted_at IS NULL),
  FOREIGN KEY (tenant_id, configuracao_id) REFERENCES faturamento.configuracao_filial (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.configuracao_filial_historico');
SELECT controle.somente_insercao('faturamento.configuracao_filial_historico');
CREATE INDEX IF NOT EXISTS configuracao_filial_historico_config_idx
  ON faturamento.configuracao_filial_historico (tenant_id, configuracao_id, alterado_em);

-- BEFORE INSERT/UPDATE: alterado_por obrigatório (23514); no UPDATE só a bandeira e alterado_por mudam (o resto, 42501,
-- dono incluso; os GRANTs por coluna já barram o app).
CREATE OR REPLACE FUNCTION faturamento.configuracao_filial_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  k text;
BEGIN
  IF NEW.alterado_por IS NULL THEN
    RAISE EXCEPTION 'T-0021: alterado_por é obrigatório na configuração da filial' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['faturamento_real_nfe_simulada', 'alterado_por', 'updated_at']);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'T-0021: % da configuração da filial não muda', k USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS configuracao_filial_antes ON faturamento.configuracao_filial;
CREATE TRIGGER configuracao_filial_antes BEFORE INSERT OR UPDATE ON faturamento.configuracao_filial
  FOR EACH ROW EXECUTE FUNCTION faturamento.configuracao_filial_antes();
DROP TRIGGER IF EXISTS configuracao_filial_sem_exclusao ON faturamento.configuracao_filial;
CREATE TRIGGER configuracao_filial_sem_exclusao BEFORE DELETE ON faturamento.configuracao_filial
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();

-- AFTER INSERT/UPDATE: uma linha no histórico por INSERT e por UPDATE. SECURITY DEFINER (o app não tem INSERT no
-- histórico): grava só a linha derivada de OLD/NEW, com o tenant_id de NEW, que a RLS da configuracao_filial já
-- validou. Recusa rodar fora da configuracao_filial (TG_RELID) e não tem EXECUTE para PUBLIC, para ninguém a prender
-- num gatilho de tabela própria (temporária, por exemplo).
CREATE OR REPLACE FUNCTION faturamento.configuracao_filial_depois() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_RELID <> 'faturamento.configuracao_filial'::regclass OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'T-0021: configuracao_filial_depois só roda na faturamento.configuracao_filial'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO faturamento.configuracao_filial_historico (tenant_id, configuracao_id, filial_id, valor_anterior,
    valor_novo, alterado_por, alterado_em)
  VALUES (NEW.tenant_id, NEW.id, NEW.filial_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.faturamento_real_nfe_simulada END,
    NEW.faturamento_real_nfe_simulada, NEW.alterado_por, NEW.updated_at);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION faturamento.configuracao_filial_depois() FROM PUBLIC;
DROP TRIGGER IF EXISTS configuracao_filial_depois ON faturamento.configuracao_filial;
CREATE TRIGGER configuracao_filial_depois AFTER INSERT OR UPDATE ON faturamento.configuracao_filial
  FOR EACH ROW EXECUTE FUNCTION faturamento.configuracao_filial_depois();

-- Defesa extra: o histórico só entra pelo gatilho acima. O INSERT passa só se o papel corrente for o dono da
-- configuracao_filial_depois (o efeito do SECURITY DEFINER; comparado pelo proowner em tempo de execução, sem nome de
-- papel fixo) e dentro de um gatilho (pg_trigger_depth() >= 2). O resto, dono incluso no INSERT direto, cai com 42501.
CREATE OR REPLACE FUNCTION faturamento.configuracao_filial_historico_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF pg_catalog.pg_trigger_depth() < 2
     OR (SELECT p.proowner FROM pg_catalog.pg_proc p
         WHERE p.oid = 'faturamento.configuracao_filial_depois()'::pg_catalog.regprocedure)
        IS DISTINCT FROM (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION 'T-0021: o histórico da configuração da filial só é gravado pelo gatilho'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS configuracao_filial_historico_antes ON faturamento.configuracao_filial_historico;
CREATE TRIGGER configuracao_filial_historico_antes BEFORE INSERT ON faturamento.configuracao_filial_historico
  FOR EACH ROW EXECUTE FUNCTION faturamento.configuracao_filial_historico_antes();

COMMENT ON TABLE faturamento.configuracao_filial IS
  'Configuração do faturamento por filial (T-0021): faturamento_real_nfe_simulada diz se a filial conta como real o '
  'faturamento com a NF-e simulada. Uma linha por tenant e filial (filial_id opaco); sem linha = false (regra do '
  'código). alterado_por obrigatório (23514). Sem DELETE e sem exclusão lógica: desligar = gravar false. Todo INSERT e '
  'UPDATE vai para configuracao_filial_historico.';
COMMENT ON TABLE faturamento.configuracao_filial_historico IS
  'Histórico da configuracao_filial (T-0021): valor anterior (nulo no INSERT), novo, quem e quando. Só INSERT, pelo '
  'gatilho configuracao_filial_depois (SECURITY DEFINER); INSERT direto, UPDATE, DELETE e TRUNCATE recusados para '
  'todos.';

-- ============================================================================================================
-- faturamento.titulo.conta_como_real: copiada da bandeira da filial na geração do título e imutável depois (o
-- faturamento.titulo.baixado@1 não pode divergir se a bandeira mudar). O ADD com default constante não reescreve a
-- tabela e deixa as linhas existentes false; o DROP DEFAULT logo depois obriga todo INSERT novo a informar a coluna
-- (23502). A imutabilidade vem do titulo_antes da 0013 (coluna fora da lista do coluna_alterada: 42501).
-- ============================================================================================================
ALTER TABLE faturamento.titulo ADD COLUMN IF NOT EXISTS conta_como_real boolean NOT NULL DEFAULT false;
ALTER TABLE faturamento.titulo ALTER COLUMN conta_como_real DROP DEFAULT;
COMMENT ON COLUMN faturamento.titulo.conta_como_real IS
  'Título conta como faturamento real (cópia de configuracao_filial.faturamento_real_nfe_simulada na geração), '
  'obrigatória no INSERT (sem default) e imutável depois (42501, titulo_antes da 0013), para o titulo.baixado@1 não '
  'divergir se a bandeira mudar.';

-- ============================================================================================================
-- Privilégios: nenhum DELETE; detalhes no README (0026).
-- ============================================================================================================
GRANT SELECT, INSERT ON faturamento.configuracao_filial TO macuxierp_app;
GRANT UPDATE (faturamento_real_nfe_simulada, alterado_por) ON faturamento.configuracao_filial TO macuxierp_app;
GRANT SELECT ON faturamento.configuracao_filial TO macuxierp_worker, macuxierp_leitura;
GRANT SELECT ON faturamento.configuracao_filial_historico TO macuxierp_app, macuxierp_leitura;
