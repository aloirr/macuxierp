-- 0003 — Schema core: empresa, certificado A1 (cifrado), ambiente fiscal, parâmetros e exportação LGPD
-- (T-0003, lote 2; docs/desenho/T-0002.md, seção 6, D4 e D5; ADR 0005). O core não lê cadastros: filial_id é um UUID
-- opaco, sem FK (D4).

CREATE TABLE IF NOT EXISTS core.empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  razao_social text NOT NULL CHECK (length(razao_social) BETWEEN 2 AND 60),
  nome_fantasia text CHECK (length(nome_fantasia) <= 60),
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  ie text CHECK (length(ie) <= 14),
  fuso text NOT NULL DEFAULT 'America/Manaus',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT empresa_uma_por_tenant UNIQUE (tenant_id)
);
SELECT controle.preparar_tabela('core.empresa');

-- Certificado A1 (ADR 0005): .pfx e senha cifrados com AES-256-GCM pela API; a chave (MACUXIERP_CHAVE_A1) fica no
-- secret do servidor, nunca no banco. Só o worker lê as colunas cifradas (D5); o app grava e lê o resumo.
CREATE TABLE IF NOT EXISTS core.certificado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  titular text NOT NULL,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  valido_de timestamptz NOT NULL,
  valido_ate timestamptz NOT NULL,
  impressao_digital text NOT NULL CHECK (impressao_digital ~ '^[0-9a-f]{64}$'),
  pfx_cifrado bytea NOT NULL,
  pfx_nonce bytea NOT NULL CHECK (length(pfx_nonce) = 12),
  senha_cifrada bytea NOT NULL,
  senha_nonce bytea NOT NULL CHECK (length(senha_nonce) = 12),
  chave_versao integer NOT NULL DEFAULT 1 CHECK (chave_versao >= 1),
  ativo boolean NOT NULL DEFAULT true,
  substituido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT certificado_validade CHECK (valido_ate > valido_de),
  CONSTRAINT certificado_nonces_distintos CHECK (pfx_nonce <> senha_nonce)
);
SELECT controle.preparar_tabela('core.certificado');
CREATE UNIQUE INDEX IF NOT EXISTS certificado_um_ativo_por_filial ON core.certificado (tenant_id, filial_id)
  WHERE ativo AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS certificado_vencimento_idx ON core.certificado (valido_ate) WHERE ativo;

-- Ambiente fiscal por filial emissora (regra 7): sem linha = homologação. Produção só com o recado de aprovação do
-- Alexandre (RN-CORE-08); a API confere e o banco garante de novo.
CREATE TABLE IF NOT EXISTS core.ambiente_fiscal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  ambiente text NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao', 'producao')),
  recado_aprovacao text,
  alterado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, filial_id),
  CONSTRAINT ambiente_producao_aprovada CHECK (
    ambiente = 'homologacao'
    OR (recado_aprovacao IS NOT NULL AND recado_aprovacao ~ '^R-[0-9]{8}-[0-9]{6}(-[0-9]+)?-alexandre$'))
);
SELECT controle.preparar_tabela('core.ambiente_fiscal');

CREATE TABLE IF NOT EXISTS core.parametro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  chave text NOT NULL CHECK (chave ~ '^[a-z][a-z0-9_.]{1,79}$'),
  valor jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, chave)
);
SELECT controle.preparar_tabela('core.parametro');

-- Exportação dos dados do cliente (LGPD, RF-CORE-06): o worker gera o .zip e grava o plataforma.arquivo (arquivo_id é
-- opaco, sem FK entre schemas).
CREATE TABLE IF NOT EXISTS core.exportacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'gerando', 'pronta', 'falhou', 'expirada')),
  arquivo_id uuid,
  pedido_por uuid NOT NULL,
  concluida_em timestamptz,
  expira_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT exportacao_pronta_com_arquivo CHECK (estado <> 'pronta' OR arquivo_id IS NOT NULL)
);
SELECT controle.preparar_tabela('core.exportacao');

-- Privilégios. Certificado: o app nunca lê .pfx nem senha (só o resumo); a leitura não vê a tabela.
GRANT SELECT, INSERT, UPDATE ON core.empresa, core.ambiente_fiscal, core.parametro, core.exportacao TO macuxierp_app;
GRANT INSERT ON core.certificado TO macuxierp_app;
GRANT SELECT (id, tenant_id, filial_id, titular, cnpj, valido_de, valido_ate, impressao_digital, chave_versao, ativo,
  substituido_em, created_at, updated_at, deleted_at, external_id) ON core.certificado TO macuxierp_app;
GRANT UPDATE (ativo, substituido_em, deleted_at) ON core.certificado TO macuxierp_app;

GRANT SELECT, UPDATE ON core.certificado, core.exportacao TO macuxierp_worker;
GRANT SELECT ON core.empresa, core.ambiente_fiscal, core.parametro, core.exportacao TO macuxierp_worker,
  macuxierp_leitura;
