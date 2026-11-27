-- 0071 — Entrada de dados do banco do cliente no ERP (/entrada/v1; T-0057, parte B1; ADR 0014 §4 e §8). Aditiva e
-- reexecutável: tabelas novas (CREATE ... IF NOT EXISTS), CREATE OR REPLACE nas funções, REVOKE/GRANT e COMMENT. Não
-- muda nenhuma linha existente; a versão anterior da API roda sobre este esquema sem saber dele.
--
-- Corte (decisões 33 B e 34 B do Alexandre, 26/11/2026 21h08 de Manaus, R-20261126-210816): só o delta. A carga completa
-- responde 422 CARGA_COMPLETA_NAO_SUPORTADA na API e fica fora do banco (entrada_lote.modo só aceita 'delta'; a sessão de
-- carga, a trava de 30% e a portal_entrada_confirmar_inativacao vêm depois, por migração aditiva). Também ficam fora a
-- entrada_lote_erro (os erros por linha vão no jsonb entrada_lote.erros, sem o dado), o dono por entidade (§14) e as
-- filas de descida (§13).
--
-- Nomes alinhados ao contrato E1 (packages/platform-sdk/src/entrada.ts, PR #747, 8e4c8cd): a credencial é por
-- conector_id (ConectorIdEntrada), sem o "tipo" conector|api da ADR §4 (o E1 cria, troca e revoga pelo conector_id); o
-- prefixo tem 8 caracteres base64url (PREFIXO_CHAVE_ENTRADA_TAMANHO); a Idempotency-Key segue PADRAO_CHAVE_IDEMPOTENCIA;
-- o portal_entrada_ler devolve o PortalEntradaLeitura (credenciais, ultimo_sinal, lotes).

-- o USAGE no schema é da 0043

-- Os 10 cadastros da F2 (ENTIDADES_ENTRADA = ENTIDADES_HUB_F2 do SDK).
DO $$
BEGIN
  CREATE DOMAIN cadastros.entrada_entidade AS text CHECK (VALUE IN ('filial', 'vendedor', 'forma_pagamento',
    'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ConectorIdEntrada do SDK (1 a 100, começa por letra ou dígito).
DO $$
BEGIN
  CREATE DOMAIN cadastros.entrada_conector_id AS text COLLATE "C"
    CHECK (VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cadastros.entrada_credencial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  conector_id cadastros.entrada_conector_id NOT NULL,
  chave_hmac bytea NOT NULL CONSTRAINT entrada_credencial_chave_hmac_check CHECK (length(chave_hmac) = 32),
  chave_prefixo text NOT NULL CONSTRAINT entrada_credencial_chave_prefixo_check
    CHECK (chave_prefixo ~ '^[A-Za-z0-9_-]{8}$'),
  substituida_em timestamptz(3),
  revogada_em timestamptz(3),
  ultimo_uso_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 200)
);
SELECT controle.preparar_tabela('cadastros.entrada_credencial');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_credencial_conector_ativo_uq ON cadastros.entrada_credencial (conector_id)
  WHERE substituida_em IS NULL AND revogada_em IS NULL AND deleted_at IS NULL;
-- alvo da FK composta do lote (o conector do lote é o da credencial)
CREATE UNIQUE INDEX IF NOT EXISTS entrada_credencial_tenant_id_conector_uq ON cadastros.entrada_credencial
  (tenant_id, id, conector_id);
CREATE INDEX IF NOT EXISTS entrada_credencial_conector_idx ON cadastros.entrada_credencial (conector_id, tenant_id);

CREATE OR REPLACE FUNCTION cadastros.entrada_hmac_imutavel() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.chave_hmac IS DISTINCT FROM OLD.chave_hmac THEN
    RAISE EXCEPTION 'cadastros.entrada_credencial: o HMAC não muda (troca = credencial nova)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION cadastros.entrada_hmac_imutavel() IS
  'Gatilho (0071): recusa (42501) qualquer mudança de chave_hmac em cadastros.entrada_credencial; troca da chave = linha nova pelo portal_entrada_credencial_definir. ADR 0014 §4. T-0057.';
DROP TRIGGER IF EXISTS entrada_hmac_imutavel ON cadastros.entrada_credencial;
CREATE TRIGGER entrada_hmac_imutavel BEFORE UPDATE OF chave_hmac ON cadastros.entrada_credencial
  FOR EACH ROW EXECUTE FUNCTION cadastros.entrada_hmac_imutavel();

CREATE TABLE IF NOT EXISTS cadastros.entrada_lote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  credencial_id uuid NOT NULL,
  conector_id cadastros.entrada_conector_id NOT NULL,
  entidade cadastros.entrada_entidade NOT NULL,
  -- só o delta nesta etapa (decisão 34 B); a carga completa entra depois, com a sessão e a trava de 30%
  modo text NOT NULL DEFAULT 'delta' CONSTRAINT entrada_lote_modo_check CHECK (modo IN ('delta')),
  -- PADRAO_CHAVE_IDEMPOTENCIA do SDK
  idempotency_key text NOT NULL CONSTRAINT entrada_lote_idempotency_key_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  hash_corpo plataforma.sha256_hex NOT NULL,
  corpo jsonb CHECK (jsonb_typeof(corpo) = 'object'),
  -- LoteAceito.recebidos (registros + inválidas + omitidas) e as linhas com erro (LoteEntradaResumo)
  recebidos integer NOT NULL CHECK (recebidos >= 0),
  com_erro integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'recebido' CONSTRAINT entrada_lote_estado_check
    CHECK (estado IN ('recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou')),
  contagens jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(contagens) = 'object'),
  -- erros por linha: [{indice, external_id, campo, codigo}], nunca o dado (LoteResultado.erros)
  erros jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(erros) = 'array' AND jsonb_array_length(erros) <= 5500),
  erro_codigo text CHECK (erro_codigo ~ '^[a-z][a-z0-9_]{0,59}$'),
  -- o cursor da entidade depois do lote (LoteResultado.cursor); só nos estados concluídos
  cursor_alterado_em timestamptz(3),
  cursor_external_id text COLLATE "C" CHECK (length(cursor_external_id) BETWEEN 1 AND 200),
  processado_em timestamptz(3),
  concluido_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 200),
  CONSTRAINT entrada_lote_com_erro CHECK (com_erro BETWEEN 0 AND recebidos),
  CONSTRAINT entrada_lote_corpo_zerado CHECK ((estado IN ('recebido', 'processando')) = (corpo IS NOT NULL)),
  CONSTRAINT entrada_lote_final CHECK ((estado IN ('recebido', 'processando')) = (concluido_em IS NULL)),
  CONSTRAINT entrada_lote_falhou_com_codigo CHECK (estado <> 'falhou' OR erro_codigo IS NOT NULL),
  CONSTRAINT entrada_lote_cursor CHECK ((cursor_alterado_em IS NULL) = (cursor_external_id IS NULL)
    AND (cursor_alterado_em IS NULL OR estado IN ('concluido', 'concluido_com_erros'))),
  FOREIGN KEY (tenant_id, credencial_id, conector_id)
    REFERENCES cadastros.entrada_credencial (tenant_id, id, conector_id)
);
SELECT controle.preparar_tabela('cadastros.entrada_lote');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_lote_idempotencia_uq ON cadastros.entrada_lote
  (tenant_id, conector_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS entrada_lote_um_processando ON cadastros.entrada_lote (tenant_id, conector_id, entidade)
  WHERE estado = 'processando';
-- a fila: um lote por entidade e conector de cada vez, na ordem de chegada (ADR 0014 §3)
CREATE INDEX IF NOT EXISTS entrada_lote_fila_idx ON cadastros.entrada_lote (tenant_id, conector_id, entidade, created_at, id)
  WHERE estado IN ('recebido', 'processando');
-- os lotes recentes do portal
CREATE INDEX IF NOT EXISTS entrada_lote_recentes_idx ON cadastros.entrada_lote (tenant_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS cadastros.entrada_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  conector_id cadastros.entrada_conector_id NOT NULL,
  entidade cadastros.entrada_entidade NOT NULL,
  cursor_alterado_em timestamptz(3),
  cursor_external_id text COLLATE "C" CHECK (length(cursor_external_id) BETWEEN 1 AND 200),
  ultimo_lote_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 200),
  CONSTRAINT entrada_cursor_par CHECK ((cursor_alterado_em IS NULL) = (cursor_external_id IS NULL)),
  FOREIGN KEY (tenant_id, ultimo_lote_id) REFERENCES cadastros.entrada_lote (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.entrada_cursor');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_cursor_uq ON cadastros.entrada_cursor (tenant_id, conector_id, entidade);

CREATE TABLE IF NOT EXISTS cadastros.entrada_sinal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  conector_id cadastros.entrada_conector_id NOT NULL,
  ultimo_sinal_em timestamptz(3) NOT NULL,
  -- CorpoSinal.versao_conector
  versao_conector text NOT NULL CHECK (versao_conector ~ '^\d+\.\d+\.\d+$'),
  parado_por_versao boolean NOT NULL DEFAULT false,
  -- IP de origem já truncado pela API (nunca o endereço inteiro)
  ip_origem cidr CONSTRAINT entrada_sinal_ip_truncado
    CHECK ((family(ip_origem) = 4 AND masklen(ip_origem) <= 24) OR (family(ip_origem) = 6 AND masklen(ip_origem) <= 48)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 200)
);
SELECT controle.preparar_tabela('cadastros.entrada_sinal');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_sinal_uq ON cadastros.entrada_sinal (tenant_id, conector_id);

COMMENT ON TABLE cadastros.entrada_credencial IS
  'Credencial da entrada /entrada/v1 por conector_id (0071, ADR 0014 §4): só o HMAC-SHA256(pepper, chave) e o prefixo (8); a chave nunca fica no banco e o pepper fica no secret do servidor. Uma ativa por conector_id na plataforma; troca = linha nova. T-0057.';
COMMENT ON TABLE cadastros.entrada_lote IS
  'Lote recebido em POST /entrada/v1/lotes (0071): Idempotency-Key única por (tenant, conector_id), hash do corpo, corpo zerado no estado final, erros por linha sem o dado. Só delta nesta etapa. T-0057.';
COMMENT ON TABLE cadastros.entrada_cursor IS
  'CursorEntidade da entrada por (tenant, conector_id, entidade) (0071): alterado_em e external_id do último registro aplicado. T-0057.';
COMMENT ON TABLE cadastros.entrada_sinal IS
  'Último sinal do conector por (tenant, conector_id) (0071): instante, versão, parado_por_versao e IP de origem truncado. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Autenticação sem tenant (EXECUTE só do macuxierp_app)
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cadastros.entrada_autenticar(p_conector_id text)
  RETURNS TABLE (tenant_id uuid, credencial_id uuid, chave_hmac text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT c.tenant_id, c.id, encode(c.chave_hmac, 'hex')
    FROM cadastros.entrada_credencial c
    JOIN plataforma.tenant t ON t.id = c.tenant_id
   WHERE c.conector_id = p_conector_id
     AND c.substituida_em IS NULL AND c.revogada_em IS NULL AND c.deleted_at IS NULL
     AND plataforma.empresa_visivel(t)
$$;
COMMENT ON FUNCTION cadastros.entrada_autenticar(text) IS
  'Entrada /entrada/v1 (0071, ADR 0014 §4): roda antes do tenant (sem app.tenant_id). Para o conector_id (X-Macuxi-Conector-Id), devolve só tenant_id, credencial_id e chave_hmac (hex minúsculo, 64; o CredencialEntradaArmazenada da PortaCredencialEntrada.buscar do SDK) da credencial ativa (não revogada nem substituída) de empresa visível (zero ou uma linha); a API compara o HMAC com timingSafeEqual e só então abre a transação com o tenant. Situação da empresa e licença a API confere depois, já no tenant. Só macuxierp_app. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Funções do portal (EXECUTE só do macuxierp_config)
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cadastros.portal_entrada_ler(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := (plataforma.empresa_alvo_leitura(p_tenant)).id;
BEGIN
  RETURN jsonb_build_object(
    -- a linha mais nova de cada conector_id (a substituída some; a revogada aparece com revogada_em), até 20
    'credenciais', coalesce((
      SELECT jsonb_agg(jsonb_build_object('conector_id', c.conector_id, 'prefixo', c.chave_prefixo,
          'criada_em', plataforma.instante_iso(c.created_at), 'revogada_em', plataforma.instante_iso(c.revogada_em),
          'ultimo_uso_em', plataforma.instante_iso(c.ultimo_uso_em))
        ORDER BY (c.revogada_em IS NULL) DESC, c.created_at DESC, c.conector_id)
      FROM (SELECT x.* FROM (
              SELECT DISTINCT ON (y.conector_id) y.* FROM cadastros.entrada_credencial y
               WHERE y.tenant_id = v_t AND y.deleted_at IS NULL
               ORDER BY y.conector_id, y.created_at DESC, y.id DESC) x
            ORDER BY (x.revogada_em IS NULL) DESC, x.created_at DESC, x.conector_id LIMIT 20) c), '[]'::jsonb),
    'ultimo_sinal', (
      SELECT jsonb_build_object('conector_id', s.conector_id, 'em', plataforma.instante_iso(s.ultimo_sinal_em),
        'versao_conector', s.versao_conector)
      FROM cadastros.entrada_sinal s WHERE s.tenant_id = v_t AND s.deleted_at IS NULL
      ORDER BY s.ultimo_sinal_em DESC, s.conector_id LIMIT 1),
    -- LIMITE_LOTES_PORTAL_ENTRADA = 50, do mais novo para o mais antigo
    'lotes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('lote_id', l.id, 'entidade', l.entidade, 'modo', l.modo, 'status', l.estado,
          'recebidos', l.recebidos, 'com_erro', l.com_erro, 'recebido_em', plataforma.instante_iso(l.created_at),
          'concluido_em', plataforma.instante_iso(l.concluido_em))
        ORDER BY l.created_at DESC, l.id DESC)
      FROM (SELECT * FROM cadastros.entrada_lote z WHERE z.tenant_id = v_t AND z.deleted_at IS NULL
             ORDER BY z.created_at DESC, z.id DESC LIMIT 50) l), '[]'::jsonb));
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_ler(uuid) IS
  'Portal /config (0071, ADR 0014 §4): o PortalEntradaLeitura do SDK da empresa visível: credenciais (a linha mais nova de cada conector_id, até 20, sem HMAC: conector_id, prefixo, criada_em, revogada_em, ultimo_uso_em), ultimo_sinal ({conector_id, em, versao_conector} | null) e os 50 lotes mais novos (lote_id, entidade, modo, status, recebidos, com_erro, recebido_em, concluido_em). Sem trava nem auditoria. MXS01, P0002. Só macuxierp_config. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.portal_entrada_credencial_definir(p_tenant uuid, p_conector_id text,
  p_chave_hmac bytea, p_chave_prefixo text, p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := plataforma.portal_empresa_licenciada(p_tenant, 'cadastros');
  v_ant cadastros.entrada_credencial;
  v_nova cadastros.entrada_credencial;
BEGIN
  IF p_conector_id IS NULL OR p_conector_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' THEN
    RAISE EXCEPTION 'conector_id fora do formato' USING ERRCODE = 'check_violation', DETAIL = 'conector_id_invalido';
  END IF;
  IF p_chave_hmac IS NULL OR length(p_chave_hmac) <> 32 THEN
    RAISE EXCEPTION 'HMAC da chave fora do formato (32 bytes)' USING ERRCODE = 'check_violation',
      DETAIL = 'hmac_invalido';
  END IF;
  IF p_chave_prefixo IS NULL OR p_chave_prefixo !~ '^[A-Za-z0-9_-]{8}$' THEN
    RAISE EXCEPTION 'prefixo da chave fora do formato' USING ERRCODE = 'check_violation', DETAIL = 'prefixo_invalido';
  END IF;

  -- serializa o uso do conector_id na plataforma (criar ou trocar ao mesmo tempo, na mesma ou em outra empresa)
  PERFORM pg_advisory_xact_lock(hashtextextended('cadastros.entrada_credencial/' || p_conector_id, 0));

  -- o conector_id fica preso à empresa que o usou primeiro (inclusive em credencial substituída ou revogada)
  IF EXISTS (SELECT 1 FROM cadastros.entrada_credencial x
              WHERE x.conector_id = p_conector_id AND x.tenant_id <> v_t) THEN
    RAISE EXCEPTION 'conector_id já usado em outra empresa' USING ERRCODE = 'check_violation',
      DETAIL = 'conector_em_uso';
  END IF;

  SELECT * INTO v_ant FROM cadastros.entrada_credencial x
   WHERE x.tenant_id = v_t AND x.conector_id = p_conector_id AND x.substituida_em IS NULL AND x.revogada_em IS NULL
     AND x.deleted_at IS NULL
   FOR UPDATE;
  -- a anterior sai antes da nova entrar (uma ativa por conector_id): trocar invalida a chave anterior na hora
  IF v_ant.id IS NOT NULL THEN
    UPDATE cadastros.entrada_credencial SET substituida_em = now() WHERE tenant_id = v_t AND id = v_ant.id;
  END IF;
  INSERT INTO cadastros.entrada_credencial (tenant_id, conector_id, chave_hmac, chave_prefixo)
  VALUES (v_t, p_conector_id, p_chave_hmac, p_chave_prefixo)
  RETURNING * INTO v_nova;

  PERFORM plataforma.auditar_superadmin(v_t, v_sa,
    CASE WHEN v_ant.id IS NULL THEN 'cadastros.entrada.credencial.criar' ELSE 'cadastros.entrada.credencial.trocar' END,
    'entrada_credencial', v_nova.id,
    CASE WHEN v_ant.id IS NULL THEN NULL ELSE jsonb_build_object('conector_id', v_ant.conector_id) END,
    jsonb_build_object('conector_id', p_conector_id),
    p_request_id);

  RETURN jsonb_build_object('conector_id', v_nova.conector_id, 'prefixo', v_nova.chave_prefixo,
    'criada_em', plataforma.instante_iso(v_nova.created_at));
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_credencial_definir(uuid, text, bytea, text, text) IS
  'Portal /config (0071, ADR 0014 §4): cria ou troca a credencial do conector_id com o HMAC-SHA256(pepper, chave) já calculado pela API (32 bytes) e o prefixo (8 base64url); a chave nunca chega ao banco. Na troca, a ativa sai na hora (substituida_em). conector_id já usado em outra empresa, mesmo inativo = 23514 conector_em_uso; formato = 23514 conector_id_invalido | hmac_invalido | prefixo_invalido. Audita cadastros.entrada.credencial.criar|trocar só com o conector_id. Devolve {conector_id, prefixo, criada_em} (a API junta a chave e monta o CredencialEntradaCriada). MXS01, P0002, MXC04 (empresa_inativa | modulo_desligado, da plataforma.portal_empresa_licenciada). Só macuxierp_config. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.portal_entrada_credencial_revogar(p_tenant uuid, p_conector_id text,
  p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := (plataforma.empresa_alvo_leitura(p_tenant)).id;
  v_c cadastros.entrada_credencial;
  v_em timestamptz(3) := now();
BEGIN
  SELECT * INTO v_c FROM cadastros.entrada_credencial x
   WHERE x.tenant_id = v_t AND x.conector_id = p_conector_id AND x.substituida_em IS NULL AND x.revogada_em IS NULL
     AND x.deleted_at IS NULL
   FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION 'credencial não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE cadastros.entrada_credencial SET revogada_em = v_em WHERE tenant_id = v_t AND id = v_c.id;
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'cadastros.entrada.credencial.revogar', 'entrada_credencial', v_c.id,
    jsonb_build_object('conector_id', v_c.conector_id),
    jsonb_build_object('conector_id', v_c.conector_id, 'revogada', true),
    p_request_id);
  RETURN jsonb_build_object('conector_id', v_c.conector_id, 'revogada_em', plataforma.instante_iso(v_em));
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_credencial_revogar(uuid, text, text) IS
  'Portal /config (0071, ADR 0014 §4): revoga na hora a credencial ativa do conector_id na empresa (o entrada_autenticar deixa de achá-la); vale para qualquer empresa visível, mesmo suspensa ou sem licença (medida de segurança). Sem a ativa na empresa = P0002 "credencial não encontrada". Audita cadastros.entrada.credencial.revogar só com o conector_id. Devolve {conector_id, revogada_em}. MXS01, P0002. Só macuxierp_config. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios. Sem DELETE para ninguém (exclusão = deleted_at). Nada para PUBLIC.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION cadastros.entrada_hmac_imutavel(), cadastros.entrada_autenticar(text),
  cadastros.portal_entrada_ler(uuid),
  cadastros.portal_entrada_credencial_definir(uuid, text, bytea, text, text),
  cadastros.portal_entrada_credencial_revogar(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.entrada_autenticar(text) TO macuxierp_app;
GRANT EXECUTE ON FUNCTION cadastros.portal_entrada_ler(uuid),
  cadastros.portal_entrada_credencial_definir(uuid, text, bytea, text, text),
  cadastros.portal_entrada_credencial_revogar(uuid, text, text) TO macuxierp_config;

-- Credencial: o app lê só o resumo (nunca o HMAC, que sai só pela entrada_autenticar) e marca o uso depois de
-- autenticar; quem cria, troca e revoga é o portal. O worker e a leitura não veem a tabela.
GRANT SELECT (id, tenant_id, conector_id, chave_prefixo, substituida_em, revogada_em, ultimo_uso_em, created_at,
  updated_at, deleted_at, external_id) ON cadastros.entrada_credencial TO macuxierp_app;
GRANT UPDATE (ultimo_uso_em) ON cadastros.entrada_credencial TO macuxierp_app;

-- Lote: o app grava no POST e lê no GET; o worker processa (estado, contagens, erros, cursor e o corpo zerado).
GRANT SELECT, INSERT ON cadastros.entrada_lote TO macuxierp_app;
GRANT SELECT ON cadastros.entrada_lote TO macuxierp_worker;
GRANT UPDATE (estado, corpo, com_erro, contagens, erros, erro_codigo, cursor_alterado_em, cursor_external_id,
  processado_em, concluido_em) ON cadastros.entrada_lote TO macuxierp_worker;

-- Cursor: o app lê (GET /cursores); o worker avança.
GRANT SELECT ON cadastros.entrada_cursor TO macuxierp_app;
GRANT SELECT, INSERT ON cadastros.entrada_cursor TO macuxierp_worker;
GRANT UPDATE (cursor_alterado_em, cursor_external_id, ultimo_lote_id) ON cadastros.entrada_cursor TO macuxierp_worker;

-- Sinal: o app grava o último (upsert por tenant e conector_id).
GRANT SELECT, INSERT ON cadastros.entrada_sinal TO macuxierp_app;
GRANT UPDATE (ultimo_sinal_em, versao_conector, parado_por_versao, ip_origem) ON cadastros.entrada_sinal TO macuxierp_app;

-- Leitura: o próprio tenant, menos a credencial.
GRANT SELECT ON cadastros.entrada_lote, cadastros.entrada_cursor, cadastros.entrada_sinal TO macuxierp_leitura;
