-- 0001 — Base do banco macuxierp: papéis, schemas por módulo e funções comuns de RLS (T-0003, lote 1).
-- Roda como o admin do DBaaS (CREATEDB e CREATEROLE, sem superusuário). Aditiva e reexecutável.
-- Regras: CLAUDE.md (regra 5), docs/produto/04 ("Banco"), docs/desenho/T-0002.md (seção 6, D9) e docs/banco/README.md.

-- Papéis do cluster. Criados uma vez, já com os atributos finais: nenhuma migração faz ALTER ROLE de atributo (o DBaaS
-- não deixa). Sem senha aqui: a senha é do operador, no .env do servidor. Duas sessões criando ao mesmo tempo (testes em
-- paralelo) caem no EXCEPTION e seguem.
DO $$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', p);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

-- Só os três papéis entram no banco; o papel do FDV (e qualquer outro) não.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO macuxierp_app, macuxierp_worker, macuxierp_leitura',
    current_database());
END $$;

-- Um schema por módulo, mais a plataforma. "controle" é da migração (registro e funções de preparo): nenhum papel da
-- aplicação o enxerga.
CREATE SCHEMA IF NOT EXISTS controle;
CREATE SCHEMA IF NOT EXISTS plataforma;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS cadastros;
CREATE SCHEMA IF NOT EXISTS pedido;
CREATE SCHEMA IF NOT EXISTS faturamento;
CREATE SCHEMA IF NOT EXISTS fiscal;
CREATE SCHEMA IF NOT EXISTS integracao_fdv;
REVOKE ALL ON SCHEMA controle FROM PUBLIC;
GRANT USAGE ON SCHEMA plataforma, core, cadastros, pedido, faturamento, fiscal, integracao_fdv
  TO macuxierp_app, macuxierp_worker, macuxierp_leitura;

-- Tipos de coluna repetidos (um lugar só para o formato). CNPJ com 14 posições, já no formato alfanumérico da NT
-- 2025.001 (12 letras ou dígitos e 2 dígitos verificadores; o DV quem confere é a API). SHA-256 em hexadecimal minúsculo.
DO $$
BEGIN
  CREATE DOMAIN plataforma.cnpj AS text CHECK (VALUE ~ '^[0-9A-Z]{12}[0-9]{2}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
DO $$
BEGIN
  CREATE DOMAIN plataforma.sha256_hex AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Tenant da sessão: a API faz SET LOCAL app.tenant_id em toda transação (T-0002, seção 2). Sem ele, NULL: a RLS não
-- devolve nada de tenant nenhum (falha fechada). Valor que não é UUID dá erro, nunca "todos".
CREATE OR REPLACE FUNCTION plataforma.tenant_atual() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- Tenant de referência das tabelas oficiais (D9): todos leem, só a migração grava.
CREATE OR REPLACE FUNCTION plataforma.tenant_referencia() RETURNS uuid
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

CREATE OR REPLACE FUNCTION plataforma.tocar_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Tabela só de inserção (auditoria, movimento de estoque): UPDATE, DELETE e TRUNCATE falham para todos, dono incluso.
CREATE OR REPLACE FUNCTION plataforma.proibir_alteracao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é só de inserção (% recusado)', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Preparo padrão de toda tabela com tenant (regra 5): RLS ligada, política de isolamento, updated_at automático,
-- external_id único por tenant e a chave (tenant_id, id) para as FKs compostas (uma linha nunca aponta para outro tenant).
-- oficial = true: tabela do tenant de referência (D9), que todo tenant lê e nenhum papel da aplicação grava.
-- chave_composta = false: sem o índice (tenant_id, id), para a tabela em que ele repete a PK (plataforma.tenant).
CREATE OR REPLACE FUNCTION controle.preparar_tabela(tabela regclass, oficial boolean DEFAULT false,
  chave_composta boolean DEFAULT true) RETURNS void
  LANGUAGE plpgsql
  AS $$
DECLARE
  nome text := (SELECT relname FROM pg_class WHERE oid = tabela);
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tabela);
  EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON %s', tabela);
  IF oficial THEN
    EXECUTE format('CREATE POLICY isolamento_tenant ON %s USING (tenant_id = plataforma.tenant_referencia() '
      'OR tenant_id = plataforma.tenant_atual()) WITH CHECK (false)', tabela);
  ELSE
    EXECUTE format('CREATE POLICY isolamento_tenant ON %s USING (tenant_id = plataforma.tenant_atual()) '
      'WITH CHECK (tenant_id = plataforma.tenant_atual())', tabela);
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS tocar_updated_at ON %s', tabela);
  EXECUTE format('CREATE TRIGGER tocar_updated_at BEFORE UPDATE ON %s FOR EACH ROW '
    'EXECUTE FUNCTION plataforma.tocar_updated_at()', tabela);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (tenant_id, external_id) WHERE external_id IS NOT NULL',
    nome || '_external_id_uq', tabela);
  IF chave_composta THEN
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (tenant_id, id)', nome || '_tenant_id_uq', tabela);
  END IF;
END $$;

-- Liga a trava de "só inserção" numa tabela.
CREATE OR REPLACE FUNCTION controle.somente_insercao(tabela regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS somente_insercao ON %s', tabela);
  EXECUTE format('CREATE TRIGGER somente_insercao BEFORE UPDATE OR DELETE ON %s FOR EACH ROW '
    'EXECUTE FUNCTION plataforma.proibir_alteracao()', tabela);
  EXECUTE format('DROP TRIGGER IF EXISTS somente_insercao_truncate ON %s', tabela);
  EXECUTE format('CREATE TRIGGER somente_insercao_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT '
    'EXECUTE FUNCTION plataforma.proibir_alteracao()', tabela);
END $$;

-- Política extra para o despachante do worker, que varre a fila de todos os tenants (outbox e trabalhos, D10). As
-- políticas permissivas somam: o app e a leitura continuam presos ao próprio tenant.
CREATE OR REPLACE FUNCTION controle.worker_global(tabela regclass) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS worker_global ON %s', tabela);
  EXECUTE format('CREATE POLICY worker_global ON %s TO macuxierp_worker USING (true) WITH CHECK (true)', tabela);
END $$;
