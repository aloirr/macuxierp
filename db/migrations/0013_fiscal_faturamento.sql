-- 0013 — Schemas fiscal e faturamento (T-0019, F4), alinhados às especificações dos donos (T-0020, fiscal; T-0021,
-- faturamento): regra tributária e carga aproximada (IBPT); numeração da NF-e sem buraco, pedido a faturar, nota, itens,
-- XML imutável (nota, eventos e inutilização), eventos, inutilização, contingência, transmissões e títulos com baixa.
-- Aditiva e reexecutável.
-- Regras: CLAUDE.md (regras 4, 5, 7 e 8), docs/produto/03 (RN-FAT-01 a 07, RN-FIS-01 a 04), docs/produto/04 ("Banco"),
-- desenho T-0002 (D8: a numeração é do faturamento; D11: escala 4), ADR 0006 (produção só pelo operador).
-- UUIDs de outros schemas são opacos, sem FK entre schemas; a exceção de leitura está em faturamento.ambiente_da_filial.
-- Toda função daqui fixa search_path = pg_catalog, pg_temp (pg_temp por último: tabela temporária da sessão com nome de
-- catálogo não engana a função) e qualifica os nomes pelo schema.
-- Percentual (alíquota, redução, MVA) em integer com escala 4: décimos de milésimo de ponto percentual (18% = 180000).
-- Quantidade em bigint escala 4 (D11). Dinheiro em bigint de centavos. O banco não usa numeric.

-- ============================================================================================================
-- fiscal.regra_tributaria (RF-FIS-01 a 03, RN-FIS-01 a 04; T-0020)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS fiscal.regra_tributaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tributo text NOT NULL DEFAULT 'icms' CHECK (tributo IN ('icms', 'ipi', 'pis', 'cofins', 'ibs_cbs', 'is')),
  -- Filtros (nulo = todos, RN-FIS-01).
  ncm_prefixo text CHECK (ncm_prefixo ~ '^[0-9]{2,8}$'),
  uf_origem text CHECK (uf_origem ~ '^[A-Z]{2}$'),
  uf_destino text CHECK (uf_destino ~ '^[A-Z]{2}$'),
  tipo_cliente text CHECK (tipo_cliente IN ('contribuinte', 'isento', 'nao_contribuinte')),
  crt smallint CHECK (crt BETWEEN 1 AND 4),
  cfop text CHECK (cfop ~ '^[1-7][0-9]{3}$'),
  -- ICMS: CST (2 dígitos) ou CSOSN (3).
  codigo text CHECK (codigo ~ '^[0-9]{2,3}$'),
  mod_bc smallint NOT NULL DEFAULT 3 CHECK (mod_bc BETWEEN 0 AND 3),
  aliquota_icms integer CHECK (aliquota_icms BETWEEN 0 AND 1000000),
  reducao_bc integer CHECK (reducao_bc BETWEEN 0 AND 1000000),
  p_cred_sn integer CHECK (p_cred_sn BETWEEN 0 AND 1000000),
  excluir_icms_bc boolean NOT NULL DEFAULT false,
  -- ICMS-ST e FCP.
  mod_bc_st smallint CHECK (mod_bc_st BETWEEN 0 AND 5),
  mva_original integer CHECK (mva_original BETWEEN 0 AND 100000000),
  mva_ajustada integer CHECK (mva_ajustada BETWEEN 0 AND 100000000),
  ajustar_mva boolean NOT NULL DEFAULT false,
  reducao_bc_st integer CHECK (reducao_bc_st BETWEEN 0 AND 1000000),
  aliquota_interna_destino integer CHECK (aliquota_interna_destino BETWEEN 0 AND 1000000),
  p_fcp integer CHECK (p_fcp BETWEEN 0 AND 1000000),
  p_fcp_st integer CHECK (p_fcp_st BETWEEN 0 AND 1000000),
  -- IPI.
  cst_ipi text CHECK (cst_ipi ~ '^[0-9]{2}$'),
  aliquota_ipi integer CHECK (aliquota_ipi BETWEEN 0 AND 1000000),
  valor_unidade_ipi bigint CHECK (valor_unidade_ipi >= 0),
  c_enq text NOT NULL DEFAULT '999' CHECK (c_enq ~ '^[0-9]{3}$'),
  -- PIS e COFINS.
  cst_pis text CHECK (cst_pis ~ '^[0-9]{2}$'),
  aliquota_pis integer CHECK (aliquota_pis BETWEEN 0 AND 1000000),
  valor_unidade_pis bigint CHECK (valor_unidade_pis >= 0),
  cst_cofins text CHECK (cst_cofins ~ '^[0-9]{2}$'),
  aliquota_cofins integer CHECK (aliquota_cofins BETWEEN 0 AND 1000000),
  valor_unidade_cofins bigint CHECK (valor_unidade_cofins >= 0),
  -- IBS, CBS e IS (NT 2025.002-RTC). c_class_trib: FK lógica a cadastros.classificacao_tributaria (oficial).
  cst_ibs_cbs text CHECK (cst_ibs_cbs ~ '^[0-9]{3}$'),
  c_class_trib text CHECK (c_class_trib ~ '^[0-9]{6}$'),
  p_ibs_uf integer CHECK (p_ibs_uf BETWEEN 0 AND 1000000),
  p_ibs_mun integer CHECK (p_ibs_mun BETWEEN 0 AND 1000000),
  p_cbs integer CHECK (p_cbs BETWEEN 0 AND 1000000),
  p_red_ibs integer CHECK (p_red_ibs BETWEEN 0 AND 1000000),
  p_red_cbs integer CHECK (p_red_cbs BETWEEN 0 AND 1000000),
  p_is integer CHECK (p_is BETWEEN 0 AND 1000000),
  cst_is text CHECK (cst_is ~ '^[0-9]{3}$'),
  c_class_trib_is text CHECK (c_class_trib_is ~ '^[0-9]{6}$'),
  valor_unidade_is bigint CHECK (valor_unidade_is >= 0),
  versao_nt_rtc text CHECK (length(versao_nt_rtc) BETWEEN 1 AND 40),
  -- Fonte e vigência (RN-FIS-04).
  fonte_tipo text NOT NULL CHECK (fonte_tipo IN ('NT', 'convenio', 'anexo', 'lei', 'ajuste_sinief', 'resolucao',
    'outro')),
  fonte_referencia text NOT NULL CHECK (length(fonte_referencia) BETWEEN 1 AND 200),
  versao text NOT NULL CHECK (length(versao) BETWEEN 1 AND 40),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT regra_tributaria_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  -- RN-FIS-02: Simples (CRT 1) e MEI (4) usam CSOSN (3 dígitos); regime normal (3) e sublimite (2), CST (2).
  CONSTRAINT regra_tributaria_cst_ou_csosn CHECK (crt IS NULL OR codigo IS NULL
    OR (crt IN (1, 4)) = (length(codigo) = 3)),
  CONSTRAINT regra_tributaria_ibs_cbs_par CHECK ((cst_ibs_cbs IS NULL) = (c_class_trib IS NULL)),
  CONSTRAINT regra_tributaria_is_par CHECK ((cst_is IS NULL) = (c_class_trib_is IS NULL)),
  -- Lote 2: a linha do ICMS traz o código e pode trazer os demais tributos juntos (linha única); as linhas dedicadas
  -- (IPI, PIS, COFINS, IBS/CBS, IS) usam só os campos do próprio tributo. versao_nt_rtc é livre em qualquer linha.
  CONSTRAINT regra_tributaria_icms_com_codigo CHECK (tributo <> 'icms' OR codigo IS NOT NULL),
  CONSTRAINT regra_tributaria_so_o_tributo CHECK (tributo = 'icms' OR (
    num_nonnulls(codigo, aliquota_icms, reducao_bc, p_cred_sn, mod_bc_st, mva_original, mva_ajustada, reducao_bc_st,
      aliquota_interna_destino, p_fcp, p_fcp_st) = 0
    AND (tributo = 'ipi' OR num_nonnulls(cst_ipi, aliquota_ipi, valor_unidade_ipi) = 0)
    AND (tributo = 'pis' OR num_nonnulls(cst_pis, aliquota_pis, valor_unidade_pis) = 0)
    AND (tributo = 'cofins' OR num_nonnulls(cst_cofins, aliquota_cofins, valor_unidade_cofins) = 0)
    AND (tributo = 'ibs_cbs' OR num_nonnulls(cst_ibs_cbs, c_class_trib, p_ibs_uf, p_ibs_mun, p_cbs, p_red_ibs,
      p_red_cbs) = 0)
    AND (tributo = 'is' OR num_nonnulls(p_is, cst_is, c_class_trib_is, valor_unidade_is) = 0)))
);
SELECT controle.preparar_tabela('fiscal.regra_tributaria');
-- Mesmos filtros e mesmo início de vigência = cadastro repetido (o empate de especificidade é do domain, RN-FIS-01).
CREATE UNIQUE INDEX IF NOT EXISTS regra_tributaria_filtros_uq ON fiscal.regra_tributaria (tenant_id, tributo,
  coalesce(ncm_prefixo, ''), coalesce(uf_origem, ''), coalesce(uf_destino, ''), coalesce(tipo_cliente, ''),
  coalesce(crt, 0), coalesce(cfop, ''), vigencia_inicio) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS regra_tributaria_uf_origem_idx ON fiscal.regra_tributaria
  (tenant_id, uf_origem, vigencia_inicio);
CREATE INDEX IF NOT EXISTS regra_tributaria_ncm_idx ON fiscal.regra_tributaria (tenant_id, ncm_prefixo text_pattern_ops);

COMMENT ON TABLE fiscal.regra_tributaria IS
  'Regras tributárias (RF-FIS-01 a 03, T-0020): filtros com nulo = todos (RN-FIS-01), CST ou CSOSN pelo CRT '
  '(RN-FIS-02), grupos de ICMS/ST/FCP, IPI, PIS, COFINS, IBS, CBS e IS (RN-FIS-03), fonte e vigência (RN-FIS-04). '
  'Percentuais em integer escala 4 (18% = 180000); valor por unidade (valor_unidade_ipi, _pis, _cofins, _is) em '
  'bigint escala 4, décimos de milésimo de real, como o vAliqProd do Manual (R$ 0,1411 = 1411), não centavos; o IS '
  'por unidade soma-se ao p_is (ad valorem).';

-- ============================================================================================================
-- fiscal.carga_aproximada (IBPT, RF-FIS-04; T-0020)
-- ============================================================================================================
-- Geral no tenant de referência (D9), não em tenant_id nulo (regra 5); ver o COMMENT da tabela.
CREATE TABLE IF NOT EXISTS fiscal.carga_aproximada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  ncm text NOT NULL CHECK (ncm ~ '^[0-9]{8}$'),
  ex text CHECK (ex ~ '^[0-9]{1,3}$'),
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  aliquota_federal_nacional integer NOT NULL DEFAULT 0 CHECK (aliquota_federal_nacional BETWEEN 0 AND 1000000),
  aliquota_federal_importado integer NOT NULL DEFAULT 0 CHECK (aliquota_federal_importado BETWEEN 0 AND 1000000),
  aliquota_estadual integer NOT NULL DEFAULT 0 CHECK (aliquota_estadual BETWEEN 0 AND 1000000),
  aliquota_municipal integer NOT NULL DEFAULT 0 CHECK (aliquota_municipal BETWEEN 0 AND 1000000),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao text NOT NULL CHECK (length(versao) BETWEEN 1 AND 40),
  fonte text NOT NULL CHECK (length(fonte) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT carga_aproximada_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
SELECT controle.preparar_tabela('fiscal.carga_aproximada');
CREATE UNIQUE INDEX IF NOT EXISTS carga_aproximada_chave_uq ON fiscal.carga_aproximada
  (tenant_id, ncm, coalesce(ex, ''), uf, vigencia_inicio) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS carga_aproximada_busca_idx ON fiscal.carga_aproximada (ncm, uf, vigencia_inicio);
DROP POLICY IF EXISTS leitura_geral ON fiscal.carga_aproximada;
CREATE POLICY leitura_geral ON fiscal.carga_aproximada FOR SELECT
  USING (tenant_id = plataforma.tenant_referencia() AND plataforma.tenant_atual() IS NOT NULL);
DROP POLICY IF EXISTS geral_so_dono_ins ON fiscal.carga_aproximada;
CREATE POLICY geral_so_dono_ins ON fiscal.carga_aproximada AS RESTRICTIVE FOR INSERT
  TO macuxierp_app, macuxierp_worker
  WITH CHECK (tenant_id <> plataforma.tenant_referencia());
DROP POLICY IF EXISTS geral_so_dono_upd ON fiscal.carga_aproximada;
CREATE POLICY geral_so_dono_upd ON fiscal.carga_aproximada AS RESTRICTIVE FOR UPDATE
  TO macuxierp_app, macuxierp_worker
  USING (tenant_id <> plataforma.tenant_referencia()) WITH CHECK (tenant_id <> plataforma.tenant_referencia());

COMMENT ON TABLE fiscal.carga_aproximada IS
  'Carga tributária aproximada (IBPT, Lei 12.741/2012; RF-FIS-04, T-0020). Linhas do tenant de referência = tabela '
  'geral (lida por todos, gravada só pelo dono); linhas do tenant = ajuste próprio. Percentuais em escala 4.';

-- ============================================================================================================
-- Funções comuns do faturamento: ambiente da filial (RN-FAT-04, ADR 0006), exclusão proibida, dono da tabela
-- ============================================================================================================
CREATE OR REPLACE FUNCTION faturamento.ambiente_da_filial(p_tenant uuid, p_filial uuid) RETURNS text
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT coalesce((SELECT a.ambiente FROM core.ambiente_fiscal a
                   WHERE a.tenant_id = p_tenant AND a.filial_id = p_filial AND a.deleted_at IS NULL), 'homologacao')
$$;
COMMENT ON FUNCTION faturamento.ambiente_da_filial(uuid, uuid) IS
  'RN-FAT-04 (ADR 0006): ambiente da filial emissora; sem linha (ou excluída) = homologação. Exceção de segurança à '
  'regra 1: é a única leitura de outro schema (core.ambiente_fiscal), com o papel e a RLS de quem chama (tenant '
  'diferente do da sessão = sem linha = homologação, a falha segura).';

-- Ambiente que a linha nova recebe: o da filial. Valor informado diferente = erro (a aplicação não escolhe).
CREATE OR REPLACE FUNCTION faturamento.ambiente_conferido(p_tenant uuid, p_filial uuid, p_informado text)
  RETURNS text
  LANGUAGE plpgsql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v text := faturamento.ambiente_da_filial(p_tenant, p_filial);
BEGIN
  IF p_informado IS NOT NULL AND p_informado <> v THEN
    RAISE EXCEPTION 'RN-FAT-04: ambiente informado (%) diferente do da filial em core.ambiente_fiscal (%)',
      p_informado, v USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v;
END $$;

-- Recusa DELETE e TRUNCATE: para todos, dono incluso.
CREATE OR REPLACE FUNCTION faturamento.proibir_exclusao() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RAISE EXCEPTION 'RN-FAT-01/02: % não sai do banco (% recusado); o fim é cancelamento, inutilização ou estorno',
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- O papel atual é o dono da tabela do gatilho (a migração, o operador)? Catálogo qualificado e search_path fixo.
CREATE OR REPLACE FUNCTION faturamento.sou_dono(p_tabela oid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT coalesce((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = p_tabela)
    = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user), false)
$$;

-- Colunas (de jsonb de linha) que mudaram fora da lista permitida; NULL se nenhuma.
CREATE OR REPLACE FUNCTION faturamento.coluna_alterada(p_velho jsonb, p_novo jsonb, p_permitidas text[])
  RETURNS text
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT min(k) FROM jsonb_object_keys(p_velho) k
  WHERE NOT (k = ANY (p_permitidas)) AND p_velho -> k IS DISTINCT FROM p_novo -> k
$$;

-- ============================================================================================================
-- faturamento.serie_numeracao (RN-FAT-01, D8; A1)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.serie_numeracao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  modelo smallint NOT NULL DEFAULT 55 CHECK (modelo = 55),
  serie smallint NOT NULL CHECK (serie BETWEEN 0 AND 999),
  numero_inicial integer NOT NULL CHECK (numero_inicial BETWEEN 1 AND 999999999),
  proximo integer NOT NULL CHECK (proximo BETWEEN 1 AND 1000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT serie_numeracao_chave UNIQUE (tenant_id, filial_id, ambiente, modelo, serie),
  CONSTRAINT serie_numeracao_proximo_desde_inicial CHECK (proximo >= numero_inicial)
);
SELECT controle.preparar_tabela('faturamento.serie_numeracao');

CREATE OR REPLACE FUNCTION faturamento.serie_numeracao_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ambiente := faturamento.ambiente_conferido(NEW.tenant_id, NEW.filial_id, NEW.ambiente);
    IF NEW.proximo <> NEW.numero_inicial THEN
      RAISE EXCEPTION 'RN-FAT-01: a numeração começa no número inicial' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.tenant_id, NEW.filial_id, NEW.ambiente, NEW.modelo, NEW.serie, NEW.numero_inicial, NEW.deleted_at)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.filial_id, OLD.ambiente, OLD.modelo, OLD.serie, OLD.numero_inicial, OLD.deleted_at) THEN
    RAISE EXCEPTION 'RN-FAT-01: a chave da numeração não muda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.proximo < OLD.proximo THEN
    RAISE EXCEPTION 'RN-FAT-01: a numeração só avança' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS serie_numeracao_antes ON faturamento.serie_numeracao;
CREATE TRIGGER serie_numeracao_antes BEFORE INSERT OR UPDATE ON faturamento.serie_numeracao
  FOR EACH ROW EXECUTE FUNCTION faturamento.serie_numeracao_antes();
DROP TRIGGER IF EXISTS serie_numeracao_sem_exclusao ON faturamento.serie_numeracao;
CREATE TRIGGER serie_numeracao_sem_exclusao BEFORE DELETE ON faturamento.serie_numeracao
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();
DROP TRIGGER IF EXISTS serie_numeracao_sem_truncate ON faturamento.serie_numeracao;
CREATE TRIGGER serie_numeracao_sem_truncate BEFORE TRUNCATE ON faturamento.serie_numeracao
  FOR EACH STATEMENT EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.serie_numeracao IS
  'Contador da NF-e por tenant, filial emissora, ambiente, modelo 55 e série (RN-FAT-01, D8, A1). Só avança, por '
  'faturamento.reservar_numero (na transação da nota) ou pela inutilização; na confirmação, todo número reservado '
  'tem nota ou inutilização não rejeitada (gatilho adiado serie_numeracao_sem_buraco).';

-- ============================================================================================================
-- faturamento.pedido_a_faturar (T-0021, tabela 2): pedido aprovado recebido pela porta do pedido
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.pedido_a_faturar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  pedido_id uuid NOT NULL,
  filial_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'a_faturar' CHECK (status IN ('a_faturar', 'faturado_parcial', 'faturado', 'cancelado')),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT pedido_a_faturar_pedido_uq UNIQUE (tenant_id, pedido_id)
);
SELECT controle.preparar_tabela('faturamento.pedido_a_faturar');
CREATE INDEX IF NOT EXISTS pedido_a_faturar_fila_idx ON faturamento.pedido_a_faturar (tenant_id, filial_id, recebido_em)
  WHERE status IN ('a_faturar', 'faturado_parcial');

COMMENT ON TABLE faturamento.pedido_a_faturar IS
  'Pedidos aprovados à espera de faturamento (payload = PedidoAprovado da porta do pedido; o faturamento não lê o '
  'schema pedido). Um por pedido e tenant.';

-- ============================================================================================================
-- faturamento.nota (RN-FAT-01, 02, 03, 04, 05 e 07; A3 a A5)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.nota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  pedido_id uuid,
  cliente_id uuid NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  modelo smallint NOT NULL DEFAULT 55 CHECK (modelo = 55),
  serie smallint NOT NULL CHECK (serie BETWEEN 0 AND 999),
  numero integer CHECK (numero BETWEEN 1 AND 999999999),
  chave_acesso text CHECK (chave_acesso ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'),
  c_nf text CHECK (c_nf ~ '^[0-9]{8}$'),
  tipo_emissao smallint NOT NULL DEFAULT 1 CHECK (tipo_emissao IN (1, 6, 7)),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'em_autorizacao', 'autorizada_guarda_pendente',
    'autorizada', 'rejeitada', 'denegada', 'cancelada', 'emitida_contingencia', 'inutilizada')),
  emitida_em timestamptz NOT NULL DEFAULT now(),
  saida_em timestamptz,
  natureza_operacao text NOT NULL CHECK (length(natureza_operacao) BETWEEN 1 AND 60),
  finalidade smallint NOT NULL DEFAULT 1 CHECK (finalidade BETWEEN 1 AND 4),
  versao_layout text NOT NULL DEFAULT '4.00' CHECK (versao_layout ~ '^[0-9]\.[0-9]{2}$'),
  emitente_retrato jsonb CHECK (jsonb_typeof(emitente_retrato) = 'object'),
  destinatario_retrato jsonb CHECK (jsonb_typeof(destinatario_retrato) = 'object'),
  transporte jsonb CHECK (jsonb_typeof(transporte) = 'object'),
  pagamento jsonb CHECK (jsonb_typeof(pagamento) IN ('object', 'array')),
  produtos_centavos bigint NOT NULL DEFAULT 0 CHECK (produtos_centavos >= 0),
  desconto_centavos bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  frete_centavos bigint NOT NULL DEFAULT 0 CHECK (frete_centavos >= 0),
  seguro_centavos bigint NOT NULL DEFAULT 0 CHECK (seguro_centavos >= 0),
  outras_centavos bigint NOT NULL DEFAULT 0 CHECK (outras_centavos >= 0),
  bc_icms_centavos bigint NOT NULL DEFAULT 0 CHECK (bc_icms_centavos >= 0),
  icms_centavos bigint NOT NULL DEFAULT 0 CHECK (icms_centavos >= 0),
  bc_icms_st_centavos bigint NOT NULL DEFAULT 0 CHECK (bc_icms_st_centavos >= 0),
  icms_st_centavos bigint NOT NULL DEFAULT 0 CHECK (icms_st_centavos >= 0),
  ipi_centavos bigint NOT NULL DEFAULT 0 CHECK (ipi_centavos >= 0),
  pis_centavos bigint NOT NULL DEFAULT 0 CHECK (pis_centavos >= 0),
  cofins_centavos bigint NOT NULL DEFAULT 0 CHECK (cofins_centavos >= 0),
  ibs_centavos bigint NOT NULL DEFAULT 0 CHECK (ibs_centavos >= 0),
  cbs_centavos bigint NOT NULL DEFAULT 0 CHECK (cbs_centavos >= 0),
  is_imposto_centavos bigint NOT NULL DEFAULT 0 CHECK (is_imposto_centavos >= 0),
  total_nota_centavos bigint NOT NULL DEFAULT 0 CHECK (total_nota_centavos >= 0),
  protocolo text CHECK (protocolo ~ '^[0-9]{15}$'),
  autorizada_em timestamptz,
  c_stat smallint CHECK (c_stat BETWEEN 100 AND 999),
  x_motivo text CHECK (length(x_motivo) <= 255),
  recibo text CHECK (recibo ~ '^[0-9]{15}$'),
  cancelada_em timestamptz,
  contingencia_em timestamptz,
  contingencia_justificativa text CHECK (length(contingencia_justificativa) BETWEEN 15 AND 256),
  idempotencia_chave text NOT NULL CHECK (length(idempotencia_chave) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT nota_chave_acesso_uq UNIQUE (chave_acesso),
  CONSTRAINT nota_idempotencia_uq UNIQUE (tenant_id, idempotencia_chave),
  -- Fora do rascunho a nota tem número; chave e cNF também, salvo o rascunho numerado que foi inutilizado.
  CONSTRAINT nota_numerada CHECK (status = 'rascunho' OR (numero IS NOT NULL
    AND (status = 'inutilizada' OR (chave_acesso IS NOT NULL AND c_nf IS NOT NULL)))),
  -- A chave repete modelo, série, número, tipo de emissão e cNF da nota (posições 21 a 43).
  CONSTRAINT nota_chave_coerente CHECK (chave_acesso IS NULL OR (numero IS NOT NULL AND c_nf IS NOT NULL
    AND substr(chave_acesso, 21, 2) = lpad(modelo::text, 2, '0')
    AND substr(chave_acesso, 23, 3) = lpad(serie::text, 3, '0')
    AND substr(chave_acesso, 26, 9) = lpad(numero::text, 9, '0')
    AND substr(chave_acesso, 35, 1) = tipo_emissao::text
    AND substr(chave_acesso, 36, 8) = c_nf)),
  CONSTRAINT nota_protocolada CHECK (status NOT IN ('autorizada_guarda_pendente', 'autorizada', 'cancelada')
    OR (protocolo IS NOT NULL AND autorizada_em IS NOT NULL)),
  CONSTRAINT nota_denegada_protocolada CHECK (status <> 'denegada' OR protocolo IS NOT NULL),
  CONSTRAINT nota_cancelada_com_data CHECK ((status = 'cancelada') = (cancelada_em IS NOT NULL)),
  -- RN-FAT-05: emissão em contingência (6 SVC-AN, 7 SVC-RS) com data e justificativa.
  CONSTRAINT nota_contingencia_coerente CHECK ((tipo_emissao = 1) = (contingencia_em IS NULL)
    AND (contingencia_em IS NULL) = (contingencia_justificativa IS NULL)),
  CONSTRAINT nota_emitida_contingencia CHECK (status <> 'emitida_contingencia' OR tipo_emissao IN (6, 7))
);
SELECT controle.preparar_tabela('faturamento.nota');
-- RN-FAT-01: um número por série, filial e ambiente; a rejeitada reenvia com o mesmo (RN-FAT-07).
CREATE UNIQUE INDEX IF NOT EXISTS nota_numero_uq ON faturamento.nota
  (tenant_id, filial_id, ambiente, modelo, serie, numero) WHERE numero IS NOT NULL;
-- Q2: lista por filial e data; filtros por cliente, pedido e status.
CREATE INDEX IF NOT EXISTS nota_lista_idx ON faturamento.nota (tenant_id, filial_id, emitida_em DESC);
CREATE INDEX IF NOT EXISTS nota_cliente_idx ON faturamento.nota (tenant_id, cliente_id, emitida_em DESC);
CREATE INDEX IF NOT EXISTS nota_pedido_idx ON faturamento.nota (tenant_id, pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS nota_status_idx ON faturamento.nota (tenant_id, status, emitida_em DESC);
-- Q4: painel de rejeições.
CREATE INDEX IF NOT EXISTS nota_rejeitada_idx ON faturamento.nota (tenant_id, updated_at DESC)
  WHERE status = 'rejeitada';
-- Q5: fila do worker (guarda pendente e contingência).
CREATE INDEX IF NOT EXISTS nota_worker_idx ON faturamento.nota (tenant_id, status, updated_at)
  WHERE status IN ('autorizada_guarda_pendente', 'emitida_contingencia');

-- O número da nota foi reservado na numeração da série, filial e ambiente dela, e não está em inutilização não
-- rejeitada (RN-FAT-01)? A linha da série é lida com FOR SHARE: a inutilização trava a mesma linha com FOR UPDATE,
-- então a nota que entra num buraco (faixa de inutilização rejeitada) espera a inutilização nova da faixa confirmar
-- ou desfazer e confere depois (READ COMMITTED). Sem ciclo: a nota que recebe o número não está na faixa travada.
CREATE OR REPLACE FUNCTION faturamento.conferir_reservado(n faturamento.nota) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  c faturamento.serie_numeracao%ROWTYPE;
BEGIN
  SELECT * INTO c FROM faturamento.serie_numeracao s
  WHERE s.tenant_id = n.tenant_id AND s.filial_id = n.filial_id AND s.ambiente = n.ambiente AND s.modelo = n.modelo
    AND s.serie = n.serie
  FOR SHARE;
  IF NOT FOUND OR n.numero < c.numero_inicial OR n.numero >= c.proximo THEN
    RAISE EXCEPTION 'RN-FAT-01: o número % da série % não foi reservado (use faturamento.reservar_numero)',
      n.numero, n.serie USING ERRCODE = 'check_violation';
  END IF;
  IF faturamento.numero_inutilizado(n.tenant_id, n.filial_id, n.ambiente, n.modelo, n.serie, n.numero) THEN
    RAISE EXCEPTION 'RN-FAT-01: o número % da série % está em inutilização', n.numero, n.serie
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- INSERT: ambiente pela filial (A3), nasce rascunho; número, se vier, já reservado.
CREATE OR REPLACE FUNCTION faturamento.nota_antes_inserir() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  NEW.ambiente := faturamento.ambiente_conferido(NEW.tenant_id, NEW.filial_id, NEW.ambiente);
  IF NEW.status <> 'rascunho' THEN
    RAISE EXCEPTION 'RN-FAT-02: a nota nasce rascunho (status % recusado)', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'RN-FAT-01: a nota não nasce excluída' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.numero IS NOT NULL THEN
    PERFORM faturamento.conferir_reservado(NEW);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nota_antes_inserir ON faturamento.nota;
CREATE TRIGGER nota_antes_inserir BEFORE INSERT ON faturamento.nota
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_antes_inserir();

-- UPDATE (A4, A5, RN-FAT-02 e 07): identidade, ambiente e número (depois de posto) nunca mudam; rascunho e rejeitada
-- se corrigem; em autorização e em contingência só recebem o retorno; da autorização em diante só status e
-- cancelada_em; cancelada, denegada e inutilizada não mudam mais. O envio (a em_autorizacao ou emitida_contingencia a
-- partir de rascunho ou rejeitada) exige o ambiente da nota igual ao da filial agora (RN-FAT-04).
CREATE OR REPLACE FUNCTION faturamento.nota_antes_alterar() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  velho jsonb := to_jsonb(OLD);
  novo jsonb := to_jsonb(NEW);
  fixos text[] := ARRAY['id', 'tenant_id', 'filial_id', 'ambiente', 'modelo', 'serie', 'idempotencia_chave',
    'pedido_id', 'created_at'];
  retorno text[] := ARRAY['status', 'updated_at', 'c_stat', 'x_motivo', 'recibo', 'protocolo', 'autorizada_em'];
  contingencia text[] := ARRAY['tipo_emissao', 'chave_acesso', 'c_nf', 'contingencia_em', 'contingencia_justificativa',
    'emitida_em'];
  autorizada text[] := ARRAY['status', 'updated_at', 'cancelada_em'];
  k text;
BEGIN
  FOREACH k IN ARRAY fixos LOOP
    IF velho -> k IS DISTINCT FROM novo -> k THEN
      RAISE EXCEPTION 'RN-FAT-01/04: % da nota não muda', k USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  IF OLD.numero IS NOT NULL AND NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'RN-FAT-01/07: numero da nota não muda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.numero IS NULL AND NEW.numero IS NOT NULL THEN
    PERFORM faturamento.conferir_reservado(NEW);
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND (OLD.status <> 'rascunho' OR NEW.numero IS NOT NULL OR OLD.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'RN-FAT-01: só o rascunho sem número é excluído' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status = 'em_autorizacao' THEN
    k := faturamento.coluna_alterada(velho, novo,
      retorno || CASE WHEN NEW.status = 'emitida_contingencia' THEN contingencia ELSE '{}'::text[] END);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-02: nota em autorização só recebe o retorno da SEFAZ (% recusado)', k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status = 'emitida_contingencia' THEN
    k := faturamento.coluna_alterada(velho, novo, retorno);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-05: nota emitida em contingência só recebe o retorno da SEFAZ (% recusado)', k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status IN ('autorizada_guarda_pendente', 'autorizada') THEN
    k := faturamento.coluna_alterada(velho, novo, autorizada);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-02: nota % nunca é editada, só evento (% recusado)', OLD.status, k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status IN ('cancelada', 'denegada', 'inutilizada') THEN
    k := faturamento.coluna_alterada(velho, novo, ARRAY['updated_at']);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-02: nota % nunca é editada (% recusado)', OLD.status, k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'rascunho' AND NEW.status IN ('em_autorizacao', 'emitida_contingencia'))
         OR (OLD.status = 'em_autorizacao' AND NEW.status IN ('autorizada_guarda_pendente', 'rejeitada', 'denegada',
              'emitida_contingencia'))
         OR (OLD.status = 'rejeitada' AND NEW.status IN ('em_autorizacao', 'emitida_contingencia', 'inutilizada'))
         OR (OLD.status = 'rascunho' AND NEW.status = 'inutilizada' AND NEW.numero IS NOT NULL)
         OR (OLD.status = 'emitida_contingencia' AND NEW.status = 'em_autorizacao')
         OR (OLD.status = 'autorizada_guarda_pendente' AND NEW.status = 'autorizada')
         OR (OLD.status = 'autorizada' AND NEW.status = 'cancelada')) THEN
      RAISE EXCEPTION 'RN-FAT-02: transição de % para % recusada', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'autorizada' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_xml x
        WHERE x.tenant_id = NEW.tenant_id AND x.nota_id = NEW.id AND x.tipo = 'nfe_autorizada') THEN
      RAISE EXCEPTION 'RN-FAT-03: a nota só fica autorizada com o XML guardado (guarda pendente)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelada' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_evento e
        WHERE e.tenant_id = NEW.tenant_id AND e.nota_id = NEW.id AND e.tipo = 'cancelamento'
          AND e.status = 'registrado') THEN
      RAISE EXCEPTION 'RN-FAT-02: cancelamento só pelo evento registrado' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'inutilizada' AND NOT faturamento.numero_inutilizado(NEW.tenant_id, NEW.filial_id, NEW.ambiente,
        NEW.modelo, NEW.serie, NEW.numero, true) THEN
      RAISE EXCEPTION 'RN-FAT-01: inutilizada só com a inutilização registrada da faixa'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('em_autorizacao', 'emitida_contingencia') AND OLD.status IN ('rascunho', 'rejeitada') THEN
      IF faturamento.numero_inutilizado(NEW.tenant_id, NEW.filial_id, NEW.ambiente, NEW.modelo, NEW.serie,
          NEW.numero) THEN
        RAISE EXCEPTION 'RN-FAT-07: o número % está em inutilização; a nota não volta a ser enviada', NEW.numero
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.ambiente <> faturamento.ambiente_da_filial(NEW.tenant_id, NEW.filial_id) THEN
        RAISE EXCEPTION 'RN-FAT-04: a nota é de % e a filial agora emite em %; crie outra nota', NEW.ambiente,
          faturamento.ambiente_da_filial(NEW.tenant_id, NEW.filial_id) USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.status = 'emitida_contingencia' AND NOT EXISTS (SELECT 1 FROM faturamento.contingencia c
        WHERE c.tenant_id = NEW.tenant_id AND c.filial_id = NEW.filial_id AND c.ambiente = NEW.ambiente
          AND c.fim_em IS NULL AND c.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'RN-FAT-05: emissão em contingência só com a contingência aberta na filial'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nota_antes_alterar ON faturamento.nota;
CREATE TRIGGER nota_antes_alterar BEFORE UPDATE ON faturamento.nota
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_antes_alterar();
DROP TRIGGER IF EXISTS nota_sem_exclusao ON faturamento.nota;
CREATE TRIGGER nota_sem_exclusao BEFORE DELETE ON faturamento.nota
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();
DROP TRIGGER IF EXISTS nota_sem_truncate ON faturamento.nota;
CREATE TRIGGER nota_sem_truncate BEFORE TRUNCATE ON faturamento.nota
  FOR EACH STATEMENT EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.nota IS
  'NF-e modelo 55 (T-0021). Número reservado na mesma transação (RN-FAT-01), ambiente posto pelo banco a partir de '
  'core.ambiente_fiscal (RN-FAT-04, A3), rejeitada reenvia com o mesmo número (RN-FAT-07). Da autorização em diante '
  'nunca é editada (RN-FAT-02): autorizada só com o XML guardado (RN-FAT-03), cancelada só com o evento registrado. '
  'Sem DELETE (nem o dono).';
COMMENT ON COLUMN faturamento.nota.status IS
  'rascunho → em_autorizacao | emitida_contingencia; em_autorizacao → autorizada_guarda_pendente | rejeitada | '
  'denegada | emitida_contingencia; rejeitada → em_autorizacao | emitida_contingencia (mesmo número) | inutilizada; '
  'rascunho numerado → inutilizada; '
  'emitida_contingencia → em_autorizacao; autorizada_guarda_pendente → autorizada (XML guardado); autorizada → '
  'cancelada (evento registrado).';

-- ============================================================================================================
-- faturamento.nota_item (T-0021, tabela 4)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.nota_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nota_id uuid NOT NULL,
  n_item smallint NOT NULL CHECK (n_item BETWEEN 1 AND 990),
  pedido_item_sequencia integer CHECK (pedido_item_sequencia >= 1),
  produto_id uuid NOT NULL,
  produto_retrato jsonb NOT NULL CHECK (jsonb_typeof(produto_retrato) = 'object'),
  cfop text NOT NULL CHECK (cfop ~ '^[1-7][0-9]{3}$'),
  quantidade bigint NOT NULL CHECK (quantidade > 0),
  valor_unitario_centavos bigint NOT NULL CHECK (valor_unitario_centavos >= 0),
  valor_produto_centavos bigint NOT NULL CHECK (valor_produto_centavos >= 0),
  desconto_centavos bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  frete_centavos bigint NOT NULL DEFAULT 0 CHECK (frete_centavos >= 0),
  outras_centavos bigint NOT NULL DEFAULT 0 CHECK (outras_centavos >= 0),
  valor_total_centavos bigint NOT NULL CHECK (valor_total_centavos >= 0),
  tributos jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(tributos) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT nota_item_n_item_uq UNIQUE (nota_id, n_item),
  FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.nota_item');

-- Item só muda com a nota em rascunho ou rejeitada (RN-FAT-02 e 07); nunca troca de nota.
CREATE OR REPLACE FUNCTION faturamento.nota_item_editavel() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  s text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id, NEW.nota_id) IS DISTINCT FROM (OLD.tenant_id, OLD.nota_id) THEN
    RAISE EXCEPTION 'RN-FAT-02: o item não troca de nota' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT n.status INTO s FROM faturamento.nota n WHERE n.tenant_id = OLD.tenant_id AND n.id = OLD.nota_id;
  ELSE
    SELECT n.status INTO s FROM faturamento.nota n WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.nota_id;
  END IF;
  IF s IS DISTINCT FROM 'rascunho' AND s IS DISTINCT FROM 'rejeitada' THEN
    RAISE EXCEPTION 'RN-FAT-02: item de nota % não muda', coalesce(s, 'inexistente')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nota_item_editavel ON faturamento.nota_item;
CREATE TRIGGER nota_item_editavel BEFORE INSERT OR UPDATE OR DELETE ON faturamento.nota_item
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_item_editavel();
DROP TRIGGER IF EXISTS nota_item_sem_truncate ON faturamento.nota_item;
CREATE TRIGGER nota_item_sem_truncate BEFORE TRUNCATE ON faturamento.nota_item
  FOR EACH STATEMENT EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.nota_item IS
  'Itens da NF-e: quantidade em bigint escala 4 (D11), valores em centavos, retrato do produto e tributos calculados '
  '(jsonb). Só mudam com a nota em rascunho ou rejeitada (RN-FAT-02 e 07). produto_id é opaco (cadastros).';

-- ============================================================================================================
-- faturamento.nota_evento (RN-FAT-02; T-0021, tabela 6): cancelamento e CC-e
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.nota_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nota_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('cancelamento', 'cce')),
  n_seq_evento smallint NOT NULL CHECK (n_seq_evento BETWEEN 1 AND 20),
  texto text NOT NULL CHECK (length(texto) BETWEEN 15 AND 1000),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'registrado', 'rejeitado')),
  protocolo text CHECK (protocolo ~ '^[0-9]{15}$'),
  c_stat smallint CHECK (c_stat BETWEEN 100 AND 999),
  x_motivo text CHECK (length(x_motivo) <= 255),
  registrado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT nota_evento_seq_uq UNIQUE (nota_id, tipo, n_seq_evento),
  CONSTRAINT nota_evento_cancelamento_unico CHECK (tipo <> 'cancelamento' OR n_seq_evento = 1),
  CONSTRAINT nota_evento_registrado CHECK (status <> 'registrado' OR (protocolo IS NOT NULL AND registrado_em IS NOT NULL)),
  CONSTRAINT nota_evento_sem_exclusao_logica CHECK (deleted_at IS NULL),
  FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.nota_evento');

-- Ciclo do evento: ver o COMMENT da tabela (a CC-e segue a sequência, Q8).
CREATE OR REPLACE FUNCTION faturamento.nota_evento_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  s text;
  proxima smallint;
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT n.status INTO s FROM faturamento.nota n WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.nota_id;
    -- autorizada já implica o XML guardado (nota_antes_alterar).
    IF s IS DISTINCT FROM 'autorizada' THEN
      RAISE EXCEPTION 'RN-FAT-03: evento só em nota autorizada com o XML guardado (status %)', coalesce(s, 'inexistente')
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pendente' THEN
      RAISE EXCEPTION 'RN-FAT-02: o evento nasce pendente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tipo = 'cce' THEN
      SELECT coalesce(max(e.n_seq_evento), 0) + 1 INTO proxima FROM faturamento.nota_evento e
      WHERE e.nota_id = NEW.nota_id AND e.tipo = 'cce';
      IF NEW.n_seq_evento <> proxima THEN
        RAISE EXCEPTION 'RN-FAT-02: a CC-e desta nota é a sequência %', proxima USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'registrado' THEN
    RAISE EXCEPTION 'RN-FAT-02: evento registrado não muda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW),
    ARRAY['status', 'protocolo', 'c_stat', 'x_motivo', 'registrado_em', 'texto', 'updated_at']);
  IF k IS NOT NULL THEN
    RAISE EXCEPTION 'RN-FAT-02: % do evento não muda', k USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'pendente' AND NEW.status IN ('registrado', 'rejeitado'))
         OR (OLD.status = 'rejeitado' AND NEW.status = 'pendente')) THEN
      RAISE EXCEPTION 'RN-FAT-02: transição do evento de % para % recusada', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'registrado' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_xml x
        WHERE x.tenant_id = NEW.tenant_id AND x.evento_id = NEW.id) THEN
      RAISE EXCEPTION 'RN-FAT-03: o evento só fica registrado com o XML guardado' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nota_evento_antes ON faturamento.nota_evento;
CREATE TRIGGER nota_evento_antes BEFORE INSERT OR UPDATE ON faturamento.nota_evento
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_evento_antes();

-- Cancelamento registrado cancela a nota (na mesma transação).
CREATE OR REPLACE FUNCTION faturamento.nota_evento_depois() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.tipo = 'cancelamento' AND NEW.status = 'registrado' AND OLD.status <> 'registrado' THEN
    UPDATE faturamento.nota SET status = 'cancelada', cancelada_em = NEW.registrado_em
    WHERE tenant_id = NEW.tenant_id AND id = NEW.nota_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS nota_evento_depois ON faturamento.nota_evento;
CREATE TRIGGER nota_evento_depois AFTER UPDATE ON faturamento.nota_evento
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_evento_depois();
DROP TRIGGER IF EXISTS nota_evento_sem_exclusao ON faturamento.nota_evento;
CREATE TRIGGER nota_evento_sem_exclusao BEFORE DELETE ON faturamento.nota_evento
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();
DROP TRIGGER IF EXISTS nota_evento_sem_truncate ON faturamento.nota_evento;
CREATE TRIGGER nota_evento_sem_truncate BEFORE TRUNCATE ON faturamento.nota_evento
  FOR EACH STATEMENT EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.nota_evento IS
  'Eventos da NF-e (RN-FAT-02): cancelamento (110111, um) e CC-e (110110, sequência 1 a 20). Pendente → registrado '
  '(só com o XML em nota_xml) | rejeitado; rejeitado volta a pendente com a mesma sequência; registrado não muda. Só '
  'em nota autorizada com o XML guardado (RN-FAT-03). O cancelamento registrado cancela a nota.';

-- ============================================================================================================
-- faturamento.inutilizacao (RN-FAT-01; T-0021, tabela 7)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.inutilizacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  modelo smallint NOT NULL DEFAULT 55 CHECK (modelo = 55),
  serie smallint NOT NULL CHECK (serie BETWEEN 0 AND 999),
  ano smallint NOT NULL CHECK (ano BETWEEN 2000 AND 2099),
  numero_inicial integer NOT NULL CHECK (numero_inicial BETWEEN 1 AND 999999999),
  numero_final integer NOT NULL CHECK (numero_final BETWEEN 1 AND 999999999),
  justificativa text NOT NULL CHECK (length(justificativa) BETWEEN 15 AND 255),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'registrado', 'rejeitado')),
  protocolo text CHECK (protocolo ~ '^[0-9]{15}$'),
  c_stat smallint CHECK (c_stat BETWEEN 100 AND 999),
  x_motivo text CHECK (length(x_motivo) <= 255),
  registrado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT inutilizacao_faixa CHECK (numero_final >= numero_inicial),
  CONSTRAINT inutilizacao_registrada CHECK (status <> 'registrado' OR (protocolo IS NOT NULL AND registrado_em IS NOT NULL)),
  CONSTRAINT inutilizacao_sem_exclusao_logica CHECK (deleted_at IS NULL)
);
SELECT controle.preparar_tabela('faturamento.inutilizacao');
CREATE INDEX IF NOT EXISTS inutilizacao_faixa_idx ON faturamento.inutilizacao
  (tenant_id, filial_id, ambiente, modelo, serie, numero_inicial, numero_final) WHERE status <> 'rejeitado';

-- O número está numa inutilização não rejeitada (ou só nas registradas, com p_so_registrada) da série?
CREATE OR REPLACE FUNCTION faturamento.numero_inutilizado(p_tenant uuid, p_filial uuid, p_ambiente text,
  p_modelo smallint, p_serie smallint, p_numero integer, p_so_registrada boolean DEFAULT false)
  RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM faturamento.inutilizacao i
    WHERE i.tenant_id = p_tenant AND i.filial_id = p_filial AND i.ambiente = p_ambiente AND i.modelo = p_modelo
      AND i.serie = p_serie AND p_numero BETWEEN i.numero_inicial AND i.numero_final
      AND CASE WHEN p_so_registrada THEN i.status = 'registrado' ELSE i.status <> 'rejeitado' END)
$$;

-- INSERT (nasce pendente): ambiente pela filial; trava o contador da série (serializa as inutilizações dela) e as notas
-- da faixa (serializa com o reenvio da rejeitada, nas duas ordens); começa no máximo no próximo número (não abre
-- buraco); não se sobrepõe a outra faixa não rejeitada; só cobre nota rejeitada ou rascunho; se passa do próximo
-- número, a numeração avança junto (app e worker: até 100 números a partir do próximo; o dono, sem limite).
-- UPDATE: pendente → registrado (só com o XML guardado) | rejeitado; registrada e rejeitada não mudam mais.
CREATE OR REPLACE FUNCTION faturamento.inutilizacao_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  prox integer;
  k text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'pendente' THEN
      RAISE EXCEPTION 'RN-FAT-01: inutilização % não muda', OLD.status USING ERRCODE = 'insufficient_privilege';
    END IF;
    k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['status', 'protocolo', 'c_stat', 'x_motivo', 'registrado_em', 'updated_at']);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-01: % da inutilização não muda', k USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'registrado' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_xml x
        WHERE x.tenant_id = NEW.tenant_id AND x.inutilizacao_id = NEW.id) THEN
      RAISE EXCEPTION 'RN-FAT-03: a inutilização só fica registrada com o XML guardado'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  NEW.ambiente := faturamento.ambiente_conferido(NEW.tenant_id, NEW.filial_id, NEW.ambiente);
  IF NEW.status <> 'pendente' THEN
    RAISE EXCEPTION 'RN-FAT-01: a inutilização nasce pendente' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.proximo INTO prox FROM faturamento.serie_numeracao s
  WHERE s.tenant_id = NEW.tenant_id AND s.filial_id = NEW.filial_id AND s.ambiente = NEW.ambiente
    AND s.modelo = NEW.modelo AND s.serie = NEW.serie
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RN-FAT-01: série % sem numeração nesta filial e ambiente', NEW.serie
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM faturamento.nota x
  WHERE x.tenant_id = NEW.tenant_id AND x.filial_id = NEW.filial_id AND x.ambiente = NEW.ambiente
    AND x.modelo = NEW.modelo AND x.serie = NEW.serie AND x.numero BETWEEN NEW.numero_inicial AND NEW.numero_final
  FOR UPDATE;
  IF NEW.numero_inicial > prox THEN
    RAISE EXCEPTION 'RN-FAT-01: a inutilização começa no máximo no próximo número (%)', prox
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.numero_final > prox + 99 AND NOT faturamento.sou_dono(TG_RELID) THEN
    RAISE EXCEPTION 'RN-FAT-01: a inutilização vai no máximo até o número % (100 a partir do próximo)', prox + 99
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM faturamento.inutilizacao i
      WHERE i.tenant_id = NEW.tenant_id AND i.filial_id = NEW.filial_id AND i.ambiente = NEW.ambiente
        AND i.modelo = NEW.modelo AND i.serie = NEW.serie AND i.status <> 'rejeitado'
        AND i.numero_inicial <= NEW.numero_final AND i.numero_final >= NEW.numero_inicial) THEN
    RAISE EXCEPTION 'RN-FAT-01: faixa já inutilizada (sobreposição)' USING ERRCODE = 'exclusion_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM faturamento.nota x
      WHERE x.tenant_id = NEW.tenant_id AND x.filial_id = NEW.filial_id AND x.ambiente = NEW.ambiente
        AND x.modelo = NEW.modelo AND x.serie = NEW.serie
        AND x.numero BETWEEN NEW.numero_inicial AND NEW.numero_final AND x.status NOT IN ('rejeitada', 'rascunho')) THEN
    RAISE EXCEPTION 'RN-FAT-01: a faixa tem nota que não está rejeitada nem em rascunho' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.numero_final >= prox THEN
    UPDATE faturamento.serie_numeracao SET proximo = NEW.numero_final + 1
    WHERE tenant_id = NEW.tenant_id AND filial_id = NEW.filial_id AND ambiente = NEW.ambiente
      AND modelo = NEW.modelo AND serie = NEW.serie;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inutilizacao_antes ON faturamento.inutilizacao;
CREATE TRIGGER inutilizacao_antes BEFORE INSERT OR UPDATE ON faturamento.inutilizacao
  FOR EACH ROW EXECUTE FUNCTION faturamento.inutilizacao_antes();

-- Registrada, as notas rejeitadas e os rascunhos da faixa passam a inutilizadas.
CREATE OR REPLACE FUNCTION faturamento.inutilizacao_depois() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.status = 'registrado' AND OLD.status <> 'registrado' THEN
    UPDATE faturamento.nota SET status = 'inutilizada'
    WHERE tenant_id = NEW.tenant_id AND filial_id = NEW.filial_id AND ambiente = NEW.ambiente AND modelo = NEW.modelo
      AND serie = NEW.serie AND numero BETWEEN NEW.numero_inicial AND NEW.numero_final
      AND status IN ('rejeitada', 'rascunho');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS inutilizacao_depois ON faturamento.inutilizacao;
CREATE TRIGGER inutilizacao_depois AFTER UPDATE ON faturamento.inutilizacao
  FOR EACH ROW EXECUTE FUNCTION faturamento.inutilizacao_depois();
DROP TRIGGER IF EXISTS inutilizacao_sem_exclusao ON faturamento.inutilizacao;
CREATE TRIGGER inutilizacao_sem_exclusao BEFORE DELETE ON faturamento.inutilizacao
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();
DROP TRIGGER IF EXISTS inutilizacao_sem_truncate ON faturamento.inutilizacao;
CREATE TRIGGER inutilizacao_sem_truncate BEFORE TRUNCATE ON faturamento.inutilizacao
  FOR EACH STATEMENT EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.inutilizacao IS
  'Inutilização de faixa na SEFAZ (RN-FAT-01): o único caminho de número sem nota. Nasce pendente (já avança a '
  'numeração), passa a registrada só com o XML em nota_xml (as rejeitadas e os rascunhos da faixa viram inutilizadas) '
  'ou a rejeitada '
  '(a faixa volta a ser buraco, ver faturamento.buracos_numeracao). Sem sobreposição entre faixas não rejeitadas. '
  'A trava inutilização × reenvio e × nota no buraco supõe app e worker em READ COMMITTED (o padrão); em '
  'REPEATABLE READ a garantia não vale.';

-- ============================================================================================================
-- faturamento.nota_xml (RN-FAT-03; T-0021, tabela 5): XML da nota, dos eventos e da inutilização, só INSERT
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.nota_xml (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('nfe_autorizada', 'evento_cancelamento', 'evento_cce', 'inutilizacao')),
  nota_id uuid,
  evento_id uuid,
  inutilizacao_id uuid,
  chave_acesso text CHECK (chave_acesso ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'),
  protocolo text NOT NULL CHECK (protocolo ~ '^[0-9]{15}$'),
  xml text NOT NULL CHECK (length(xml) > 0),
  sha256 plataforma.sha256_hex NOT NULL,
  tamanho_bytes integer NOT NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  guardar_ate date NOT NULL,
  arquivo_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT nota_xml_hash CHECK (sha256::text = encode(sha256(convert_to(xml, 'UTF8')), 'hex')),
  CONSTRAINT nota_xml_tamanho CHECK (tamanho_bytes = octet_length(convert_to(xml, 'UTF8'))),
  -- 1º de janeiro do 6º ano depois do da guarda (5 anos contados do exercício seguinte, CTN art. 173), em UTC.
  CONSTRAINT nota_xml_guarda_minima CHECK (guardar_ate >=
    (date_trunc('year', guardado_em AT TIME ZONE 'UTC') + interval '6 years')::date),
  CONSTRAINT nota_xml_sem_exclusao_logica CHECK (deleted_at IS NULL),
  CONSTRAINT nota_xml_referencia CHECK (CASE tipo
    WHEN 'nfe_autorizada' THEN nota_id IS NOT NULL AND evento_id IS NULL AND inutilizacao_id IS NULL
      AND chave_acesso IS NOT NULL
    WHEN 'inutilizacao' THEN inutilizacao_id IS NOT NULL AND nota_id IS NULL AND evento_id IS NULL
    ELSE evento_id IS NOT NULL AND nota_id IS NOT NULL AND inutilizacao_id IS NULL AND chave_acesso IS NOT NULL END),
  FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota (tenant_id, id),
  FOREIGN KEY (tenant_id, evento_id) REFERENCES faturamento.nota_evento (tenant_id, id),
  FOREIGN KEY (tenant_id, inutilizacao_id) REFERENCES faturamento.inutilizacao (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.nota_xml');
CREATE UNIQUE INDEX IF NOT EXISTS nota_xml_autorizada_uq ON faturamento.nota_xml (nota_id) WHERE tipo = 'nfe_autorizada';
CREATE UNIQUE INDEX IF NOT EXISTS nota_xml_evento_uq ON faturamento.nota_xml (evento_id) WHERE evento_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nota_xml_inutilizacao_uq ON faturamento.nota_xml (inutilizacao_id)
  WHERE inutilizacao_id IS NOT NULL;
-- Q10: download por nota e tipo.
CREATE INDEX IF NOT EXISTS nota_xml_nota_tipo_idx ON faturamento.nota_xml (tenant_id, nota_id, tipo)
  WHERE nota_id IS NOT NULL;

-- Confere o documento de origem (status pendente e mesma chave e protocolo) e completa tamanho e guarda (o mínimo do
-- CHECK nota_xml_guarda_minima). guardado_em é o relógio do banco para a aplicação (só o dono informa outro, na
-- importação de XML antigo).
CREATE OR REPLACE FUNCTION faturamento.nota_xml_antes_inserir() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n faturamento.nota%ROWTYPE;
  e faturamento.nota_evento%ROWTYPE;
  i faturamento.inutilizacao%ROWTYPE;
BEGIN
  IF NOT faturamento.sou_dono(TG_RELID) OR NEW.guardado_em IS NULL THEN
    NEW.guardado_em := now();
  END IF;
  NEW.tamanho_bytes := coalesce(NEW.tamanho_bytes, octet_length(convert_to(NEW.xml, 'UTF8')));
  NEW.guardar_ate := coalesce(NEW.guardar_ate,
    (date_trunc('year', NEW.guardado_em AT TIME ZONE 'UTC') + interval '6 years')::date);

  IF NEW.tipo = 'nfe_autorizada' THEN
    SELECT * INTO n FROM faturamento.nota x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.nota_id;
    IF NOT FOUND OR n.status <> 'autorizada_guarda_pendente' THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML autorizado entra só na nota autorizada com guarda pendente'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.chave_acesso IS DISTINCT FROM n.chave_acesso OR NEW.protocolo IS DISTINCT FROM n.protocolo THEN
      RAISE EXCEPTION 'RN-FAT-03: chave ou protocolo do XML diferentes dos da nota' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.tipo IN ('evento_cancelamento', 'evento_cce') THEN
    SELECT * INTO e FROM faturamento.nota_evento x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.evento_id;
    IF NOT FOUND OR e.status <> 'pendente' OR NEW.tipo <> 'evento_' || e.tipo THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML do evento entra só no evento pendente do mesmo tipo'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.nota_id := coalesce(NEW.nota_id, e.nota_id);
    SELECT * INTO n FROM faturamento.nota x WHERE x.tenant_id = NEW.tenant_id AND x.id = e.nota_id;
    NEW.chave_acesso := coalesce(NEW.chave_acesso, n.chave_acesso);
    IF NEW.nota_id <> e.nota_id OR NEW.chave_acesso <> n.chave_acesso
       OR (e.protocolo IS NOT NULL AND NEW.protocolo <> e.protocolo) THEN
      RAISE EXCEPTION 'RN-FAT-03: nota, chave ou protocolo do XML diferentes dos do evento'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO i FROM faturamento.inutilizacao x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.inutilizacao_id;
    IF NOT FOUND OR i.status <> 'pendente' OR (i.protocolo IS NOT NULL AND NEW.protocolo <> i.protocolo) THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML da inutilização entra só na inutilização pendente, com o protocolo dela'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nota_xml_antes_inserir ON faturamento.nota_xml;
CREATE TRIGGER nota_xml_antes_inserir BEFORE INSERT ON faturamento.nota_xml
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_xml_antes_inserir();

-- Guardado o XML, o documento de origem avança na mesma transação (RN-FAT-03): nota a autorizada, evento e
-- inutilização a registrado (protocolo do XML; data do registro = a já informada ou a da guarda).
CREATE OR REPLACE FUNCTION faturamento.nota_xml_depois_inserir() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.tipo = 'nfe_autorizada' THEN
    UPDATE faturamento.nota SET status = 'autorizada'
    WHERE tenant_id = NEW.tenant_id AND id = NEW.nota_id AND status = 'autorizada_guarda_pendente';
  ELSIF NEW.tipo = 'inutilizacao' THEN
    UPDATE faturamento.inutilizacao SET status = 'registrado', protocolo = NEW.protocolo,
      registrado_em = coalesce(registrado_em, NEW.guardado_em)
    WHERE tenant_id = NEW.tenant_id AND id = NEW.inutilizacao_id AND status = 'pendente';
  ELSE
    UPDATE faturamento.nota_evento SET status = 'registrado', protocolo = NEW.protocolo,
      registrado_em = coalesce(registrado_em, NEW.guardado_em)
    WHERE tenant_id = NEW.tenant_id AND id = NEW.evento_id AND status = 'pendente';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS nota_xml_depois_inserir ON faturamento.nota_xml;
CREATE TRIGGER nota_xml_depois_inserir AFTER INSERT ON faturamento.nota_xml
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_xml_depois_inserir();

-- Imutável para todos; só o dono da tabela apaga, e só depois do guardar_ate (exclusão LGPD no prazo fiscal).
CREATE OR REPLACE FUNCTION faturamento.nota_xml_imutavel() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.guardar_ate < (now() AT TIME ZONE 'UTC')::date AND faturamento.sou_dono(TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'RN-FAT-03: o XML guardado é imutável (% recusado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS nota_xml_imutavel ON faturamento.nota_xml;
CREATE TRIGGER nota_xml_imutavel BEFORE UPDATE OR DELETE ON faturamento.nota_xml
  FOR EACH ROW EXECUTE FUNCTION faturamento.nota_xml_imutavel();
DROP TRIGGER IF EXISTS nota_xml_sem_truncate ON faturamento.nota_xml;
CREATE TRIGGER nota_xml_sem_truncate BEFORE TRUNCATE ON faturamento.nota_xml
  FOR EACH STATEMENT EXECUTE FUNCTION plataforma.proibir_alteracao();

COMMENT ON TABLE faturamento.nota_xml IS
  'XML autorizado da NF-e (nfeProc), dos eventos (procEventoNFe) e da inutilização (procInutNFe), guardado antes de '
  'qualquer outra coisa (RN-FAT-03, regra 7): só INSERT, sha256 e tamanho conferidos pelo banco, guarda mínima de 5 '
  'anos. A inserção leva a nota a autorizada e o evento ou a inutilização a registrado. Só o dono apaga, depois do '
  'guardar_ate. arquivo_id: cópia no S3 (plataforma.arquivo, opaco).';

-- ============================================================================================================
-- faturamento.contingencia (RN-FAT-05; T-0021, tabela 8)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.contingencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  modalidade text NOT NULL CHECK (modalidade IN ('svc_an', 'svc_rs')),
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 15 AND 256),
  inicio_em timestamptz NOT NULL DEFAULT now(),
  fim_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT contingencia_periodo CHECK (fim_em IS NULL OR fim_em >= inicio_em),
  CONSTRAINT contingencia_sem_exclusao_logica CHECK (deleted_at IS NULL)
);
SELECT controle.preparar_tabela('faturamento.contingencia');
CREATE UNIQUE INDEX IF NOT EXISTS contingencia_uma_aberta ON faturamento.contingencia (tenant_id, filial_id, ambiente)
  WHERE fim_em IS NULL;

-- INSERT: ambiente pela filial. UPDATE: só o fechamento (fim_em, uma vez); fechada não muda.
CREATE OR REPLACE FUNCTION faturamento.contingencia_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ambiente := faturamento.ambiente_conferido(NEW.tenant_id, NEW.filial_id, NEW.ambiente);
    RETURN NEW;
  END IF;
  k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW), ARRAY['fim_em', 'updated_at']);
  IF k IS NOT NULL OR OLD.fim_em IS NOT NULL THEN
    RAISE EXCEPTION 'RN-FAT-05: a contingência só recebe o fim, uma vez (% recusado)', coalesce(k, 'fim_em')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contingencia_antes ON faturamento.contingencia;
CREATE TRIGGER contingencia_antes BEFORE INSERT OR UPDATE ON faturamento.contingencia
  FOR EACH ROW EXECUTE FUNCTION faturamento.contingencia_antes();
DROP TRIGGER IF EXISTS contingencia_sem_exclusao ON faturamento.contingencia;
CREATE TRIGGER contingencia_sem_exclusao BEFORE DELETE ON faturamento.contingencia
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.contingencia IS
  'Períodos de contingência SVC (RN-FAT-05): uma aberta por tenant, filial e ambiente; só recebe o fim, uma vez. A '
  'nota passa a emitida_contingencia só com a contingência aberta.';

-- ============================================================================================================
-- faturamento.transmissao (T-0021, tabela 9): log das chamadas à SEFAZ, sem XML e sem dado pessoal
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.transmissao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nota_id uuid,
  evento_id uuid,
  inutilizacao_id uuid,
  servico text NOT NULL CHECK (servico IN ('autorizacao', 'ret_autorizacao', 'consulta', 'evento', 'inutilizacao',
    'status')),
  destino text NOT NULL CHECK (destino IN ('simulador', 'sefaz_am', 'svc')),
  tentativa smallint NOT NULL DEFAULT 1 CHECK (tentativa BETWEEN 1 AND 999),
  c_stat smallint CHECK (c_stat BETWEEN 100 AND 999),
  x_motivo text CHECK (length(x_motivo) <= 255),
  enviada_em timestamptz NOT NULL DEFAULT now(),
  respondida_em timestamptz,
  duracao_ms integer CHECK (duracao_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT transmissao_referencia CHECK (CASE servico
    WHEN 'status' THEN num_nonnulls(nota_id, evento_id, inutilizacao_id) = 0
    WHEN 'evento' THEN evento_id IS NOT NULL AND inutilizacao_id IS NULL
    WHEN 'inutilizacao' THEN inutilizacao_id IS NOT NULL AND num_nonnulls(nota_id, evento_id) = 0
    ELSE nota_id IS NOT NULL AND num_nonnulls(evento_id, inutilizacao_id) = 0 END),
  FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota (tenant_id, id),
  FOREIGN KEY (tenant_id, evento_id) REFERENCES faturamento.nota_evento (tenant_id, id),
  FOREIGN KEY (tenant_id, inutilizacao_id) REFERENCES faturamento.inutilizacao (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.transmissao');
CREATE INDEX IF NOT EXISTS transmissao_nota_idx ON faturamento.transmissao (tenant_id, nota_id, enviada_em)
  WHERE nota_id IS NOT NULL;
DROP TRIGGER IF EXISTS transmissao_sem_exclusao ON faturamento.transmissao;
CREATE TRIGGER transmissao_sem_exclusao BEFORE DELETE ON faturamento.transmissao
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.transmissao IS
  'Log das chamadas à SEFAZ (serviço, destino, tentativa, cStat, xMotivo, tempos). Sem XML e sem dado pessoal: o XML '
  'fica em nota_xml. Depois do INSERT só recebe a resposta (UPDATE por coluna).';

-- ============================================================================================================
-- faturamento.titulo e titulo_baixa (RN-FAT-06; T-0021, tabelas 10 e 11)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.titulo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nota_id uuid NOT NULL,
  filial_id uuid NOT NULL,
  cliente_id uuid NOT NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  parcela smallint NOT NULL CHECK (parcela BETWEEN 1 AND 999),
  total_parcelas smallint NOT NULL CHECK (total_parcelas BETWEEN 1 AND 999),
  vencimento date NOT NULL,
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  saldo_centavos bigint NOT NULL,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'baixado', 'cancelado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT titulo_parcela_uq UNIQUE (nota_id, parcela),
  CONSTRAINT titulo_parcela_no_total CHECK (parcela <= total_parcelas),
  CONSTRAINT titulo_saldo CHECK (saldo_centavos BETWEEN 0 AND valor_centavos),
  CONSTRAINT titulo_status_saldo CHECK ((status <> 'baixado' OR saldo_centavos = 0)
    AND (status <> 'aberto' OR saldo_centavos > 0)),
  FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.titulo');
-- Q6: saldo aberto por cliente (a consulta filtra ambiente = 'producao'). Q7: vencidos.
CREATE INDEX IF NOT EXISTS titulo_cliente_aberto_idx ON faturamento.titulo (tenant_id, cliente_id)
  WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS titulo_vencimento_aberto_idx ON faturamento.titulo (tenant_id, vencimento)
  WHERE status = 'aberto';

-- Filial, cliente e ambiente vêm da nota; o saldo é conferido contra as baixas em todo UPDATE (sem depender de
-- pg_trigger_depth). Resto: COMMENT da tabela.
CREATE OR REPLACE FUNCTION faturamento.titulo_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n faturamento.nota%ROWTYPE;
  k text;
  saldo bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW),
      ARRAY['vencimento', 'saldo_centavos', 'status', 'updated_at']);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-06: % do título não muda', k USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'cancelado' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'RN-FAT-06: título cancelado não muda' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- O saldo é sempre o valor menos as baixas não estornadas, e o status segue o saldo (o cancelamento, só do aberto).
    SELECT NEW.valor_centavos - coalesce(sum(b.valor_centavos), 0) INTO saldo FROM faturamento.titulo_baixa b
    WHERE b.tenant_id = NEW.tenant_id AND b.titulo_id = NEW.id AND b.estornada_em IS NULL;
    IF NEW.saldo_centavos IS DISTINCT FROM saldo
       OR (NEW.status = 'cancelado' AND OLD.status NOT IN ('aberto', 'cancelado'))
       OR (NEW.status <> 'cancelado' AND NEW.status <> CASE WHEN saldo = 0 THEN 'baixado' ELSE 'aberto' END) THEN
      RAISE EXCEPTION 'RN-FAT-06: saldo e baixa do título só por faturamento.titulo_baixa'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO n FROM faturamento.nota x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.nota_id;
  -- autorizada já implica o XML guardado (nota_antes_alterar).
  IF NOT FOUND OR n.status <> 'autorizada' THEN
    RAISE EXCEPTION 'RN-FAT-03: título só de nota autorizada com o XML guardado' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.cliente_id IS NOT NULL AND NEW.cliente_id <> n.cliente_id)
     OR (NEW.filial_id IS NOT NULL AND NEW.filial_id <> n.filial_id)
     OR (NEW.ambiente IS NOT NULL AND NEW.ambiente <> n.ambiente) THEN
    RAISE EXCEPTION 'RN-FAT-06: o título é do cliente, da filial e do ambiente da nota' USING ERRCODE = 'check_violation';
  END IF;
  NEW.cliente_id := n.cliente_id;
  NEW.filial_id := n.filial_id;
  NEW.ambiente := n.ambiente;
  IF NEW.status <> 'aberto' OR (NEW.saldo_centavos IS NOT NULL AND NEW.saldo_centavos <> NEW.valor_centavos) THEN
    RAISE EXCEPTION 'RN-FAT-06: o título nasce aberto, com saldo igual ao valor' USING ERRCODE = 'check_violation';
  END IF;
  NEW.saldo_centavos := NEW.valor_centavos;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS titulo_antes ON faturamento.titulo;
CREATE TRIGGER titulo_antes BEFORE INSERT OR UPDATE ON faturamento.titulo
  FOR EACH ROW EXECUTE FUNCTION faturamento.titulo_antes();
DROP TRIGGER IF EXISTS titulo_sem_exclusao ON faturamento.titulo;
CREATE TRIGGER titulo_sem_exclusao BEFORE DELETE ON faturamento.titulo
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.titulo IS
  'Títulos a receber (RN-FAT-06): parcela de total_parcelas, valor e saldo em centavos (0 ≤ saldo ≤ valor), status '
  'aberto | baixado | cancelado. Só de nota autorizada com o XML guardado (RN-FAT-03). Nasce aberto com saldo = valor; '
  'em todo UPDATE, saldo = valor menos as baixas não estornadas e status conforme o saldo; a aplicação só cancela o '
  'aberto ou muda o vencimento. Nota, parcela, valor, cliente, filial e ambiente não mudam.';

CREATE TABLE IF NOT EXISTS faturamento.titulo_baixa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  titulo_id uuid NOT NULL,
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  baixado_em timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid,
  forma text NOT NULL CHECK (length(forma) BETWEEN 1 AND 30),
  estornada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT titulo_baixa_sem_exclusao_logica CHECK (deleted_at IS NULL),
  FOREIGN KEY (tenant_id, titulo_id) REFERENCES faturamento.titulo (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.titulo_baixa');
CREATE INDEX IF NOT EXISTS titulo_baixa_titulo_idx ON faturamento.titulo_baixa (tenant_id, titulo_id);

-- INSERT: só em título aberto, nunca estornada. UPDATE: só o estorno (estornada_em, uma vez).
CREATE OR REPLACE FUNCTION faturamento.titulo_baixa_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  s text;
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT t.status INTO s FROM faturamento.titulo t WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.titulo_id;
    IF s IS DISTINCT FROM 'aberto' OR NEW.estornada_em IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-06: baixa só em título aberto (status %)', coalesce(s, 'inexistente')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW), ARRAY['estornada_em', 'updated_at']);
  IF k IS NOT NULL OR OLD.estornada_em IS NOT NULL OR NEW.estornada_em IS NULL THEN
    RAISE EXCEPTION 'RN-FAT-06: a baixa só recebe o estorno, uma vez (% recusado)', coalesce(k, 'estornada_em')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS titulo_baixa_antes ON faturamento.titulo_baixa;
CREATE TRIGGER titulo_baixa_antes BEFORE INSERT OR UPDATE ON faturamento.titulo_baixa
  FOR EACH ROW EXECUTE FUNCTION faturamento.titulo_baixa_antes();

-- A baixa abate o saldo (zerado = baixado; saldo negativo cai no CHECK titulo_saldo); o estorno devolve (volta a
-- aberto). A trava de linha do UPDATE serializa baixas concorrentes do mesmo título.
CREATE OR REPLACE FUNCTION faturamento.titulo_baixa_depois() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  delta bigint := CASE WHEN TG_OP = 'INSERT' THEN -NEW.valor_centavos ELSE NEW.valor_centavos END;
BEGIN
  UPDATE faturamento.titulo SET saldo_centavos = saldo_centavos + delta,
    status = CASE WHEN saldo_centavos + delta = 0 THEN 'baixado' ELSE 'aberto' END
  WHERE tenant_id = NEW.tenant_id AND id = NEW.titulo_id AND status <> 'cancelado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RN-FAT-06: título cancelado não recebe baixa nem estorno' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS titulo_baixa_depois ON faturamento.titulo_baixa;
CREATE TRIGGER titulo_baixa_depois AFTER INSERT OR UPDATE ON faturamento.titulo_baixa
  FOR EACH ROW EXECUTE FUNCTION faturamento.titulo_baixa_depois();
DROP TRIGGER IF EXISTS titulo_baixa_sem_exclusao ON faturamento.titulo_baixa;
CREATE TRIGGER titulo_baixa_sem_exclusao BEFORE DELETE ON faturamento.titulo_baixa
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.titulo_baixa IS
  'Baixas do título (RN-FAT-06): valor em centavos, forma, usuário (opaco). Abatem o saldo do título; o estorno '
  '(estornada_em, uma vez) devolve. Sem DELETE.';

-- ============================================================================================================
-- Sem buraco (RN-FAT-01; A2, Q1 e Q9): reserva transacional, conferência na confirmação e auditoria
-- ============================================================================================================
-- Reserva o próximo número da série na filial e no ambiente, travando a linha do contador até o fim da transação.
-- Chamada na mesma transação que grava (ou numera) a nota: no ROLLBACK o número volta. p_ambiente tem de ser o da
-- filial em core.ambiente_fiscal (senão erro); p_numero_inicial (filial.nfe_numero_inicial, pela porta de cadastros)
-- vale só na criação do contador. Roda com o papel e o tenant da sessão (sem SECURITY DEFINER).
CREATE OR REPLACE FUNCTION faturamento.reservar_numero(p_filial uuid, p_ambiente text, p_serie smallint,
  p_numero_inicial integer)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  t uuid := plataforma.tenant_atual();
  amb text;
  n integer;
BEGIN
  IF t IS NULL THEN
    RAISE EXCEPTION 'RN-FAT-01: sem tenant na sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_ambiente IS NULL THEN
    RAISE EXCEPTION 'RN-FAT-04: informe o ambiente da filial' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  amb := faturamento.ambiente_conferido(t, p_filial, p_ambiente);
  INSERT INTO faturamento.serie_numeracao (tenant_id, filial_id, ambiente, modelo, serie, numero_inicial, proximo)
  VALUES (t, p_filial, amb, 55, p_serie, p_numero_inicial, p_numero_inicial)
  ON CONFLICT (tenant_id, filial_id, ambiente, modelo, serie) DO NOTHING;
  UPDATE faturamento.serie_numeracao SET proximo = proximo + 1
  WHERE tenant_id = t AND filial_id = p_filial AND ambiente = amb AND modelo = 55 AND serie = p_serie
  RETURNING proximo - 1 INTO n;
  IF n IS NULL THEN
    RAISE EXCEPTION 'RN-FAT-01: numeração da série % não encontrada', p_serie USING ERRCODE = 'no_data_found';
  END IF;
  RETURN n;
END $$;
COMMENT ON FUNCTION faturamento.reservar_numero(uuid, text, smallint, integer) IS
  'RN-FAT-01 (A2): reserva o próximo número (trava o contador até o fim da transação; no ROLLBACK o número volta). '
  'Chame na mesma transação do INSERT ou da numeração da nota. p_ambiente diferente do da filial = erro (RN-FAT-04).';

-- Na confirmação: todo número que a numeração avançou tem nota ou inutilização não rejeitada (senão a transação cai e o
-- número volta).
CREATE OR REPLACE FUNCTION faturamento.conferir_sem_buraco() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  falta integer;
BEGIN
  IF NEW.proximo <= OLD.proximo THEN
    RETURN NULL;
  END IF;
  SELECT g INTO falta FROM generate_series(OLD.proximo, NEW.proximo - 1) g
  WHERE NOT EXISTS (SELECT 1 FROM faturamento.nota x
      WHERE x.tenant_id = NEW.tenant_id AND x.filial_id = NEW.filial_id AND x.ambiente = NEW.ambiente
        AND x.modelo = NEW.modelo AND x.serie = NEW.serie AND x.numero = g)
    AND NOT faturamento.numero_inutilizado(NEW.tenant_id, NEW.filial_id, NEW.ambiente, NEW.modelo, NEW.serie, g)
  ORDER BY g
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'RN-FAT-01: número % da série % reservado sem nota nem inutilização (buraco)', falta, NEW.serie
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS serie_numeracao_sem_buraco ON faturamento.serie_numeracao;
CREATE CONSTRAINT TRIGGER serie_numeracao_sem_buraco AFTER UPDATE ON faturamento.serie_numeracao
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION faturamento.conferir_sem_buraco();

-- Q9 (auditoria), com o papel e a RLS de quem chama; filtros nulos = todos. Ver o COMMENT da função.
CREATE OR REPLACE FUNCTION faturamento.buracos_numeracao(p_filial uuid DEFAULT NULL, p_ambiente text DEFAULT NULL,
  p_serie smallint DEFAULT NULL)
  RETURNS TABLE (filial_id uuid, ambiente text, modelo smallint, serie smallint, numero_inicial integer,
    numero_final integer)
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
  WITH s AS (
    SELECT * FROM faturamento.serie_numeracao s
    WHERE (p_filial IS NULL OR s.filial_id = p_filial) AND (p_ambiente IS NULL OR s.ambiente = p_ambiente)
      AND (p_serie IS NULL OR s.serie = p_serie)
  ), ocupado AS (
    SELECT s.id AS sid, s.numero_inicial - 1 AS ini, s.numero_inicial - 1 AS fim FROM s
    UNION ALL
    SELECT s.id, s.proximo, s.proximo FROM s
    UNION ALL
    SELECT s.id, n.numero, n.numero FROM s JOIN faturamento.nota n ON n.tenant_id = s.tenant_id
      AND n.filial_id = s.filial_id AND n.ambiente = s.ambiente AND n.modelo = s.modelo AND n.serie = s.serie
      AND n.numero IS NOT NULL
    UNION ALL
    SELECT s.id, i.numero_inicial, i.numero_final FROM s JOIN faturamento.inutilizacao i ON i.tenant_id = s.tenant_id
      AND i.filial_id = s.filial_id AND i.ambiente = s.ambiente AND i.modelo = s.modelo AND i.serie = s.serie
      AND i.status <> 'rejeitado'
  ), ordem AS (
    SELECT sid, ini, max(fim) OVER (PARTITION BY sid ORDER BY ini, fim
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS ate
    FROM ocupado
  )
  SELECT s.filial_id, s.ambiente, s.modelo, s.serie, o.ate + 1, o.ini - 1
  FROM ordem o JOIN s ON s.id = o.sid
  WHERE o.ini > o.ate + 1
  ORDER BY s.filial_id, s.ambiente, s.serie, o.ate
$$;
COMMENT ON FUNCTION faturamento.buracos_numeracao(uuid, text, smallint) IS
  'RN-FAT-01 (Q9): faixas [numero_inicial, numero_final] sem nota e sem inutilização não rejeitada, entre o número '
  'inicial da série e proximo - 1. Vazio = sem buraco.';

-- ============================================================================================================
-- Privilégios. Nenhum DELETE nas tabelas de fiscal e faturamento. App: API; worker: fila da SEFAZ; leitura: só SELECT,
-- sem XML, sem o retrato do destinatário, o transporte e o payload do pedido a faturar (dado pessoal, LGPD).
-- ============================================================================================================
GRANT SELECT, INSERT, UPDATE ON fiscal.regra_tributaria, fiscal.carga_aproximada TO macuxierp_app;
GRANT SELECT ON fiscal.regra_tributaria, fiscal.carga_aproximada TO macuxierp_leitura;

GRANT SELECT, INSERT ON faturamento.serie_numeracao TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (proximo) ON faturamento.serie_numeracao TO macuxierp_app, macuxierp_worker;
GRANT SELECT, INSERT, UPDATE ON faturamento.pedido_a_faturar, faturamento.nota, faturamento.nota_item,
  faturamento.nota_evento, faturamento.inutilizacao, faturamento.contingencia, faturamento.titulo
  TO macuxierp_app, macuxierp_worker;
GRANT SELECT, INSERT ON faturamento.nota_xml, faturamento.transmissao, faturamento.titulo_baixa
  TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (c_stat, x_motivo, respondida_em, duracao_ms) ON faturamento.transmissao TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (estornada_em) ON faturamento.titulo_baixa TO macuxierp_app, macuxierp_worker;

GRANT SELECT ON faturamento.serie_numeracao, faturamento.nota_item,
  faturamento.nota_evento, faturamento.inutilizacao, faturamento.contingencia, faturamento.transmissao,
  faturamento.titulo, faturamento.titulo_baixa TO macuxierp_leitura;
DO $$
DECLARE
  colunas text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO colunas FROM pg_attribute
  WHERE attrelid = 'faturamento.nota'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname NOT IN ('destinatario_retrato', 'transporte');
  EXECUTE format('GRANT SELECT (%s) ON faturamento.nota TO macuxierp_leitura', colunas);
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO colunas FROM pg_attribute
  WHERE attrelid = 'faturamento.nota_xml'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'xml';
  EXECUTE format('GRANT SELECT (%s) ON faturamento.nota_xml TO macuxierp_leitura', colunas);
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO colunas FROM pg_attribute
  WHERE attrelid = 'faturamento.pedido_a_faturar'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname <> 'payload';
  EXECUTE format('GRANT SELECT (%s) ON faturamento.pedido_a_faturar TO macuxierp_leitura', colunas);
END $$;

REVOKE ALL ON FUNCTION faturamento.reservar_numero(uuid, text, smallint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION faturamento.reservar_numero(uuid, text, smallint, integer) TO macuxierp_app, macuxierp_worker;
GRANT EXECUTE ON FUNCTION faturamento.buracos_numeracao(uuid, text, smallint)
  TO macuxierp_app, macuxierp_worker, macuxierp_leitura;

-- ============================================================================================================
-- cadastros.filial: indústria para o IPI (T-0020, lote 2). No fim, com espera curta pela trava da tabela em uso (motivo
-- na seção da 0011 do README).
-- ============================================================================================================
SET LOCAL lock_timeout = '5s';
ALTER TABLE cadastros.filial ADD COLUMN IF NOT EXISTS industrial_ipi boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN cadastros.filial.industrial_ipi IS
  'Filial industrial ou equiparada (contribuinte do IPI). Usada pelo fiscal na escolha das regras de IPI (T-0020).';
