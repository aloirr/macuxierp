-- 0002 — Schema plataforma: tenant, licença, usuário, sessão, outbox, trabalhos, idempotência, auditoria e arquivos
-- (T-0003, lote 1; desenho em docs/desenho/T-0002.md, seção 6, D1, D2, D10 e D12). Desbloqueia a T-0004.
-- Colunas comuns (regra 5) em toda tabela; datas em UTC (timestamptz); dinheiro em centavos (bigint), quando houver.

CREATE TABLE IF NOT EXISTS plataforma.tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  fuso text NOT NULL DEFAULT 'America/Manaus',
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'suspenso', 'encerrado', 'referencia')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT tenant_tenant_id_igual_id CHECK (tenant_id = id)
);
-- Sem a chave (tenant_id, id): aqui tenant_id = id, e a PK já cobre.
SELECT controle.preparar_tabela('plataforma.tenant', chave_composta => false);

-- Tenant de referência das tabelas oficiais (D9).
INSERT INTO plataforma.tenant (id, tenant_id, slug, nome, situacao)
VALUES (plataforma.tenant_referencia(), plataforma.tenant_referencia(), 'referencia', 'Tabelas oficiais', 'referencia')
ON CONFLICT (id) DO NOTHING;

-- Licença por módulo (D12): o tenant só lê; muda pelo script do operador (scripts/plataforma/licenca.mjs, T-0004),
-- que roda como admin e audita.
CREATE TABLE IF NOT EXISTS plataforma.tenant_modulo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  modulo text NOT NULL CHECK (modulo IN ('core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv')),
  ativo boolean NOT NULL DEFAULT true,
  valido_ate timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, modulo)
);
SELECT controle.preparar_tabela('plataforma.tenant_modulo');

-- Usuário por tenant (D1, D2): o e-mail é único dentro da empresa e gravado já normalizado (minúsculas, sem espaços
-- nas pontas); a API normaliza antes de gravar e de buscar. Perfis fixos (RN-CORE-01), um por usuário.
CREATE TABLE IF NOT EXISTS plataforma.usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%' AND length(email) <= 254),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  senha_hash text NOT NULL CHECK (senha_hash LIKE '$argon2id$%'),
  perfil text NOT NULL CHECK (perfil IN ('administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura')),
  filial_ids uuid[] NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  falhas_login integer NOT NULL DEFAULT 0 CHECK (falhas_login >= 0),
  bloqueado_ate timestamptz,
  ultimo_acesso_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, email)
);
SELECT controle.preparar_tabela('plataforma.usuario');

-- Sessão com refresh rotativo: só o SHA-256 do refresh; a família inteira é revogada no reuso.
CREATE TABLE IF NOT EXISTS plataforma.sessao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  usuario_id uuid NOT NULL,
  familia uuid NOT NULL,
  refresh_hash plataforma.sha256_hex NOT NULL UNIQUE,
  expira_em timestamptz NOT NULL,
  revogada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  FOREIGN KEY (tenant_id, usuario_id) REFERENCES plataforma.usuario (tenant_id, id)
);
SELECT controle.preparar_tabela('plataforma.sessao');
CREATE INDEX IF NOT EXISTS sessao_familia_idx ON plataforma.sessao (tenant_id, familia);

-- Outbox (D6, D10): gravada na mesma transação da mudança; o worker despacha em ordem de ocorrido_em por agregado.
CREATE TABLE IF NOT EXISTS plataforma.evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nome text NOT NULL CHECK (nome ~ '^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@v?[0-9]+$'),
  agregado_id uuid NOT NULL,
  versao bigint NOT NULL CHECK (versao >= 1),
  payload jsonb NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  publicado_em timestamptz,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proximo_em timestamptz NOT NULL DEFAULT now(),
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, nome, agregado_id, versao)
);
SELECT controle.preparar_tabela('plataforma.evento');
SELECT controle.worker_global('plataforma.evento');
CREATE INDEX IF NOT EXISTS evento_pendente_idx ON plataforma.evento (proximo_em, ocorrido_em) WHERE publicado_em IS NULL;
CREATE INDEX IF NOT EXISTS evento_agregado_idx ON plataforma.evento (tenant_id, agregado_id, ocorrido_em);

-- Idempotência do consumidor: um evento processado uma vez por consumidor.
CREATE TABLE IF NOT EXISTS plataforma.evento_consumido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  consumidor text NOT NULL CHECK (length(consumidor) BETWEEN 2 AND 80),
  evento_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (consumidor, evento_id),
  FOREIGN KEY (tenant_id, evento_id) REFERENCES plataforma.evento (tenant_id, id)
);
SELECT controle.preparar_tabela('plataforma.evento_consumido');
SELECT controle.worker_global('plataforma.evento_consumido');

-- Fila de trabalhos no próprio PostgreSQL (D10: FOR UPDATE SKIP LOCKED): consulta de IE, exportação LGPD...
CREATE TABLE IF NOT EXISTS plataforma.trabalho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z][a-z0-9_.-]{1,59}$'),
  payload jsonb NOT NULL DEFAULT '{}',
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'em_andamento', 'concluido', 'falhou')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proximo_em timestamptz NOT NULL DEFAULT now(),
  resultado jsonb,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64)
);
SELECT controle.preparar_tabela('plataforma.trabalho');
SELECT controle.worker_global('plataforma.trabalho');
CREATE INDEX IF NOT EXISTS trabalho_pendente_idx ON plataforma.trabalho (proximo_em) WHERE estado = 'pendente';

-- Idempotency-Key (RN-CORE-05), guardada por 24 h.
CREATE TABLE IF NOT EXISTS plataforma.idempotencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  chave text NOT NULL CHECK (length(chave) BETWEEN 8 AND 128),
  rota text NOT NULL,
  hash_corpo plataforma.sha256_hex NOT NULL,
  status integer,
  resposta jsonb,
  expira_em timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, chave, rota)
);
SELECT controle.preparar_tabela('plataforma.idempotencia');
SELECT controle.worker_global('plataforma.idempotencia');
CREATE INDEX IF NOT EXISTS idempotencia_expira_idx ON plataforma.idempotencia (expira_em);

-- Auditoria (RF-CORE-05): só inserção.
CREATE TABLE IF NOT EXISTS plataforma.auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  usuario_id uuid,
  acao text NOT NULL,
  entidade text NOT NULL,
  entidade_id uuid,
  antes jsonb,
  depois jsonb,
  request_id text,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64)
);
SELECT controle.preparar_tabela('plataforma.auditoria');
SELECT controle.somente_insercao('plataforma.auditoria');
CREATE INDEX IF NOT EXISTS auditoria_entidade_idx ON plataforma.auditoria (tenant_id, entidade, ocorrido_em);

-- Arquivos no S3 (prefixo macuxierp/<tenant>/). Imutável (XML autorizado, regra 7): chave, hash e tamanho não mudam e a
-- linha não sai antes de guarda_ate.
CREATE TABLE IF NOT EXISTS plataforma.arquivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  chave_s3 text NOT NULL CHECK (chave_s3 LIKE 'macuxierp/%'),
  tipo text NOT NULL,
  sha256 plataforma.sha256_hex NOT NULL,
  tamanho bigint NOT NULL CHECK (tamanho >= 0),
  imutavel boolean NOT NULL DEFAULT false,
  guarda_ate date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, chave_s3),
  CONSTRAINT arquivo_imutavel_com_guarda CHECK (NOT imutavel OR guarda_ate IS NOT NULL)
);
SELECT controle.preparar_tabela('plataforma.arquivo');

CREATE OR REPLACE FUNCTION plataforma.proteger_arquivo_imutavel() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.imutavel THEN
      RAISE EXCEPTION 'arquivo imutável % não pode ser apagado', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.imutavel AND (NEW.chave_s3, NEW.sha256, NEW.tamanho, NEW.tipo, NEW.tenant_id, NEW.imutavel, NEW.deleted_at)
      IS DISTINCT FROM (OLD.chave_s3, OLD.sha256, OLD.tamanho, OLD.tipo, OLD.tenant_id, OLD.imutavel, OLD.deleted_at)
      OR NEW.guarda_ate < OLD.guarda_ate THEN
    RAISE EXCEPTION 'arquivo imutável % não pode ser alterado', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS proteger_arquivo_imutavel ON plataforma.arquivo;
CREATE TRIGGER proteger_arquivo_imutavel BEFORE UPDATE OR DELETE ON plataforma.arquivo
  FOR EACH ROW EXECUTE FUNCTION plataforma.proteger_arquivo_imutavel();

-- Login (T-0004): antes de haver tenant na sessão, a API descobre o tenant pelo slug. SECURITY DEFINER (dono da tabela,
-- sem FORCE RLS) e só o id do tenant ativo; nada mais escapa da RLS.
CREATE OR REPLACE FUNCTION plataforma.tenant_por_slug(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT id FROM plataforma.tenant
  WHERE slug = lower(btrim(p_slug)) AND situacao = 'ativo' AND deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION plataforma.tenant_por_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.tenant_por_slug(text) TO macuxierp_app;

-- Privilégios (T-0002, seção 6). Sem DELETE para o app, salvo sessão e idempotência (a exclusão de negócio é
-- deleted_at). Licença e tenant: só leitura (D12).
GRANT SELECT ON plataforma.tenant, plataforma.tenant_modulo TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
GRANT SELECT, INSERT, UPDATE ON plataforma.usuario, plataforma.trabalho, plataforma.arquivo TO macuxierp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON plataforma.sessao, plataforma.idempotencia TO macuxierp_app;
GRANT SELECT, INSERT ON plataforma.evento, plataforma.evento_consumido, plataforma.auditoria TO macuxierp_app;

GRANT SELECT, INSERT ON plataforma.evento, plataforma.evento_consumido, plataforma.auditoria TO macuxierp_worker;
GRANT UPDATE (publicado_em, tentativas, proximo_em, erro) ON plataforma.evento TO macuxierp_worker;
GRANT SELECT, INSERT, UPDATE ON plataforma.trabalho, plataforma.arquivo TO macuxierp_worker;
GRANT SELECT, DELETE ON plataforma.idempotencia TO macuxierp_worker;

-- Leitura (diagnóstico) e worker (exportação LGPD): sem sessão e sem o hash da senha.
GRANT SELECT ON plataforma.evento, plataforma.evento_consumido, plataforma.trabalho, plataforma.auditoria,
  plataforma.arquivo TO macuxierp_leitura;
-- Idempotência: a leitura não vê a resposta guardada, que pode trazer dado pessoal (LGPD, regra 8).
GRANT SELECT (id, tenant_id, chave, rota, hash_corpo, status, expira_em, created_at, updated_at, deleted_at,
  external_id) ON plataforma.idempotencia TO macuxierp_leitura;
GRANT SELECT (id, tenant_id, email, nome, perfil, filial_ids, ativo, falhas_login, bloqueado_ate, ultimo_acesso_em,
  created_at, updated_at, deleted_at, external_id) ON plataforma.usuario TO macuxierp_worker, macuxierp_leitura;
