-- 0025 — Schema sefaz_simulador: a memória do simulador da SEFAZ-AM (homologação, ADR 0008) sai da memória do worker
-- para o banco (T-0045, decisão R-20261122-022626), para o nProt não repetir quando o worker reinicia. Aditiva e
-- reexecutável. Detalhes em docs/banco/README.md (0025).

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS sefaz_simulador;
REVOKE ALL ON SCHEMA sefaz_simulador FROM PUBLIC;
GRANT USAGE ON SCHEMA sefaz_simulador TO macuxierp_worker;
COMMENT ON SCHEMA sefaz_simulador IS
  'Memória do simulador da SEFAZ-AM (homologação, ADR 0008, T-0045). Não é guarda fiscal: o XML de 5 anos é o '
  'nfeProc do faturamento. Retenção de 400 dias pelo job do worker. Só o macuxierp_worker acessa.';

-- Formatos repetidos num lugar só (domínios em text, sem char(n), como na 0013). Idempotentes, como na 0001 e na 0007.
DO $$
BEGIN
  CREATE DOMAIN sefaz_simulador.modo AS text CHECK (VALUE IN ('normal', 'svc-rs'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
DO $$
BEGIN
  CREATE DOMAIN sefaz_simulador.num15 AS text CHECK (VALUE ~ '^[0-9]{15}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
DO $$
BEGIN
  CREATE DOMAIN sefaz_simulador.ch_nfe AS text CHECK (VALUE ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
DO $$
BEGIN
  CREATE DOMAIN sefaz_simulador.c_stat AS text CHECK (VALUE ~ '^[0-9]{3}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ============================================================================================================
-- sefaz_simulador.nota: a NF-e autorizada, denegada ou cancelada no simulador (só o protNFe, nunca a NF-e)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS sefaz_simulador.nota (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  modo sefaz_simulador.modo NOT NULL,
  ch_nfe sefaz_simulador.ch_nfe NOT NULL,
  cnpj plataforma.cnpj NOT NULL,
  serie integer NOT NULL CONSTRAINT nota_serie_ck CHECK (serie > 0),
  nnf integer NOT NULL CONSTRAINT nota_nnf_ck CHECK (nnf > 0),
  dh_emi timestamptz NOT NULL,
  autorizada_em timestamptz NOT NULL,
  situacao text NOT NULL CONSTRAINT nota_situacao_ck CHECK (situacao IN ('autorizada', 'denegada', 'cancelada')),
  -- nProt do simulador começa com 9 (PREFIXO_NUMERO_SIMULADOR): nunca se mistura com protocolo real.
  n_prot sefaz_simulador.num15 NOT NULL CONSTRAINT nota_n_prot_simulado_ck CHECK (n_prot ~ '^9'),
  dig_val text,
  c_stat sefaz_simulador.c_stat NOT NULL,
  -- Data e hora no formato da SEFAZ (AAAA-MM-DDThh:mm:ssTZD), como foi devolvida: o texto vai igual na consulta.
  dh_recbto text NOT NULL,
  xml_prot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  -- Alvo da FK do evento; a chave repetida no destino é o 204.
  CONSTRAINT nota_chave_uq UNIQUE (tenant_id, filial_id, modo, ch_nfe),
  -- Mesmo número com outra chave: a base do 539.
  CONSTRAINT nota_numero_uq UNIQUE (tenant_id, filial_id, modo, cnpj, serie, nnf)
);
SELECT controle.preparar_tabela('sefaz_simulador.nota');
CREATE INDEX IF NOT EXISTS nota_purga_idx ON sefaz_simulador.nota (tenant_id, created_at);
COMMENT ON TABLE sefaz_simulador.nota IS
  'protNFe da nota autorizada, denegada ou cancelada no simulador, por destino (filial, modo); sem a NF-e inteira.';

-- ============================================================================================================
-- sefaz_simulador.evento: cancelamento e CC-e registrados (retEvento e o <evento> assinado)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS sefaz_simulador.evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  modo sefaz_simulador.modo NOT NULL,
  ch_nfe sefaz_simulador.ch_nfe NOT NULL,
  tp_evento text NOT NULL CONSTRAINT evento_tp_evento_ck CHECK (tp_evento ~ '^[0-9]{6}$'),
  n_seq_evento integer NOT NULL CONSTRAINT evento_n_seq_evento_ck CHECK (n_seq_evento > 0),
  -- Anulável como no contrato (ProtocoloEvento.nProt).
  n_prot sefaz_simulador.num15 CONSTRAINT evento_n_prot_simulado_ck CHECK (n_prot ~ '^9'),
  c_stat sefaz_simulador.c_stat NOT NULL,
  dh_reg_evento text NOT NULL,
  xml_ret text NOT NULL,
  -- O <evento> assinado, como chegou (vai no procEventoNFe da consulta). A CC-e traz o xCorrecao (texto livre).
  evento_xml text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT evento_seq_uq UNIQUE (tenant_id, filial_id, modo, ch_nfe, tp_evento, n_seq_evento),
  -- Evento só de nota do mesmo destino e tenant. A purga da nota leva os eventos junto.
  CONSTRAINT evento_nota_fk FOREIGN KEY (tenant_id, filial_id, modo, ch_nfe)
    REFERENCES sefaz_simulador.nota (tenant_id, filial_id, modo, ch_nfe) ON DELETE CASCADE
);
SELECT controle.preparar_tabela('sefaz_simulador.evento');
CREATE INDEX IF NOT EXISTS evento_purga_idx ON sefaz_simulador.evento (tenant_id, created_at);
COMMENT ON TABLE sefaz_simulador.evento IS
  'retEvento e o <evento> assinado (cancelamento e CC-e) de uma nota do simulador.';

-- ============================================================================================================
-- sefaz_simulador.inutilizacao: faixas homologadas (sem sobreposição: trava no código + faixa_sobreposta)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS sefaz_simulador.inutilizacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  modo sefaz_simulador.modo NOT NULL,
  cnpj plataforma.cnpj NOT NULL,
  serie integer NOT NULL CONSTRAINT inutilizacao_serie_ck CHECK (serie > 0),
  ano text NOT NULL CONSTRAINT inutilizacao_ano_ck CHECK (ano ~ '^[0-9]{2}$'),
  nnf_ini integer NOT NULL CONSTRAINT inutilizacao_nnf_ini_ck CHECK (nnf_ini > 0),
  nnf_fin integer NOT NULL,
  n_prot sefaz_simulador.num15 NOT NULL CONSTRAINT inutilizacao_n_prot_simulado_ck CHECK (n_prot ~ '^9'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT inutilizacao_faixa_ck CHECK (nnf_ini <= nnf_fin)
);
SELECT controle.preparar_tabela('sefaz_simulador.inutilizacao');
CREATE INDEX IF NOT EXISTS inutilizacao_faixa_idx ON sefaz_simulador.inutilizacao
  (tenant_id, filial_id, modo, cnpj, serie, ano, nnf_ini);
CREATE INDEX IF NOT EXISTS inutilizacao_purga_idx ON sefaz_simulador.inutilizacao (tenant_id, created_at);
COMMENT ON TABLE sefaz_simulador.inutilizacao IS
  'Faixas de numeração inutilizadas no simulador, por destino, CNPJ, série e ano.';

-- Existe faixa (não excluída) que cruza [p_ini, p_fin] no mesmo destino, CNPJ, série e ano, no tenant da sessão? A
-- RLS de quem chama filtra (SECURITY INVOKER); o tenant_id explícito vale também para o dono, que não tem RLS.
CREATE OR REPLACE FUNCTION sefaz_simulador.faixa_sobreposta(p_filial uuid, p_modo text, p_cnpj text, p_serie integer,
  p_ano text, p_ini integer, p_fin integer) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM sefaz_simulador.inutilizacao i
    WHERE i.tenant_id = plataforma.tenant_atual()
      AND i.filial_id = p_filial AND i.modo = p_modo AND i.cnpj = p_cnpj AND i.serie = p_serie
      AND i.ano = p_ano AND i.nnf_ini <= p_fin AND i.nnf_fin >= p_ini AND i.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION sefaz_simulador.faixa_sobreposta(uuid, text, text, integer, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sefaz_simulador.faixa_sobreposta(uuid, text, text, integer, text, integer, integer)
  TO macuxierp_worker;

-- ============================================================================================================
-- sefaz_simulador.recibo: lote assíncrono (nRec, prontoEm e os protNFe do lote)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS sefaz_simulador.recibo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  filial_id uuid NOT NULL,
  modo sefaz_simulador.modo NOT NULL,
  n_rec sefaz_simulador.num15 NOT NULL,
  dh_recbto text NOT NULL,
  -- A partir de quando a consulta do recibo responde 104 (tMed depois do recebimento).
  pronto_em timestamptz NOT NULL,
  protocolos jsonb NOT NULL DEFAULT '[]' CONSTRAINT recibo_protocolos_ck CHECK (jsonb_typeof(protocolos) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  -- Global (não por tenant): o nRec vem da sequência global seq_nrec.
  CONSTRAINT recibo_n_rec_uq UNIQUE (n_rec)
);
SELECT controle.preparar_tabela('sefaz_simulador.recibo');
CREATE INDEX IF NOT EXISTS recibo_purga_idx ON sefaz_simulador.recibo (tenant_id, created_at);
COMMENT ON TABLE sefaz_simulador.recibo IS
  'Lote assíncrono do simulador: nRec, pronto_em e os protNFe do lote (jsonb).';

-- ============================================================================================================
-- Sequências globais do nProt e do nRec (9 dígitos no simulador, sem CYCLE: esgotar dá erro, nunca repete)
-- ============================================================================================================
CREATE SEQUENCE IF NOT EXISTS sefaz_simulador.seq_nprot AS bigint MINVALUE 1 MAXVALUE 999999999 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS sefaz_simulador.seq_nrec AS bigint MINVALUE 1 MAXVALUE 999999999 NO CYCLE;
REVOKE ALL ON SEQUENCE sefaz_simulador.seq_nprot, sefaz_simulador.seq_nrec FROM PUBLIC;
GRANT USAGE ON SEQUENCE sefaz_simulador.seq_nprot, sefaz_simulador.seq_nrec TO macuxierp_worker;

-- ============================================================================================================
-- Privilégios: só o worker. DELETE para o job de purga de 400 dias (LGPD, opção 1). App e leitura sem nada.
-- ============================================================================================================
REVOKE ALL ON sefaz_simulador.nota, sefaz_simulador.evento, sefaz_simulador.inutilizacao, sefaz_simulador.recibo
  FROM PUBLIC, macuxierp_app, macuxierp_leitura;
GRANT SELECT, INSERT, UPDATE, DELETE ON sefaz_simulador.nota, sefaz_simulador.evento, sefaz_simulador.inutilizacao,
  sefaz_simulador.recibo TO macuxierp_worker;
