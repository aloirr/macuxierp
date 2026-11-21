-- 0005 — Tabelas oficiais no schema cadastros (T-0003, lote 2; docs/desenho/T-0002.md, D9; RF-CAD-10): UF, município
-- (IBGE), NCM, CEST (+ CEST × NCM), CFOP, CST/CSOSN (ICMS, IPI, PIS, COFINS, IBS/CBS e IS) e cClassTrib, no tenant de
-- referência. A carga versionada e as fontes: docs/banco/tabelas-oficiais.md.

CREATE TABLE IF NOT EXISTS cadastros.tabela_oficial_versao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  tabela text NOT NULL CHECK (tabela ~ '^[a-z][a-z0-9_]{1,59}$'),
  carga text NOT NULL CHECK (carga ~ '^[a-z][a-z0-9_-]{1,59}$'),
  versao text NOT NULL CHECK (length(versao) BETWEEN 1 AND 40),
  fonte text NOT NULL,
  url text NOT NULL,
  data_referencia date NOT NULL,
  arquivo text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  registros integer NOT NULL CHECK (registros >= 0),
  carregada_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (carga, versao)
);
SELECT controle.preparar_tabela('cadastros.tabela_oficial_versao', true);

-- Colunas comuns: as da regra 5, a vigência e a versão de origem (versao_id).
CREATE TABLE IF NOT EXISTS cadastros.uf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{2}$'),
  sigla text NOT NULL CHECK (sigla ~ '^[A-Z]{2}$'),
  nome text NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.uf', true);

CREATE TABLE IF NOT EXISTS cadastros.municipio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{7}$'),
  nome text NOT NULL,
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.municipio', true);
CREATE INDEX IF NOT EXISTS municipio_uf_idx ON cadastros.municipio (uf, nome);

CREATE TABLE IF NOT EXISTS cadastros.ncm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{8}$'),
  descricao text NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.ncm', true);

CREATE TABLE IF NOT EXISTS cadastros.cest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{7}$'),
  descricao text NOT NULL,
  segmento text NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.cest', true);

-- CEST × NCM (RN-CAD-04): o convênio lista posições, subposições ou itens; o NCM do produto casa por prefixo.
CREATE TABLE IF NOT EXISTS cadastros.cest_ncm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  cest_codigo text NOT NULL CHECK (cest_codigo ~ '^[0-9]{7}$'),
  ncm_prefixo text NOT NULL CHECK (ncm_prefixo ~ '^[0-9]{2,8}$'),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, cest_codigo, ncm_prefixo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.cest_ncm', true);
CREATE INDEX IF NOT EXISTS cest_ncm_prefixo_idx ON cadastros.cest_ncm (ncm_prefixo);

CREATE TABLE IF NOT EXISTS cadastros.cfop (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (codigo ~ '^[1-7][0-9]{3}$'),
  descricao text NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.cfop', true);

CREATE TABLE IF NOT EXISTS cadastros.cst (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('icms', 'csosn', 'ipi', 'pis', 'cofins', 'ibs_cbs', 'is')),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{2,3}$'),
  descricao text NOT NULL,
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, tipo, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.cst', true);

-- cClassTrib do IBS/CBS e do IS (IT 2025.002). detalhes: reduções, crédito, grupos do XML e DF-e aceitos, como na fonte.
CREATE TABLE IF NOT EXISTS cadastros.classificacao_tributaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('ibs_cbs', 'is')),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{6}$'),
  cst text NOT NULL CHECK (cst ~ '^[0-9]{3}$'),
  nome text NOT NULL,
  descricao text NOT NULL,
  tipo_aliquota text,
  detalhes jsonb NOT NULL DEFAULT '{}',
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, tipo, codigo, vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.classificacao_tributaria', true);

-- Aborta a carga (usada pelo script da carga versionada, que roda como admin).
CREATE OR REPLACE FUNCTION controle.falhar(mensagem text) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '%', mensagem;
END $$;

-- Só leitura para os três papéis (a política de gravação é WITH CHECK (false) e não há GRANT de escrita).
GRANT SELECT ON cadastros.tabela_oficial_versao, cadastros.uf, cadastros.municipio, cadastros.ncm, cadastros.cest,
  cadastros.cest_ncm, cadastros.cfop, cadastros.cst, cadastros.classificacao_tributaria
  TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
