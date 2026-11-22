-- 0012 — Schema pedido: numeração, pedido, itens, histórico de status e decisão (T-0014, F3). Fonte das colunas,
-- chaves, índices e privilégios: docs/desenho/T-0013.md, seção 7; máquina de estados: seção 2 (RN-PED-02).
-- Regras: CLAUDE.md (1, 4, 5 e 8), RN-PED-01 (idempotência), RN-PED-02 (transições), docs/banco/README.md.
-- Aditiva e reexecutável; o schema pedido já existe (0001) e esta migração não toca em outro schema.
-- Nenhuma FK para outro schema: cliente_id, filial_id, produto_id, vendedor_id, condicao_pagamento_id, tabela_preco_id,
-- criado_por, decidido_por, ator_id e evento_id são UUIDs opacos. FKs internas compostas (tenant_id, x_id). Dinheiro em
-- bigint de centavos (>= 0); quantidade em bigint Qtd4 (× 10^4); datas de negócio em timestamptz(3); created_at,
-- updated_at e deleted_at seguem timestamptz como no resto do banco. Sem SECURITY DEFINER, sem worker_global e sem
-- DELETE para ninguém (exclusão = deleted_at; a do tenant segue a guarda fiscal, RN-CORE-07).

-- Código de motivo (catálogo do domain, seção 4.3): só identificador, nunca texto livre.
DO $$
BEGIN
  CREATE DOMAIN pedido.codigo AS text CHECK (VALUE ~ '^[a-z][a-z0-9_]{0,59}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Os 7 status da seção 2 (um lugar só para a lista).
DO $$
BEGIN
  CREATE DOMAIN pedido.status AS text CHECK (VALUE IN ('recebido', 'em_analise', 'aprovado', 'recusado',
    'faturado_parcial', 'faturado', 'cancelado'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Número do pedido (seção 4.4): uma linha por tenant; UPDATE ... SET proximo = proximo + 1 RETURNING na transação da
-- criação. Não é número fiscal.
CREATE TABLE IF NOT EXISTS pedido.numeracao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  proximo bigint NOT NULL DEFAULT 1 CHECK (proximo > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT numeracao_um_por_tenant UNIQUE (tenant_id)
);
-- Sem a chave (tenant_id, id), como plataforma.tenant (0002): nada aponta para a numeração, e (tenant_id) já é único.
SELECT controle.preparar_tabela('pedido.numeracao', chave_composta => false);

-- Pedido (RF-PED-01/02). cliente_retrato tem dado pessoal (PF): nunca em log nem em evento, salvo o aprovado@1 (P9).
-- pendencias = [{codigo, bloqueante, sequencia?, produto_id?}], sem valor.
CREATE TABLE IF NOT EXISTS pedido.pedido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  numero bigint NOT NULL CHECK (numero > 0),
  origem text NOT NULL CHECK (origem IN ('fdv', 'bko')),
  status pedido.status NOT NULL DEFAULT 'recebido',
  status_alterado_em timestamptz(3) NOT NULL DEFAULT now(),
  filial_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  vendedor_id uuid,
  condicao_pagamento_id uuid,
  tabela_preco_id uuid,
  cliente_retrato jsonb NOT NULL CHECK (jsonb_typeof(cliente_retrato) = 'object'),
  endereco_entrega jsonb CHECK (jsonb_typeof(endereco_entrega) = 'object'),
  frete jsonb CHECK (jsonb_typeof(frete) = 'object'),
  emitido_em timestamptz(3) NOT NULL,
  aprovado_origem_em timestamptz(3),
  observacao text CHECK (length(observacao) <= 500),
  total_centavos bigint NOT NULL CHECK (total_centavos >= 0),
  total_informado_centavos bigint CHECK (total_informado_centavos >= 0),
  valor_faturado_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_faturado_centavos >= 0),
  pendencias jsonb NOT NULL DEFAULT '[]',
  validado_em timestamptz(3),
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT pedido_numero_uq UNIQUE (tenant_id, numero),
  -- Pedido do FDV: external_id = pedido_uuid (RN-PED-01), obrigatório e no formato canônico do UUID.
  CONSTRAINT pedido_fdv_external_id_uuid CHECK (origem <> 'fdv' OR (external_id IS NOT NULL
    AND external_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  CONSTRAINT pedido_valor_faturado_ate_total CHECK (valor_faturado_centavos <= total_centavos),
  CONSTRAINT pedido_pendencias_array CHECK (jsonb_typeof(pendencias) = 'array')
);
-- RN-PED-01: a preparar_tabela cria o pedido_external_id_uq (tenant_id, external_id) WHERE external_id IS NOT NULL
-- (regra 5), sem filtrar deleted_at (o excluído continua bloqueando o reenvio). É o único índice do external_id e o
-- árbitro do ON CONFLICT da porta de recebimento:
--   ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
-- A unicidade fica por tenant, mais estrita que a da T-0013, seção 7 (por origem): um external_id do BKO não pode
-- repetir o UUID de um pedido do FDV do mesmo tenant.
SELECT controle.preparar_tabela('pedido.pedido');
-- Lista por cursor com filtro de status (seção 4.2) e sem ele (ordem padrão da lista).
CREATE INDEX IF NOT EXISTS pedido_lista_status_idx ON pedido.pedido (tenant_id, status, emitido_em DESC, id);
CREATE INDEX IF NOT EXISTS pedido_lista_idx ON pedido.pedido (tenant_id, emitido_em DESC, id);
-- Compromisso de crédito por cliente (P5, RN-PED-04).
CREATE INDEX IF NOT EXISTS pedido_cliente_status_idx ON pedido.pedido (tenant_id, cliente_id, status);
CREATE INDEX IF NOT EXISTS pedido_vendedor_idx ON pedido.pedido (tenant_id, vendedor_id, emitido_em DESC);
CREATE INDEX IF NOT EXISTS pedido_filial_idx ON pedido.pedido (tenant_id, filial_id, emitido_em DESC);

-- RN-PED-02 (seção 2): o pedido nasce recebido, e o status só muda pelas transições da tabela. Status igual = sem
-- transição (edição ou revalidação em análise). Vale para todos os papéis, dono incluso. SQLSTATE próprio MXP02 (a
-- API traduz para 422 RN-PED-02); DETAIL = "possiveis=<lista>" (só nomes de status, nunca dado do pedido).
-- A regressão por nota cancelada (F4, P-2) não entra aqui: fica para a T-0021.
CREATE OR REPLACE FUNCTION pedido.transicoes_possiveis(de text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
  SELECT CASE de
    WHEN 'recebido' THEN ARRAY['aprovado', 'em_analise']
    WHEN 'em_analise' THEN ARRAY['aprovado', 'recusado']
    WHEN 'aprovado' THEN ARRAY['faturado_parcial', 'faturado', 'cancelado']
    WHEN 'faturado_parcial' THEN ARRAY['faturado', 'cancelado']
    ELSE ARRAY[]::text[]
  END
$$;

CREATE OR REPLACE FUNCTION pedido.validar_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  possiveis text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'recebido' THEN
      RAISE EXCEPTION 'RN-PED-02: o pedido nasce recebido (criação com status % recusada)', NEW.status
        USING ERRCODE = 'MXP02', DETAIL = 'possiveis=recebido';
    END IF;
    NEW.status_alterado_em := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  possiveis := pedido.transicoes_possiveis(OLD.status);
  IF NOT (NEW.status = ANY (possiveis)) THEN
    RAISE EXCEPTION 'RN-PED-02: transição de % para % recusada; possíveis a partir de %: %', OLD.status, NEW.status,
      OLD.status, coalesce(nullif(array_to_string(possiveis, ', '), ''), 'nenhuma (status final)')
      USING ERRCODE = 'MXP02', DETAIL = 'possiveis=' || array_to_string(possiveis, ',');
  END IF;
  NEW.status_alterado_em := clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validar_status ON pedido.pedido;
CREATE TRIGGER validar_status BEFORE INSERT OR UPDATE OF status ON pedido.pedido
  FOR EACH ROW EXECUTE FUNCTION pedido.validar_status();

-- Item do pedido. produto_retrato sem custo (nunca vai ao FDV nem à tela do vendedor). Item retirado na edição do
-- pedido manual = deleted_at (as somas de compromisso filtram deleted_at IS NULL); sequencia não se reaproveita.
CREATE TABLE IF NOT EXISTS pedido.pedido_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  pedido_id uuid NOT NULL,
  sequencia integer NOT NULL CHECK (sequencia >= 1),
  produto_id uuid NOT NULL,
  produto_retrato jsonb NOT NULL CHECK (jsonb_typeof(produto_retrato) = 'object'),
  quantidade bigint NOT NULL CHECK (quantidade > 0),
  unidade_venda text CHECK (length(unidade_venda) BETWEEN 1 AND 6),
  fator_venda bigint CHECK (fator_venda > 0),
  quantidade_venda bigint CHECK (quantidade_venda > 0),
  preco_unitario_centavos bigint NOT NULL CHECK (preco_unitario_centavos >= 0),
  preco_tabela_centavos bigint CHECK (preco_tabela_centavos >= 0),
  desconto_maximo_bp integer CHECK (desconto_maximo_bp BETWEEN 0 AND 10000),
  desconto_centavos bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  total_centavos bigint NOT NULL CHECK (total_centavos >= 0),
  total_informado_centavos bigint CHECK (total_informado_centavos >= 0),
  quantidade_faturada bigint NOT NULL DEFAULT 0,
  aplicacao text CHECK (length(aplicacao) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT pedido_item_sequencia_uq UNIQUE (tenant_id, pedido_id, sequencia),
  CONSTRAINT pedido_item_quantidade_faturada CHECK (quantidade_faturada BETWEEN 0 AND quantidade),
  CONSTRAINT pedido_item_retrato_sem_custo CHECK (NOT (produto_retrato ?| ARRAY['custo_centavos', 'custo_cents'])),
  CONSTRAINT pedido_item_pedido_fk FOREIGN KEY (tenant_id, pedido_id) REFERENCES pedido.pedido (tenant_id, id)
);
SELECT controle.preparar_tabela('pedido.pedido_item');
-- Compromisso de estoque por produto (P5, RN-PED-04).
CREATE INDEX IF NOT EXISTS pedido_item_produto_idx ON pedido.pedido_item (tenant_id, produto_id);

-- Histórico de status (só INSERT, para todos). de nulo na criação; ator sistema sem ator_id.
CREATE TABLE IF NOT EXISTS pedido.pedido_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  pedido_id uuid NOT NULL,
  de pedido.status,
  para pedido.status NOT NULL,
  ator_tipo text NOT NULL CHECK (ator_tipo IN ('usuario', 'sistema')),
  ator_id uuid,
  motivo_codigo pedido.codigo,
  motivo_texto text CHECK (length(motivo_texto) <= 300),
  pendencias jsonb CHECK (jsonb_typeof(pendencias) = 'array'),
  evento_id uuid,
  ocorrido_em timestamptz(3) NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT pedido_evento_ator CHECK ((ator_tipo = 'sistema') = (ator_id IS NULL)),
  CONSTRAINT pedido_evento_pedido_fk FOREIGN KEY (tenant_id, pedido_id) REFERENCES pedido.pedido (tenant_id, id)
);
SELECT controle.preparar_tabela('pedido.pedido_evento');
SELECT controle.somente_insercao('pedido.pedido_evento');
CREATE INDEX IF NOT EXISTS pedido_evento_pedido_idx ON pedido.pedido_evento (tenant_id, pedido_id, ocorrido_em);

-- Decisão do pedido (só INSERT, para todos): uma por pedido. Automática = sistema (sem decidido_por) e só aprova.
-- Aprovação humana com pendência aceita exige justificativa; recusa exige motivo.
CREATE TABLE IF NOT EXISTS pedido.aprovacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  pedido_id uuid NOT NULL,
  decisao text NOT NULL CHECK (decisao IN ('aprovado', 'recusado')),
  automatica boolean NOT NULL,
  decidido_por uuid,
  -- Mesma lista de plataforma.usuario.perfil (0002): o perfil de quem decidiu, retratado na decisão.
  perfil text CHECK (perfil IN ('administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura')),
  pendencias_aceitas jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(pendencias_aceitas) = 'array'),
  justificativa text CHECK (length(justificativa) <= 500),
  motivo_codigo pedido.codigo,
  motivo_texto text CHECK (length(motivo_texto) <= 300),
  decidido_em timestamptz(3) NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT aprovacao_uma_por_pedido UNIQUE (tenant_id, pedido_id),
  CONSTRAINT aprovacao_automatica_sem_usuario CHECK (automatica = (decidido_por IS NULL)),
  CONSTRAINT aprovacao_automatica_so_aprova CHECK (NOT automatica OR decisao = 'aprovado'),
  CONSTRAINT aprovacao_recusa_com_motivo CHECK (decisao <> 'recusado' OR motivo_codigo IS NOT NULL),
  CONSTRAINT aprovacao_pendencia_com_justificativa CHECK (automatica OR decisao <> 'aprovado'
    OR jsonb_array_length(pendencias_aceitas) = 0 OR justificativa IS NOT NULL),
  CONSTRAINT aprovacao_pedido_fk FOREIGN KEY (tenant_id, pedido_id) REFERENCES pedido.pedido (tenant_id, id)
);
SELECT controle.preparar_tabela('pedido.aprovacao');
SELECT controle.somente_insercao('pedido.aprovacao');

-- Privilégios (seção 7). Sem DELETE nem TRUNCATE para ninguém; pedido_evento e aprovacao sem UPDATE.
-- App (API do BKO): lê tudo, cria e atualiza só status, pendências, cabeçalho e itens do manual e deleted_at.
-- Worker (recebimento do FDV, consumidores de nota na F4 e exportação LGPD): o mesmo, mais o faturado.
GRANT SELECT, INSERT ON pedido.numeracao, pedido.pedido, pedido.pedido_item, pedido.pedido_evento, pedido.aprovacao
  TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (proximo) ON pedido.numeracao TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (status, pendencias, validado_em, filial_id, cliente_id, vendedor_id, condicao_pagamento_id,
  tabela_preco_id, cliente_retrato, endereco_entrega, frete, observacao, total_centavos, deleted_at)
  ON pedido.pedido TO macuxierp_app, macuxierp_worker;
-- Edição do pedido manual (RF-PED-02): quantidade, unidade e fator de venda, preços, descontos e aplicação.
GRANT UPDATE (quantidade, unidade_venda, fator_venda, quantidade_venda, preco_unitario_centavos,
  preco_tabela_centavos, desconto_maximo_bp, desconto_centavos, total_centavos, aplicacao, deleted_at)
  ON pedido.pedido_item TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (valor_faturado_centavos) ON pedido.pedido TO macuxierp_worker;
GRANT UPDATE (quantidade_faturada) ON pedido.pedido_item TO macuxierp_worker;
GRANT SELECT ON pedido.numeracao, pedido.pedido, pedido.pedido_item, pedido.pedido_evento, pedido.aprovacao
  TO macuxierp_leitura;
