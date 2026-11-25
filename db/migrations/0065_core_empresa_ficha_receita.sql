-- 0065 — Ficha da empresa pela Receita (T-0101; ADR 0012 §4, emenda da ficha). Aditiva e reexecutável.
-- Entram: colunas da ficha em core.empresa; razão social e nome fantasia até 150; internas mascarar_telefone, receita_texto, receita_data, receita_digitos,
-- empresa_core_id e empresa_ficha_json; empresa_ler com a chave "ficha"; empresa_gravar_receita e
-- empresa_contato_revelar, só para macuxierp_config.
-- O porquê: docs/banco/README.md, seção "Ficha da empresa pela Receita".

SET LOCAL lock_timeout = '5s';

ALTER TABLE core.empresa
  ADD COLUMN IF NOT EXISTS logradouro text CHECK (length(logradouro) <= 120),
  ADD COLUMN IF NOT EXISTS numero text CHECK (length(numero) <= 20),
  ADD COLUMN IF NOT EXISTS complemento text CHECK (length(complemento) <= 120),
  ADD COLUMN IF NOT EXISTS bairro text CHECK (length(bairro) <= 80),
  ADD COLUMN IF NOT EXISTS cep text CHECK (cep ~ '^[0-9]{8}$'),
  ADD COLUMN IF NOT EXISTS municipio_ibge text CHECK (municipio_ibge ~ '^[0-9]{7}$'),
  ADD COLUMN IF NOT EXISTS uf text CHECK (uf ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS email text CHECK (length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ADD COLUMN IF NOT EXISTS telefone text CHECK (telefone ~ '^[0-9]{10,11}$'),
  ADD COLUMN IF NOT EXISTS cnae_principal text CHECK (cnae_principal ~ '^[0-9]{7}$'),
  ADD COLUMN IF NOT EXISTS regime_receita text CHECK (regime_receita IN ('mei', 'simples', 'normal')),
  ADD COLUMN IF NOT EXISTS situacao_cadastral text CHECK (length(situacao_cadastral) BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS situacao_cadastral_data date,
  ADD COLUMN IF NOT EXISTS data_abertura date,
  ADD COLUMN IF NOT EXISTS natureza_juridica text CHECK (length(natureza_juridica) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS porte text CHECK (length(porte) BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS cnae_secundarios jsonb CHECK (jsonb_typeof(cnae_secundarios) = 'array'),
  ADD COLUMN IF NOT EXISTS receita_fonte text
    CHECK (receita_fonte IN ('brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz')),
  ADD COLUMN IF NOT EXISTS receita_consultada_em timestamptz;

-- Razão social e nome fantasia até 150 (contrato do core, #637); o mínimo da 0003 continua. Os nomes são os que a 0003
-- gerou (conferidos no pg_constraint). Alargar não invalida linha: NOT VALID + VALIDATE só evita a varredura sob trava forte.
ALTER TABLE core.empresa
  DROP CONSTRAINT IF EXISTS empresa_razao_social_check,
  DROP CONSTRAINT IF EXISTS empresa_nome_fantasia_check,
  ADD CONSTRAINT empresa_razao_social_check CHECK (length(razao_social) BETWEEN 2 AND 150) NOT VALID,
  ADD CONSTRAINT empresa_nome_fantasia_check CHECK (length(nome_fantasia) <= 150) NOT VALID;
ALTER TABLE core.empresa VALIDATE CONSTRAINT empresa_razao_social_check;
ALTER TABLE core.empresa VALIDATE CONSTRAINT empresa_nome_fantasia_check;

COMMENT ON COLUMN core.empresa.email IS
  'Ficha da Receita (0065): dado possivelmente pessoal (MEI). Portal só mascarado; o completo só por empresa_contato_revelar, auditado sem o valor. Nunca em log.';
COMMENT ON COLUMN core.empresa.telefone IS
  'Ficha da Receita (0065): só dígitos, DDD + número (10 ou 11). Mesmas regras do e-mail.';
COMMENT ON COLUMN core.empresa.regime_receita IS
  'Ficha da Receita (0065): mei, simples ou normal, só informativo. O CRT da NF-e é da filial (RF-CAD-08).';
COMMENT ON COLUMN core.empresa.receita_fonte IS
  'Ficha da Receita (0065): FonteConsulta (modules/cadastros/contracts) da última consulta gravada.';

-- ---------------------------------------------------------------------------------------------------------------
-- Funções internas (sem EXECUTE para ninguém).
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.mascarar_telefone(p_telefone text) RETURNS text
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE
    WHEN p_telefone IS NULL THEN NULL
    WHEN x.d !~ '^[0-9]{10,11}$' THEN '****'
    ELSE '(' || left(x.d, 2) || ') ****-' || right(x.d, 4)
  END
  FROM (SELECT regexp_replace(p_telefone, '[^0-9]', '', 'g') AS d) x
$$;
COMMENT ON FUNCTION plataforma.mascarar_telefone(text) IS
  'Interna (0065): telefone mascarado para exibição: "(DDD) ****-" + 4 últimos dígitos; fora de 10 ou 11 dígitos = "****"; NULL = NULL. T-0101.';

CREATE OR REPLACE FUNCTION plataforma.receita_texto(p_campo text, p_valor text, p_max integer) RETURNS text
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_txt text := nullif(btrim(regexp_replace(p_valor, '[[:space:]]+', ' ', 'g')), '');
BEGIN
  IF length(v_txt) > p_max THEN
    -- Só o nome do campo, nunca o valor (LGPD).
    RAISE EXCEPTION 'campo acima do limite: %', p_campo USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_txt;
END $$;
COMMENT ON FUNCTION plataforma.receita_texto(text, text, integer) IS
  'Interna (0065): texto da Receita normalizado (espaços colapsados, vazio = NULL); acima de p_max = 23514 só com o nome do campo (limites do contrato do core). T-0101.';

CREATE OR REPLACE FUNCTION plataforma.receita_data(p_valor text) RETURNS date
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_valor IS NULL OR btrim(p_valor) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_valor)::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN NULL;
END $$;
COMMENT ON FUNCTION plataforma.receita_data(text) IS
  'Interna (0065): data AAAA-MM-DD da Receita; formato ou data inválida = NULL. T-0101.';

CREATE OR REPLACE FUNCTION plataforma.receita_digitos(p_valor text, p_padrao text) RETURNS text
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE WHEN x.d ~ p_padrao THEN x.d END FROM (SELECT regexp_replace(p_valor, '[^0-9]', '', 'g') AS d) x
$$;
COMMENT ON FUNCTION plataforma.receita_digitos(text, text) IS
  'Interna (0065): só os dígitos de p_valor quando casam com p_padrao; senão (ou NULL) = NULL. T-0101.';

-- Exceção só de leitura da ADR 0012 §4 (emenda da ficha): a core.empresa viva do tenant, a mesma regra da 0035.
CREATE OR REPLACE FUNCTION plataforma.empresa_core_id(p_tenant uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT e.id FROM core.empresa e
  WHERE e.tenant_id = p_tenant AND e.deleted_at IS NULL
  ORDER BY e.created_at, e.id LIMIT 1
$$;
COMMENT ON FUNCTION plataforma.empresa_core_id(uuid) IS
  'Interna (0065): id da core.empresa viva do tenant (a mais antiga); NULL sem a linha. A trava (FOR UPDATE) fica no chamador. T-0101.';

CREATE OR REPLACE FUNCTION plataforma.empresa_ficha_json(p_tenant uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT jsonb_build_object(
    'nome_fantasia', e.nome_fantasia, 'ie', e.ie,
    'logradouro', e.logradouro, 'numero', e.numero, 'complemento', e.complemento, 'bairro', e.bairro,
    'cep', e.cep, 'municipio_ibge', e.municipio_ibge, 'uf', e.uf,
    'email_mascarado', plataforma.mascarar_email(e.email),
    'telefone_mascarado', plataforma.mascarar_telefone(e.telefone),
    'cnae_principal', e.cnae_principal, 'regime_receita', e.regime_receita,
    'situacao_cadastral', e.situacao_cadastral,
    'situacao_cadastral_data', to_char(e.situacao_cadastral_data, 'YYYY-MM-DD'),
    'data_abertura', to_char(e.data_abertura, 'YYYY-MM-DD'),
    'natureza_juridica', e.natureza_juridica, 'porte', e.porte, 'cnae_secundarios', e.cnae_secundarios,
    'receita_fonte', e.receita_fonte,
    'receita_consultada_em', plataforma.instante_iso(e.receita_consultada_em))
  FROM core.empresa e
  WHERE e.id = plataforma.empresa_core_id(p_tenant)
$$;
COMMENT ON FUNCTION plataforma.empresa_ficha_json(uuid) IS
  'Interna (0065): a ficha da Receita da core.empresa viva do tenant (lista fechada da ADR 0012 §4), com email_mascarado e telefone_mascarado, nunca os completos; NULL sem a linha. T-0101.';

-- ---------------------------------------------------------------------------------------------------------------
-- Lista fechada (ADR 0012 §4): leitura com a ficha, gravação pela Receita e revelar o contato.
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.empresa_ler(p_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
BEGIN
  RETURN (SELECT plataforma.empresa_json(t.id) || jsonb_build_object('ficha', plataforma.empresa_ficha_json(t.id))
          FROM plataforma.tenant t
          WHERE t.id = p_id AND plataforma.empresa_visivel(t));
END $$;
COMMENT ON FUNCTION plataforma.empresa_ler(uuid) IS
  'Portal /config (0033; ficha na 0065): a empresa (EmpresaPlataforma) mais "ficha" (empresa_ficha_json, null sem core.empresa), ou NULL se não existe, foi excluída ou é a de referência. Só macuxierp_config. T-0050, T-0101.';

CREATE OR REPLACE FUNCTION plataforma.empresa_gravar_receita(p_id uuid, p_ficha jsonb, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_colunas CONSTANT text[] := ARRAY['razao_social', 'nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro',
    'cep', 'municipio_ibge', 'uf', 'email', 'telefone', 'cnae_principal', 'regime_receita', 'situacao_cadastral',
    'situacao_cadastral_data', 'data_abertura', 'natureza_juridica', 'porte', 'cnae_secundarios'];
  v_chaves CONSTANT text[] := v_colunas || ARRAY['fonte', 'consultado_em'];
  v_ufs CONSTANT text[] := ARRAY['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  t plataforma.tenant;
  e core.empresa;
  n core.empresa;
  v_fora text;
  v_fonte text := p_ficha ->> 'fonte';
  v_quando timestamptz;
  v_txt text;
  v_alterados text[];
BEGIN
  IF p_ficha IS NULL OR jsonb_typeof(p_ficha) <> 'object' THEN
    RAISE EXCEPTION 'ficha da Receita inválida' USING ERRCODE = 'check_violation';
  END IF;
  -- Só nomes de chave na mensagem, nunca valores (LGPD).
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_fora FROM jsonb_object_keys(p_ficha) k WHERE k <> ALL (v_chaves);
  IF v_fora IS NOT NULL THEN
    RAISE EXCEPTION 'campo fora da lista fechada da ficha: %', v_fora USING ERRCODE = 'check_violation';
  END IF;
  IF v_fonte IS NULL OR v_fonte NOT IN ('brasilapi', 'viacep', 'receita-aberta', 'cache', 'sefaz') THEN
    RAISE EXCEPTION 'fonte da consulta inválida' USING ERRCODE = 'check_violation';
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
  -- deleted_at no WHERE: revalidado depois da espera pela trava (linha excluída enquanto esperava = sem linha).
  SELECT * INTO e FROM core.empresa x
    WHERE x.id = plataforma.empresa_core_id(t.id) AND x.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a empresa não tem cadastro (filial padrão)' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- Repetição do mesmo request_id: nada muda, devolve o que a primeira gravou.
  IF p_request_id IS NOT NULL THEN
    SELECT a.depois -> 'campos' INTO v_txt FROM plataforma.auditoria a
     WHERE a.tenant_id = t.id AND a.entidade = 'empresa' AND a.entidade_id = e.id
       AND a.acao = 'plataforma.empresa.atualizar_receita' AND a.request_id = p_request_id
     ORDER BY a.ocorrido_em LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ficha', plataforma.empresa_ficha_json(t.id), 'alterados', v_txt::jsonb);
    END IF;
  END IF;

  -- Chave ausente = mantém; presente (inclusive null) = grava o valor normalizado; formato inválido vira NULL; texto
  -- acima do limite = 23514 só com o nome do campo.
  n := e;
  IF p_ficha ? 'razao_social' THEN
    -- NOT NULL na tabela: vazia ou de 1 caractere não apaga a atual.
    v_txt := plataforma.receita_texto('razao_social', p_ficha ->> 'razao_social', 150);
    IF length(v_txt) >= 2 THEN n.razao_social := v_txt; END IF;
  END IF;
  IF p_ficha ? 'nome_fantasia' THEN
    n.nome_fantasia := plataforma.receita_texto('nome_fantasia', p_ficha ->> 'nome_fantasia', 150);
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
  IF p_ficha ? 'cep' THEN n.cep := plataforma.receita_digitos(p_ficha ->> 'cep', '^[0-9]{8}$'); END IF;
  IF p_ficha ? 'municipio_ibge' THEN
    n.municipio_ibge := plataforma.receita_digitos(p_ficha ->> 'municipio_ibge', '^[0-9]{7}$');
  END IF;
  IF p_ficha ? 'uf' THEN
    v_txt := upper(btrim(p_ficha ->> 'uf'));
    n.uf := CASE WHEN v_txt = ANY (v_ufs) THEN v_txt END;
  END IF;
  IF p_ficha ? 'email' THEN
    v_txt := lower(btrim(p_ficha ->> 'email'));
    n.email := CASE WHEN length(v_txt) <= 254 AND v_txt ~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN v_txt END;
  END IF;
  IF p_ficha ? 'telefone' THEN n.telefone := plataforma.receita_digitos(p_ficha ->> 'telefone', '^[0-9]{10,11}$'); END IF;
  IF p_ficha ? 'cnae_principal' THEN
    -- A BrasilAPI manda o CNAE como número: o zero à esquerda some (0111301 → 111301).
    n.cnae_principal := lpad(plataforma.receita_digitos(p_ficha ->> 'cnae_principal', '^[0-9]{6,7}$'), 7, '0');
  END IF;
  IF p_ficha ? 'regime_receita' THEN
    v_txt := lower(btrim(p_ficha ->> 'regime_receita'));
    n.regime_receita := CASE WHEN v_txt IN ('mei', 'simples', 'normal') THEN v_txt END;
  END IF;
  IF p_ficha ? 'situacao_cadastral_data' THEN
    n.situacao_cadastral_data := plataforma.receita_data(p_ficha ->> 'situacao_cadastral_data');
  END IF;
  IF p_ficha ? 'data_abertura' THEN n.data_abertura := plataforma.receita_data(p_ficha ->> 'data_abertura'); END IF;
  IF p_ficha ? 'natureza_juridica' THEN
    n.natureza_juridica := plataforma.receita_texto('natureza_juridica', p_ficha ->> 'natureza_juridica', 120);
  END IF;
  IF p_ficha ? 'porte' THEN n.porte := plataforma.receita_texto('porte', p_ficha ->> 'porte', 60); END IF;
  IF p_ficha ? 'cnae_secundarios' THEN
    -- Lista de códigos de 7 dígitos, na ordem da fonte, sem repetidos; item inválido sai; não lista = NULL.
    n.cnae_secundarios := CASE WHEN jsonb_typeof(p_ficha -> 'cnae_secundarios') = 'array' THEN
      (SELECT coalesce(jsonb_agg(c.codigo ORDER BY c.ordem), '[]'::jsonb)
         FROM (SELECT DISTINCT ON (v.codigo) v.codigo, v.ordem
                 FROM (SELECT lpad(plataforma.receita_digitos(i.valor #>> '{}', '^[0-9]{6,7}$'), 7, '0') AS codigo, i.ordem
                         FROM jsonb_array_elements(p_ficha -> 'cnae_secundarios') WITH ORDINALITY i (valor, ordem)) v
                WHERE v.codigo IS NOT NULL
                ORDER BY v.codigo, v.ordem) c)
    END;
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_alterados
    FROM unnest(v_colunas) k WHERE to_jsonb(e) -> k IS DISTINCT FROM to_jsonb(n) -> k;

  -- A consulta fica guardada (data e fonte) mesmo quando nada muda (ADR 0012, emenda da ficha).
  UPDATE core.empresa SET razao_social = n.razao_social, nome_fantasia = n.nome_fantasia, logradouro = n.logradouro,
      numero = n.numero, complemento = n.complemento, bairro = n.bairro, cep = n.cep,
      municipio_ibge = n.municipio_ibge, uf = n.uf, email = n.email, telefone = n.telefone,
      cnae_principal = n.cnae_principal, regime_receita = n.regime_receita,
      situacao_cadastral = n.situacao_cadastral, situacao_cadastral_data = n.situacao_cadastral_data,
      data_abertura = n.data_abertura, natureza_juridica = n.natureza_juridica, porte = n.porte,
      cnae_secundarios = n.cnae_secundarios, receita_fonte = v_fonte, receita_consultada_em = v_quando
    WHERE id = e.id;

  -- Auditoria só com os nomes dos campos e a fonte, nunca os valores (LGPD, regra 8).
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.empresa.atualizar_receita', 'empresa', e.id, NULL,
    jsonb_build_object('campos', to_jsonb(v_alterados), 'fonte', v_fonte), p_request_id);
  RETURN jsonb_build_object('ficha', plataforma.empresa_ficha_json(t.id), 'alterados', to_jsonb(v_alterados));
END $$;
COMMENT ON FUNCTION plataforma.empresa_gravar_receita(uuid, jsonb, text) IS
  'Portal /config (0065): grava a ficha da Receita na core.empresa (única escrita do portal em schema de módulo, só nas colunas da ficha e na razão social), com fonte e consultado_em; chave fora da lista, fonte ou data inválida, texto acima do limite (só o nome do campo na mensagem) = 23514; sem core.empresa = 55000; repetição do request_id não muda nada. Audita plataforma.empresa.atualizar_receita só com os nomes dos campos e a fonte. Devolve {ficha, alterados}. Só macuxierp_config. T-0101.';

CREATE OR REPLACE FUNCTION plataforma.empresa_contato_revelar(p_id uuid, p_campo text, p_request_id text)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  v_empresa uuid;
  v_valor text;
BEGIN
  IF p_campo IS NULL OR p_campo NOT IN ('email', 'telefone') THEN
    RAISE EXCEPTION 'campo de contato inválido' USING ERRCODE = 'check_violation';
  END IF;
  t := plataforma.empresa_alvo(p_id, false);
  SELECT e.id, CASE p_campo WHEN 'email' THEN e.email ELSE e.telefone END INTO v_empresa, v_valor
    FROM core.empresa e WHERE e.id = plataforma.empresa_core_id(t.id);
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'a empresa não tem cadastro' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_valor IS NULL THEN
    RAISE EXCEPTION 'contato não informado' USING ERRCODE = 'no_data_found';
  END IF;
  -- Auditoria sem o valor (LGPD, regra 8): só o campo revelado.
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.empresa.revelar_contato', 'empresa', v_empresa, NULL,
    jsonb_build_object('campo', p_campo), p_request_id);
  RETURN v_valor;
END $$;
COMMENT ON FUNCTION plataforma.empresa_contato_revelar(uuid, text, text) IS
  'Portal /config (0065): devolve o e-mail ou o telefone (só dígitos) completo da ficha; campo fora de email|telefone = 23514; sem core.empresa ou sem o valor = no_data_found. Audita plataforma.empresa.revelar_contato só com o campo. Só macuxierp_config. T-0101.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; internas sem EXECUTE; as do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION plataforma.mascarar_telefone(text), plataforma.receita_texto(text, text, integer),
  plataforma.receita_data(text), plataforma.receita_digitos(text, text), plataforma.empresa_core_id(uuid),
  plataforma.empresa_ficha_json(uuid), plataforma.empresa_ler(uuid),
  plataforma.empresa_gravar_receita(uuid, jsonb, text), plataforma.empresa_contato_revelar(uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_ler(uuid), plataforma.empresa_gravar_receita(uuid, jsonb, text),
  plataforma.empresa_contato_revelar(uuid, text, text) TO macuxierp_config;
