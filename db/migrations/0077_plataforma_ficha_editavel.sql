-- 0077 — Ficha da Receita editável no /config (v0.3.24, RN-CORE-16). Aditiva e reexecutável.
-- Entram: 'manual' no CHECK da receita_fonte; interna plataforma.cnpj_valido; faturamento.tem_nfe_autorizada_producao
-- (só boolean); plataforma.empresa_salvar_ficha e plataforma.empresa_trocar_cnpj, só para macuxierp_config.
-- A empresa_gravar_receita (0063) fica como está. O porquê: docs/banco/README.md, seção "Ficha editável e troca de CNPJ".

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- 'manual' na fonte da ficha. O CHECK da 0063 tem nome gerado: sai qualquer CHECK da coluna e entra um com nome fixo.
-- Alargar não invalida linha: NOT VALID + VALIDATE só evita a varredura sob trava forte.
-- ---------------------------------------------------------------------------------------------------------------
DO $fonte$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'core.empresa'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%receita_fonte%' LOOP
    EXECUTE format('ALTER TABLE core.empresa DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $fonte$;
ALTER TABLE core.empresa ADD CONSTRAINT empresa_receita_fonte_check
  CHECK (receita_fonte IN ('brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz', 'manual')) NOT VALID;
ALTER TABLE core.empresa VALIDATE CONSTRAINT empresa_receita_fonte_check;
COMMENT ON COLUMN core.empresa.receita_fonte IS
  'Ficha da Receita (0063; manual na 0077): FonteConsulta da última consulta gravada, ou manual quando a pessoa salvou a ficha no /config.';

-- ---------------------------------------------------------------------------------------------------------------
-- Internas (sem EXECUTE para ninguém).
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.cnpj_valido(p_cnpj text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_soma integer;
  v_resto integer;
  v_dv integer;
  n integer;
  i integer;
BEGIN
  IF p_cnpj IS NULL OR p_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' OR p_cnpj ~ '^(.)\1{13}$' THEN
    RETURN false;
  END IF;
  FOR n IN 12..13 LOOP
    v_soma := 0;
    FOR i IN 1..n LOOP
      v_soma := v_soma + (ascii(substr(p_cnpj, i, 1)) - 48) * (((n - i) % 8) + 2);
    END LOOP;
    v_resto := v_soma % 11;
    v_dv := CASE WHEN v_resto < 2 THEN 0 ELSE 11 - v_resto END;
    IF substr(p_cnpj, n + 1, 1)::integer <> v_dv THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;
COMMENT ON FUNCTION plataforma.cnpj_valido(text) IS
  'Interna (0077): CNPJ de 14 caracteres já normalizado (12 alfanuméricos maiúsculos + 2 dígitos) com os dois DV certos (cálculo alfanumérico da RFB, ASCII − 48); todos iguais ou NULL = false. RN-CORE-16.';

CREATE OR REPLACE FUNCTION plataforma.ficha_exigir(p_campo text, p_bruto text, p_valor anyelement) RETURNS anyelement
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_valor IS NULL AND nullif(btrim(p_bruto), '') IS NOT NULL THEN
    RAISE EXCEPTION 'campo inválido: %', p_campo USING ERRCODE = 'check_violation';
  END IF;
  RETURN p_valor;
END $$;
COMMENT ON FUNCTION plataforma.ficha_exigir(text, text, anyelement) IS
  'Interna (0077): devolve p_valor; se ele é NULL e p_bruto não é vazio, 23514 "campo inválido: <campo>" sem o valor. RN-CORE-16.';

CREATE OR REPLACE FUNCTION plataforma.empresa_travada(p_tenant uuid) RETURNS core.empresa
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  e core.empresa;
BEGIN
  SELECT * INTO e FROM core.empresa x
    WHERE x.id = plataforma.empresa_core_id(p_tenant) AND x.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a empresa não tem cadastro (filial padrão)' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN e;
END $$;
COMMENT ON FUNCTION plataforma.empresa_travada(uuid) IS
  'Interna (0077): a core.empresa viva do tenant, travada (FOR UPDATE); sem ela = 55000. RN-CORE-16.';

CREATE OR REPLACE FUNCTION plataforma.empresa_publicar_cnpj(p_tenant uuid, p_empresa uuid, p_cnpj text,
  p_request_id text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_req text := coalesce(nullif(btrim(p_request_id), ''), 'plataforma-' || v_id::text);
  v_agora timestamptz := now();
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_empresa::text, 0));
  INSERT INTO plataforma.evento (id, tenant_id, nome, agregado_id, versao, ocorrido_em, proximo_em, payload)
  SELECT v_id, p_tenant, 'core.empresa.cnpj_alterado@1', p_empresa, coalesce(max(e.versao), 0) + 1, v_agora, v_agora,
    jsonb_build_object('ator', 'sistema', 'request_id', v_req, 'payload', jsonb_build_object(
      'tenant_id', p_tenant, 'empresa_id', p_empresa, 'cnpj_novo', p_cnpj, 'request_id', v_req,
      'alterado_em', plataforma.instante_iso(v_agora)))
    FROM plataforma.evento e WHERE e.tenant_id = p_tenant AND e.agregado_id = p_empresa;
  RETURN v_id;
END $$;
COMMENT ON FUNCTION plataforma.empresa_publicar_cnpj(uuid, uuid, text, text) IS
  'Interna (0077): grava core.empresa.cnpj_alterado@1 no outbox (plataforma.evento) com o envelope do OutboxPg do SDK (ator sistema; request_id vazio vira plataforma-<id do evento>); payload {tenant_id, empresa_id, cnpj_novo, request_id, alterado_em ISO UTC}. Devolve o id do evento. RN-CORE-16.';

-- ---------------------------------------------------------------------------------------------------------------
-- Faturamento: a plataforma pergunta só "tem ou não tem", sem ler a tabela do faturamento (regra 1).
-- ---------------------------------------------------------------------------------------------------------------
-- Regra do modulo-faturamento (porta TS modules/faturamento/domain/nfe-producao.ts, STATUS_NFE_QUE_TRAVA_TROCA_CNPJ).
CREATE INDEX IF NOT EXISTS nota_autorizada_producao_idx ON faturamento.nota (tenant_id)
  WHERE ambiente = 'producao' AND status IN ('autorizada', 'autorizada_guarda_pendente', 'cancelada', 'em_autorizacao',
      'emitida_contingencia')
    AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION faturamento.tem_nfe_autorizada_producao(p_tenant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM faturamento.nota n
                  WHERE n.tenant_id = p_tenant AND n.ambiente = 'producao'
                    AND n.status IN ('autorizada', 'autorizada_guarda_pendente', 'cancelada', 'em_autorizacao',
      'emitida_contingencia') AND n.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION faturamento.tem_nfe_autorizada_producao(uuid) IS
  'Interna (0077): true se o tenant tem NF-e de produção não excluída num status que trava a troca do CNPJ; espelha STATUS_NFE_QUE_TRAVA_TROCA_CNPJ (modules/faturamento/domain/nfe-producao.ts). Só boolean; quem chama é a empresa_trocar_cnpj. Regra fiscal 7, RN-CORE-16.';

-- ---------------------------------------------------------------------------------------------------------------
-- Portal /config.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.empresa_salvar_ficha(p_id uuid, p_ficha jsonb, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_colunas CONSTANT text[] := ARRAY['razao_social', 'nome_fantasia', 'ie', 'logradouro', 'numero', 'complemento',
    'bairro', 'cep', 'municipio_ibge', 'uf', 'email', 'telefone', 'cnae_principal', 'regime_receita',
    'situacao_cadastral', 'situacao_cadastral_data', 'data_abertura', 'natureza_juridica', 'porte', 'cnae_secundarios'];
  v_chaves CONSTANT text[] := v_colunas || ARRAY['fonte', 'consultado_em'];
  v_ufs CONSTANT text[] := ARRAY['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  t plataforma.tenant;
  e core.empresa;
  n core.empresa;
  v_fora text;
  v_fonte text := p_ficha ->> 'fonte';
  v_quando timestamptz;
  v_bruto text;
  v_txt text;
  v_alterados text[];
BEGIN
  IF p_ficha IS NULL OR jsonb_typeof(p_ficha) <> 'object' THEN
    RAISE EXCEPTION 'ficha inválida' USING ERRCODE = 'check_violation';
  END IF;
  -- Só nomes de chave na mensagem, nunca valores (LGPD). CNPJ, código, tenant e ambiente ficam fora da lista.
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_fora FROM jsonb_object_keys(p_ficha) k WHERE k <> ALL (v_chaves);
  IF v_fora IS NOT NULL THEN
    RAISE EXCEPTION 'campo fora da lista fechada da ficha: %', v_fora USING ERRCODE = 'check_violation';
  END IF;
  IF v_fonte IS NULL OR v_fonte NOT IN ('brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz', 'manual') THEN
    RAISE EXCEPTION 'fonte inválida' USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    v_quando := coalesce((p_ficha ->> 'consultado_em')::timestamptz, now());
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_text_representation THEN
    RAISE EXCEPTION 'consultado_em inválido' USING ERRCODE = 'check_violation';
  END;
  IF v_quando > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'consultado_em no futuro' USING ERRCODE = 'check_violation';
  END IF;

  t := plataforma.empresa_alvo(p_id, false);
  e := plataforma.empresa_travada(t.id);

  -- Repetição do mesmo request_id: nada muda, devolve o que a primeira gravou.
  IF p_request_id IS NOT NULL THEN
    SELECT a.depois -> 'campos' INTO v_txt FROM plataforma.auditoria a
     WHERE a.tenant_id = t.id AND a.entidade = 'empresa' AND a.entidade_id = e.id
       AND a.acao = 'plataforma.empresa.salvar_ficha' AND a.request_id = p_request_id
     ORDER BY a.ocorrido_em LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ficha', plataforma.empresa_ficha_json(t.id), 'alterados', v_txt::jsonb);
    END IF;
  END IF;

  -- Digitação: chave ausente = mantém; null ou vazio = apaga (razão social não); formato inválido = 23514 só com o
  -- nome do campo (na 0063 a Receita virava NULL; aqui a pessoa corrige).
  n := e;
  IF p_ficha ? 'razao_social' THEN
    v_txt := plataforma.receita_texto('razao_social', p_ficha ->> 'razao_social', 150);
    IF v_txt IS NULL OR length(v_txt) < 2 THEN
      RAISE EXCEPTION 'campo obrigatório: razao_social' USING ERRCODE = 'check_violation';
    END IF;
    n.razao_social := v_txt;
  END IF;
  IF p_ficha ? 'nome_fantasia' THEN
    n.nome_fantasia := plataforma.receita_texto('nome_fantasia', p_ficha ->> 'nome_fantasia', 150);
  END IF;
  IF p_ficha ? 'ie' THEN
    -- Inscrição estadual: só dígitos (2 a 14) ou ISENTO; pontuação sai.
    v_bruto := p_ficha ->> 'ie';
    v_txt := upper(regexp_replace(coalesce(v_bruto, ''), '[.\-/[:space:]]', '', 'g'));
    n.ie := plataforma.ficha_exigir('ie', v_bruto, CASE WHEN v_txt ~ '^([0-9]{2,14}|ISENTO)$' THEN v_txt END);
  END IF;
  IF p_ficha ? 'logradouro' THEN
    n.logradouro := plataforma.receita_texto('logradouro', p_ficha ->> 'logradouro', 120);
  END IF;
  IF p_ficha ? 'numero' THEN n.numero := plataforma.receita_texto('numero', p_ficha ->> 'numero', 20); END IF;
  IF p_ficha ? 'complemento' THEN
    n.complemento := plataforma.receita_texto('complemento', p_ficha ->> 'complemento', 120);
  END IF;
  IF p_ficha ? 'bairro' THEN n.bairro := plataforma.receita_texto('bairro', p_ficha ->> 'bairro', 80); END IF;
  IF p_ficha ? 'situacao_cadastral' THEN
    n.situacao_cadastral := plataforma.receita_texto('situacao_cadastral', p_ficha ->> 'situacao_cadastral', 60);
  END IF;
  IF p_ficha ? 'natureza_juridica' THEN
    n.natureza_juridica := plataforma.receita_texto('natureza_juridica', p_ficha ->> 'natureza_juridica', 120);
  END IF;
  IF p_ficha ? 'porte' THEN n.porte := plataforma.receita_texto('porte', p_ficha ->> 'porte', 60); END IF;
  IF p_ficha ? 'cep' THEN
    v_bruto := p_ficha ->> 'cep';
    n.cep := plataforma.ficha_exigir('cep', v_bruto, plataforma.receita_digitos(v_bruto, '^[0-9]{8}$'));
  END IF;
  IF p_ficha ? 'municipio_ibge' THEN
    v_bruto := p_ficha ->> 'municipio_ibge';
    n.municipio_ibge := plataforma.ficha_exigir('municipio_ibge', v_bruto,
      plataforma.receita_digitos(v_bruto, '^[0-9]{7}$'));
  END IF;
  IF p_ficha ? 'uf' THEN
    v_bruto := p_ficha ->> 'uf';
    v_txt := upper(btrim(v_bruto));
    n.uf := plataforma.ficha_exigir('uf', v_bruto, CASE WHEN v_txt = ANY (v_ufs) THEN v_txt END);
  END IF;
  IF p_ficha ? 'email' THEN
    v_bruto := p_ficha ->> 'email';
    v_txt := lower(btrim(v_bruto));
    n.email := plataforma.ficha_exigir('email', v_bruto,
      CASE WHEN length(v_txt) <= 254 AND v_txt ~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN v_txt END);
  END IF;
  IF p_ficha ? 'telefone' THEN
    v_bruto := p_ficha ->> 'telefone';
    n.telefone := plataforma.ficha_exigir('telefone', v_bruto, plataforma.receita_digitos(v_bruto, '^[0-9]{10,11}$'));
  END IF;
  IF p_ficha ? 'cnae_principal' THEN
    v_bruto := p_ficha ->> 'cnae_principal';
    n.cnae_principal := plataforma.ficha_exigir('cnae_principal', v_bruto,
      lpad(plataforma.receita_digitos(v_bruto, '^[0-9]{6,7}$'), 7, '0'));
  END IF;
  IF p_ficha ? 'regime_receita' THEN
    v_bruto := p_ficha ->> 'regime_receita';
    v_txt := lower(btrim(v_bruto));
    n.regime_receita := plataforma.ficha_exigir('regime_receita', v_bruto,
      CASE WHEN v_txt IN ('mei', 'simples', 'normal') THEN v_txt END);
  END IF;
  IF p_ficha ? 'situacao_cadastral_data' THEN
    v_bruto := p_ficha ->> 'situacao_cadastral_data';
    n.situacao_cadastral_data := plataforma.ficha_exigir('situacao_cadastral_data', v_bruto,
      plataforma.receita_data(v_bruto));
  END IF;
  IF p_ficha ? 'data_abertura' THEN
    v_bruto := p_ficha ->> 'data_abertura';
    n.data_abertura := plataforma.ficha_exigir('data_abertura', v_bruto, plataforma.receita_data(v_bruto));
  END IF;
  IF p_ficha ? 'cnae_secundarios' THEN
    IF jsonb_typeof(p_ficha -> 'cnae_secundarios') = 'null' THEN
      n.cnae_secundarios := NULL;
    ELSIF jsonb_typeof(p_ficha -> 'cnae_secundarios') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_ficha -> 'cnae_secundarios') i (valor)
                   WHERE plataforma.receita_digitos(i.valor #>> '{}', '^[0-9]{6,7}$') IS NULL) THEN
      RAISE EXCEPTION 'campo inválido: cnae_secundarios' USING ERRCODE = 'check_violation';
    ELSE
      -- Códigos de 7 dígitos, na ordem digitada, sem repetidos.
      n.cnae_secundarios := (SELECT coalesce(jsonb_agg(c.codigo ORDER BY c.ordem), '[]'::jsonb)
         FROM (SELECT DISTINCT ON (v.codigo) v.codigo, v.ordem
                 FROM (SELECT lpad(plataforma.receita_digitos(i.valor #>> '{}', '^[0-9]{6,7}$'), 7, '0') AS codigo, i.ordem
                         FROM jsonb_array_elements(p_ficha -> 'cnae_secundarios') WITH ORDINALITY i (valor, ordem)) v
                ORDER BY v.codigo, v.ordem) c);
    END IF;
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_alterados
    FROM unnest(v_colunas) k WHERE to_jsonb(e) -> k IS DISTINCT FROM to_jsonb(n) -> k;

  -- Nada mudou: não toca a linha (nem fonte e data) e não audita.
  IF cardinality(v_alterados) = 0 THEN
    RETURN jsonb_build_object('ficha', plataforma.empresa_ficha_json(t.id), 'alterados', '[]'::jsonb);
  END IF;

  UPDATE core.empresa SET razao_social = n.razao_social, nome_fantasia = n.nome_fantasia, ie = n.ie,
      logradouro = n.logradouro, numero = n.numero, complemento = n.complemento, bairro = n.bairro, cep = n.cep,
      municipio_ibge = n.municipio_ibge, uf = n.uf, email = n.email, telefone = n.telefone,
      cnae_principal = n.cnae_principal, regime_receita = n.regime_receita,
      situacao_cadastral = n.situacao_cadastral, situacao_cadastral_data = n.situacao_cadastral_data,
      data_abertura = n.data_abertura, natureza_juridica = n.natureza_juridica, porte = n.porte,
      cnae_secundarios = n.cnae_secundarios, receita_fonte = v_fonte, receita_consultada_em = v_quando
    WHERE id = e.id;

  -- Auditoria só com os nomes dos campos e a contagem, nunca os valores (LGPD, regra 8).
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.empresa.salvar_ficha', 'empresa', e.id, NULL,
    jsonb_build_object('campos', to_jsonb(v_alterados), 'quantidade', cardinality(v_alterados)), p_request_id);
  RETURN jsonb_build_object('ficha', plataforma.empresa_ficha_json(t.id), 'alterados', to_jsonb(v_alterados));
END $$;
COMMENT ON FUNCTION plataforma.empresa_salvar_ficha(uuid, jsonb, text) IS
  'Portal /config (0077): grava a ficha digitada na core.empresa (sem CNPJ), com fonte (manual ou a da consulta) e consultado_em; idempotente pelo request_id; audita só os nomes dos campos. Devolve {ficha, alterados}. Erros: docs/banco/README.md. Só macuxierp_config. RN-CORE-16.';

CREATE OR REPLACE FUNCTION plataforma.empresa_trocar_cnpj(p_id uuid, p_cnpj text, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_cnpj text := upper(regexp_replace(coalesce(p_cnpj, ''), '[.\-/[:space:]]', '', 'g'));
  t plataforma.tenant;
  e core.empresa;
  v_evento uuid;
BEGIN
  IF NOT plataforma.cnpj_valido(v_cnpj) THEN
    RAISE EXCEPTION 'CNPJ inválido' USING ERRCODE = 'check_violation';
  END IF;
  t := plataforma.empresa_alvo(p_id, false);
  e := plataforma.empresa_travada(t.id);

  -- Repetição do mesmo request_id: nada muda nem gera outro evento; devolve o CNPJ atual e o event_id da primeira.
  IF p_request_id IS NOT NULL THEN
    SELECT (a.depois ->> 'event_id')::uuid INTO v_evento FROM plataforma.auditoria a
     WHERE a.tenant_id = t.id AND a.entidade = 'empresa' AND a.entidade_id = e.id
       AND a.acao = 'plataforma.empresa.trocar_cnpj' AND a.request_id = p_request_id
     ORDER BY a.ocorrido_em LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('cnpj', e.cnpj, 'event_id', v_evento);
    END IF;
  END IF;

  -- Regra fiscal 7: com NF-e de produção, a troca só pelo suporte. Conferido com a core.empresa travada.
  IF faturamento.tem_nfe_autorizada_producao(t.id) THEN
    RAISE EXCEPTION 'a empresa já tem NF-e autorizada em produção' USING ERRCODE = 'MXC05';
  END IF;
  IF e.cnpj = v_cnpj THEN
    RAISE EXCEPTION 'CNPJ igual ao atual' USING ERRCODE = 'MXC06';
  END IF;
  -- Sem índice único em core.empresa.cnpj nesta versão (R-20261127-122654): confere com a linha travada; duas trocas
  -- simultâneas para o mesmo CNPJ ainda podem correr (risco aceito; a troca é rara e só do superadmin).
  IF EXISTS (SELECT 1 FROM core.empresa o WHERE o.cnpj = v_cnpj AND o.deleted_at IS NULL AND o.id <> e.id) THEN
    RAISE EXCEPTION 'cnpj_em_uso' USING ERRCODE = 'unique_violation';
  END IF;

  -- Um ponto só: não escreve na filial; o cadastros preenche a filial padrão pelo evento, na mesma transação.
  UPDATE core.empresa SET cnpj = v_cnpj WHERE id = e.id;
  v_evento := plataforma.empresa_publicar_cnpj(t.id, e.id, v_cnpj, p_request_id);

  -- Auditoria só com o id do evento, sem nenhum CNPJ.
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.empresa.trocar_cnpj', 'empresa', e.id, NULL,
    jsonb_build_object('event_id', v_evento), p_request_id);
  RETURN jsonb_build_object('cnpj', v_cnpj, 'event_id', v_evento);
END $$;
COMMENT ON FUNCTION plataforma.empresa_trocar_cnpj(uuid, text, text) IS
  'Portal /config (0077): troca o CNPJ da core.empresa (não escreve na filial) e grava core.empresa.cnpj_alterado@1 no outbox na mesma transação; idempotente pelo request_id; audita só o event_id. Devolve {cnpj, event_id}. Erros: docs/banco/README.md. Só macuxierp_config. RN-CORE-16.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; internas sem EXECUTE; as do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION plataforma.cnpj_valido(text), plataforma.ficha_exigir(text, text, anyelement),
  plataforma.empresa_travada(uuid),
  plataforma.empresa_publicar_cnpj(uuid, uuid, text, text),
  faturamento.tem_nfe_autorizada_producao(uuid), plataforma.empresa_salvar_ficha(uuid, jsonb, text),
  plataforma.empresa_trocar_cnpj(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_salvar_ficha(uuid, jsonb, text),
  plataforma.empresa_trocar_cnpj(uuid, text, text) TO macuxierp_config;

-- ---------------------------------------------------------------------------------------------------------------
-- Carga única (fim da 0077): um core.empresa.cnpj_alterado@1 por core.empresa viva com CNPJ, para o cadastros
-- preencher o CNPJ das filiais padrão antigas. request_id 'migracao-0077:<empresa_id>'; rodar de novo não duplica.
-- Sem auditoria por empresa; ficam fora os tenants fora de 'ativo' e o tenant de referência (R-20261127-122654);
-- o NOTICE mostra só a contagem.
-- ---------------------------------------------------------------------------------------------------------------
DO $carga$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN SELECT e.id, e.tenant_id, e.cnpj FROM core.empresa e JOIN plataforma.tenant t ON t.id = e.tenant_id
            WHERE e.deleted_at IS NULL AND e.cnpj IS NOT NULL
              AND t.situacao = 'ativo' AND t.id <> plataforma.tenant_referencia()
              AND NOT EXISTS (SELECT 1 FROM plataforma.evento v
                               WHERE v.tenant_id = e.tenant_id AND v.nome = 'core.empresa.cnpj_alterado@1'
                                 AND v.agregado_id = e.id AND v.payload ->> 'request_id' = 'migracao-0077:' || e.id::text)
            ORDER BY e.created_at, e.id LOOP
    PERFORM plataforma.empresa_publicar_cnpj(r.tenant_id, r.id, r.cnpj, 'migracao-0077:' || r.id::text);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '0077: % evento(s) core.empresa.cnpj_alterado@1 da carga', v_n;
END $carga$;
