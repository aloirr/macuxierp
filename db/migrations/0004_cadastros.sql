-- 0004 — Schema cadastros: filial, cliente, produto, preço, estoque, condição de pagamento, vendedor e cache de
-- consultas externas (T-0003, lote 2; docs/desenho/T-0002.md, seção 6, D7, D8 e D11).
-- Dinheiro em centavos (bigint); quantidade em bigint com escala 4 (× 10^4, D11); percentual em pontos-base.
-- FKs compostas com tenant_id: uma linha nunca aponta para cadastro de outro tenant.

-- Filial (RF-CAD-08). D8: guarda só a configuração inicial da NF-e (série e número inicial); a numeração é do
-- faturamento (RN-FAT-01).
CREATE TABLE IF NOT EXISTS cadastros.filial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  ie text CHECK (length(ie) <= 14),
  razao_social text NOT NULL CHECK (length(razao_social) BETWEEN 2 AND 60),
  nome_fantasia text CHECK (length(nome_fantasia) <= 60),
  crt text NOT NULL CHECK (crt IN ('1', '2', '3', '4')),
  logradouro text NOT NULL CHECK (length(logradouro) <= 60),
  numero text NOT NULL CHECK (length(numero) <= 60),
  complemento text CHECK (length(complemento) <= 60),
  bairro text NOT NULL CHECK (length(bairro) <= 60),
  municipio_ibge text NOT NULL CHECK (municipio_ibge ~ '^[0-9]{7}$'),
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  cep text NOT NULL CHECK (cep ~ '^[0-9]{8}$'),
  pais_bacen text NOT NULL DEFAULT '1058' CHECK (pais_bacen ~ '^[0-9]{1,4}$'),
  padrao boolean NOT NULL DEFAULT false,
  emissora boolean NOT NULL DEFAULT false,
  nfe_serie smallint CHECK (nfe_serie BETWEEN 0 AND 999),
  nfe_numero_inicial integer CHECK (nfe_numero_inicial BETWEEN 1 AND 999999999),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64)
);
SELECT controle.preparar_tabela('cadastros.filial');
CREATE UNIQUE INDEX IF NOT EXISTS filial_cnpj_uq ON cadastros.filial (tenant_id, cnpj) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS filial_uma_padrao ON cadastros.filial (tenant_id) WHERE padrao AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cadastros.condicao_pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 20),
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 60),
  forma_tpag text NOT NULL CHECK (forma_tpag ~ '^[0-9]{2}$'),
  prazos_dias integer[] NOT NULL CHECK (cardinality(prazos_dias) >= 1 AND 0 <= ALL (prazos_dias)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo)
);
SELECT controle.preparar_tabela('cadastros.condicao_pagamento');

CREATE TABLE IF NOT EXISTS cadastros.tabela_preco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  padrao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT tabela_preco_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
SELECT controle.preparar_tabela('cadastros.tabela_preco');
CREATE UNIQUE INDEX IF NOT EXISTS tabela_preco_uma_padrao ON cadastros.tabela_preco (tenant_id)
  WHERE padrao AND deleted_at IS NULL;

-- Vendedor (RF-CAD-07). usuario_id aponta para plataforma.usuario sem FK entre schemas (opaco).
CREATE TABLE IF NOT EXISTS cadastros.vendedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 20),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  filial_id uuid NOT NULL,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo),
  FOREIGN KEY (tenant_id, filial_id) REFERENCES cadastros.filial (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.vendedor');
CREATE UNIQUE INDEX IF NOT EXISTS vendedor_usuario_uq ON cadastros.vendedor (tenant_id, usuario_id)
  WHERE usuario_id IS NOT NULL AND deleted_at IS NULL;

-- Cliente (RF-CAD-01). Carteira = vendedor_id (D7).
CREATE TABLE IF NOT EXISTS cadastros.cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo_pessoa text NOT NULL CHECK (tipo_pessoa IN ('PJ', 'PF')),
  documento text NOT NULL,
  ie text CHECK (length(ie) <= 14),
  ind_ie_dest text NOT NULL CHECK (ind_ie_dest IN ('1', '2', '9')),
  razao_social text NOT NULL CHECK (length(razao_social) BETWEEN 2 AND 60),
  nome_fantasia text CHECK (length(nome_fantasia) <= 60),
  email_nfe text CHECK (length(email_nfe) <= 254),
  limite_credito_centavos bigint NOT NULL DEFAULT 0 CHECK (limite_credito_centavos >= 0),
  condicao_pagamento_id uuid,
  tabela_preco_id uuid,
  filial_id uuid NOT NULL,
  vendedor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT cliente_documento_formato CHECK (
    (tipo_pessoa = 'PJ' AND documento ~ '^[0-9A-Z]{12}[0-9]{2}$') OR (tipo_pessoa = 'PF' AND documento ~ '^[0-9]{11}$')),
  FOREIGN KEY (tenant_id, condicao_pagamento_id) REFERENCES cadastros.condicao_pagamento (tenant_id, id),
  FOREIGN KEY (tenant_id, tabela_preco_id) REFERENCES cadastros.tabela_preco (tenant_id, id),
  FOREIGN KEY (tenant_id, filial_id) REFERENCES cadastros.filial (tenant_id, id),
  FOREIGN KEY (tenant_id, vendedor_id) REFERENCES cadastros.vendedor (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.cliente');
CREATE UNIQUE INDEX IF NOT EXISTS cliente_documento_uq ON cadastros.cliente (tenant_id, documento) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cliente_vendedor_idx ON cadastros.cliente (tenant_id, vendedor_id);

CREATE TABLE IF NOT EXISTS cadastros.cliente_endereco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  cliente_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('principal', 'entrega', 'cobranca')),
  logradouro text NOT NULL CHECK (length(logradouro) <= 60),
  numero text NOT NULL CHECK (length(numero) <= 60),
  complemento text CHECK (length(complemento) <= 60),
  bairro text NOT NULL CHECK (length(bairro) <= 60),
  municipio_ibge text NOT NULL CHECK (municipio_ibge ~ '^[0-9]{7}$'),
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  cep text NOT NULL CHECK (cep ~ '^[0-9]{8}$'),
  pais_bacen text NOT NULL DEFAULT '1058' CHECK (pais_bacen ~ '^[0-9]{1,4}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES cadastros.cliente (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.cliente_endereco');
CREATE UNIQUE INDEX IF NOT EXISTS cliente_endereco_um_principal ON cadastros.cliente_endereco (tenant_id, cliente_id)
  WHERE tipo = 'principal' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cadastros.cliente_contato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  cliente_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  email text CHECK (length(email) <= 254),
  telefone text CHECK (telefone ~ '^[0-9]{10,13}$'),
  papel text CHECK (length(papel) <= 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES cadastros.cliente (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.cliente_contato');

-- Produto (RF-CAD-04, RN-CAD-04). custo_centavos nunca vai ao FDV.
CREATE TABLE IF NOT EXISTS cadastros.produto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 60),
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 120),
  ncm text NOT NULL CHECK (ncm ~ '^[0-9]{8}$'),
  cest text CHECK (cest ~ '^[0-9]{7}$'),
  unidade_comercial text NOT NULL CHECK (length(unidade_comercial) BETWEEN 1 AND 6),
  unidade_tributavel text NOT NULL CHECK (length(unidade_tributavel) BETWEEN 1 AND 6),
  fator_tributavel bigint NOT NULL DEFAULT 10000 CHECK (fator_tributavel > 0),
  ean text CHECK (ean ~ '^([0-9]{8}|[0-9]{12,14}|SEM GTIN)$'),
  marca text CHECK (length(marca) <= 60),
  origem text NOT NULL DEFAULT '0' CHECK (origem ~ '^[0-8]$'),
  grupo_tributacao text NOT NULL CHECK (length(grupo_tributacao) BETWEEN 1 AND 30),
  custo_centavos bigint CHECK (custo_centavos >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, codigo)
);
SELECT controle.preparar_tabela('cadastros.produto');

CREATE TABLE IF NOT EXISTS cadastros.produto_unidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  produto_id uuid NOT NULL,
  unidade text NOT NULL CHECK (length(unidade) BETWEEN 1 AND 6),
  fator bigint NOT NULL CHECK (fator > 0),
  ean text CHECK (ean ~ '^([0-9]{8}|[0-9]{12,14}|SEM GTIN)$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, produto_id, unidade),
  FOREIGN KEY (tenant_id, produto_id) REFERENCES cadastros.produto (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.produto_unidade');

-- Preço por tabela, filial e produto (RN-CAD-06).
CREATE TABLE IF NOT EXISTS cadastros.tabela_preco_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tabela_preco_id uuid NOT NULL,
  filial_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  preco_centavos bigint NOT NULL CHECK (preco_centavos >= 0),
  desconto_maximo_bp integer NOT NULL DEFAULT 0 CHECK (desconto_maximo_bp BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, tabela_preco_id, filial_id, produto_id),
  FOREIGN KEY (tenant_id, tabela_preco_id) REFERENCES cadastros.tabela_preco (tenant_id, id),
  FOREIGN KEY (tenant_id, filial_id) REFERENCES cadastros.filial (tenant_id, id),
  FOREIGN KEY (tenant_id, produto_id) REFERENCES cadastros.produto (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.tabela_preco_item');

-- Estoque (RF-CAD-06, RN-CAD-07): saldo por filial e produto; movimento só de inserção.
CREATE TABLE IF NOT EXISTS cadastros.estoque_saldo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  quantidade bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, filial_id, produto_id),
  FOREIGN KEY (tenant_id, filial_id) REFERENCES cadastros.filial (tenant_id, id),
  FOREIGN KEY (tenant_id, produto_id) REFERENCES cadastros.produto (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.estoque_saldo');

CREATE TABLE IF NOT EXISTS cadastros.estoque_movimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
  quantidade bigint NOT NULL CHECK (quantidade <> 0),
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 1 AND 120),
  origem_tipo text,
  origem_id uuid,
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT estoque_movimento_sinal CHECK (tipo = 'ajuste' OR quantidade > 0),
  FOREIGN KEY (tenant_id, filial_id) REFERENCES cadastros.filial (tenant_id, id),
  FOREIGN KEY (tenant_id, produto_id) REFERENCES cadastros.produto (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.estoque_movimento');
SELECT controle.somente_insercao('cadastros.estoque_movimento');
CREATE INDEX IF NOT EXISTS estoque_movimento_produto_idx ON cadastros.estoque_movimento
  (tenant_id, filial_id, produto_id, created_at);

-- Cache de consultas externas (RF-CAD-02/03, 24 h). Nunca CPF: a chave de cnpj tem 14 posições; o CNPJ vai sem o
-- quadro de sócios (dado pessoal), o que a API garante antes de gravar.
CREATE TABLE IF NOT EXISTS cadastros.consulta_externa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('cnpj', 'cep', 'ie')),
  chave text NOT NULL,
  resposta jsonb NOT NULL,
  fonte text NOT NULL,
  consultado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  UNIQUE (tenant_id, tipo, chave),
  CONSTRAINT consulta_externa_chave CHECK (
    (tipo = 'cnpj' AND chave ~ '^[0-9A-Z]{12}[0-9]{2}$') OR (tipo = 'cep' AND chave ~ '^[0-9]{8}$')
    OR (tipo = 'ie' AND chave ~ '^[A-Z]{2}:[0-9A-Z]{2,14}$'))
);
SELECT controle.preparar_tabela('cadastros.consulta_externa');

-- Privilégios: sem DELETE (exclusão = deleted_at, RN-CAD-08), salvo o cache. Movimento de estoque só de inserção.
GRANT SELECT, INSERT, UPDATE ON cadastros.filial, cadastros.condicao_pagamento, cadastros.tabela_preco,
  cadastros.vendedor, cadastros.cliente, cadastros.cliente_endereco, cadastros.cliente_contato, cadastros.produto,
  cadastros.produto_unidade, cadastros.tabela_preco_item, cadastros.estoque_saldo TO macuxierp_app;
GRANT SELECT, INSERT ON cadastros.estoque_movimento TO macuxierp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cadastros.consulta_externa TO macuxierp_app;

-- Worker e leitura leem tudo do próprio tenant (o worker gera a exportação LGPD, RF-CORE-06).
GRANT INSERT, UPDATE ON cadastros.consulta_externa TO macuxierp_worker;
GRANT SELECT ON cadastros.filial, cadastros.condicao_pagamento, cadastros.tabela_preco, cadastros.vendedor,
  cadastros.cliente, cadastros.cliente_endereco, cadastros.cliente_contato, cadastros.produto, cadastros.produto_unidade,
  cadastros.tabela_preco_item, cadastros.estoque_saldo, cadastros.estoque_movimento, cadastros.consulta_externa
  TO macuxierp_worker, macuxierp_leitura;
