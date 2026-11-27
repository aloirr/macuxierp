-- 0078 — Usuários da empresa no /config (v0.3.28, RN-CORE-01, RN-CORE-17). Aditiva e reexecutável.
-- O porquê e os erros: docs/banco/README.md, seção "Usuários da empresa no /config".

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- E-mail único entre os não excluídos: o índice parcial entra antes de o UNIQUE da 0002 sair (nome gerado: sai
-- qualquer UNIQUE só de (tenant_id, email)). O e-mail já é normalizado pelo CHECK da 0002.
-- ---------------------------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_vivo_uq ON plataforma.usuario (tenant_id, email)
  WHERE deleted_at IS NULL;
DO $unico$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.conname FROM pg_constraint c
            WHERE c.conrelid = 'plataforma.usuario'::regclass AND c.contype = 'u'
              AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                    WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['email', 'tenant_id'] LOOP
    EXECUTE format('ALTER TABLE plataforma.usuario DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $unico$;
COMMENT ON INDEX plataforma.usuario_email_vivo_uq IS
  'E-mail único por tenant entre os usuários não excluídos (0078, RN-CORE-17): o e-mail de um excluído pode voltar; o de um inativo continua reservado.';

-- ---------------------------------------------------------------------------------------------------------------
-- Internas (sem EXECUTE para ninguém).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.usuario_situacao(u plataforma.usuario) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE WHEN u.deleted_at IS NOT NULL THEN 'excluido'
    WHEN NOT u.ativo THEN 'inativo'
    WHEN u.bloqueado_ate > now() THEN 'bloqueado'
    ELSE 'ativo' END
$$;
COMMENT ON FUNCTION plataforma.usuario_situacao(plataforma.usuario) IS
  'Interna (0078): excluido (deleted_at), inativo (ativo = false), bloqueado (trava de login vigente) ou ativo. RN-CORE-17.';

CREATE OR REPLACE FUNCTION plataforma.usuario_alvo(p_tenant uuid, p_usuario uuid) RETURNS plataforma.usuario
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  u plataforma.usuario;
BEGIN
  SELECT * INTO u FROM plataforma.usuario x
    WHERE x.tenant_id = p_tenant AND x.id = p_usuario AND x.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuário não encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN u;
END $$;
COMMENT ON FUNCTION plataforma.usuario_alvo(uuid, uuid) IS
  'Interna (0078): o usuário não excluído do tenant, travado (FOR UPDATE); senão P0002. RN-CORE-17.';

CREATE OR REPLACE FUNCTION plataforma.ha_outro_admin(p_tenant uuid, p_usuario uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM plataforma.usuario o
                  WHERE o.tenant_id = p_tenant AND o.id <> p_usuario AND o.perfil = 'administrador'
                    AND o.ativo AND o.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION plataforma.ha_outro_admin(uuid, uuid) IS
  'Interna (0078): há outro administrador ativo e não excluído no tenant além de p_usuario. RN-CORE-01.';

CREATE OR REPLACE FUNCTION plataforma.exigir_outro_admin(p_tenant uuid, p_usuario uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NOT plataforma.ha_outro_admin(p_tenant, p_usuario) THEN
    RAISE EXCEPTION 'último administrador ativo' USING ERRCODE = 'MXU01';
  END IF;
END $$;
COMMENT ON FUNCTION plataforma.exigir_outro_admin(uuid, uuid) IS
  'Interna (0078): MXU01 se não há outro administrador ativo (ha_outro_admin). RN-CORE-01.';

CREATE OR REPLACE FUNCTION plataforma.revogar_sessoes_usuario(p_tenant uuid, p_usuario uuid) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE plataforma.sessao SET revogada_em = now()
  WHERE tenant_id = p_tenant AND usuario_id = p_usuario AND revogada_em IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION plataforma.revogar_sessoes_usuario(uuid, uuid) IS
  'Interna (0078): revoga as sessões abertas do usuário e devolve quantas. RN-CORE-17.';

CREATE OR REPLACE FUNCTION plataforma.usuario_json(u plataforma.usuario) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT jsonb_build_object('id', u.id, 'nome', u.nome, 'email_mascarado', plataforma.mascarar_email(u.email),
    'perfil', u.perfil, 'filial_ids', to_jsonb(u.filial_ids), 'situacao', plataforma.usuario_situacao(u),
    'ultimo_acesso_em', plataforma.instante_iso(u.ultimo_acesso_em), 'deve_trocar_senha', u.deve_trocar_senha,
    'ultimo_admin_ativo', u.perfil = 'administrador' AND u.ativo AND u.deleted_at IS NULL
      AND NOT plataforma.ha_outro_admin(u.tenant_id, u.id))
$$;
COMMENT ON FUNCTION plataforma.usuario_json(plataforma.usuario) IS
  'Interna (0078): o item da listagem, sem o e-mail aberto (LGPD): {id, nome, email_mascarado, perfil, filial_ids, situacao, ultimo_acesso_em, deve_trocar_senha, ultimo_admin_ativo}. RN-CORE-01, RN-CORE-17.';

CREATE OR REPLACE FUNCTION plataforma.auditoria_repetida(p_tenant uuid, p_acao text, p_request_id text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT a.entidade_id FROM plataforma.auditoria a
   WHERE p_request_id IS NOT NULL AND a.tenant_id = p_tenant AND a.acao = p_acao AND a.request_id = p_request_id
   ORDER BY a.ocorrido_em LIMIT 1
$$;
COMMENT ON FUNCTION plataforma.auditoria_repetida(uuid, text, text) IS
  'Interna (0078): o entidade_id da primeira auditoria do tenant com a ação e o request_id, ou NULL (repetição idempotente do portal).';

-- ---------------------------------------------------------------------------------------------------------------
-- Portal /config.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.empresa_usuarios_listar(p_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
BEGIN
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_id AND plataforma.empresa_visivel(x);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(plataforma.usuario_json(u) ORDER BY u.nome, u.id) FROM plataforma.usuario u
                    WHERE u.tenant_id = t.id AND u.deleted_at IS NULL), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION plataforma.empresa_usuario_criar(p_id uuid, p_email text, p_nome text, p_perfil text,
  p_senha_hash text, p_filial_ids uuid[], p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  t plataforma.tenant;
  u plataforma.usuario;
  v_id uuid;
BEGIN
  t := plataforma.empresa_alvo(p_id, true);
  v_id := plataforma.auditoria_repetida(t.id, 'plataforma.usuario.criar', p_request_id);
  IF v_id IS NOT NULL THEN
    SELECT * INTO u FROM plataforma.usuario x WHERE x.id = v_id;
    RETURN plataforma.usuario_json(u);
  END IF;
  IF EXISTS (SELECT 1 FROM plataforma.usuario x WHERE x.tenant_id = t.id AND x.email = v_email AND x.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'email_em_uso' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil, filial_ids, deve_trocar_senha)
  VALUES (t.id, v_email, btrim(p_nome), p_senha_hash, p_perfil, coalesce(p_filial_ids, '{}'), true)
  RETURNING * INTO u;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.usuario.criar', 'usuario', u.id, NULL,
    jsonb_build_object('perfil', u.perfil, 'ativo', true), p_request_id);
  RETURN plataforma.usuario_json(u);
END $$;

CREATE OR REPLACE FUNCTION plataforma.empresa_usuario_editar(p_id uuid, p_usuario uuid, p_patch jsonb,
  p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  u plataforma.usuario;
  n plataforma.usuario;
  v_chave text;
  v_alterados text[] := '{}';
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'alteração inválida' USING ERRCODE = 'check_violation';
  END IF;
  FOR v_chave IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_chave NOT IN ('nome', 'perfil', 'filial_ids') THEN
      RAISE EXCEPTION 'campo fora da lista: %', v_chave USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  t := plataforma.empresa_alvo(p_id, false);
  u := plataforma.usuario_alvo(t.id, p_usuario);
  n := u;
  IF p_patch ? 'nome' THEN n.nome := btrim(p_patch ->> 'nome'); END IF;
  IF p_patch ? 'perfil' THEN n.perfil := p_patch ->> 'perfil'; END IF;
  IF p_patch ? 'filial_ids' THEN
    BEGIN
      n.filial_ids := coalesce(ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'filial_ids'))::uuid[], '{}');
    EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'campo inválido: filial_ids' USING ERRCODE = 'check_violation';
    END;
  END IF;
  IF n.nome IS DISTINCT FROM u.nome THEN v_alterados := v_alterados || 'nome'::text; END IF;
  IF n.perfil IS DISTINCT FROM u.perfil THEN v_alterados := v_alterados || 'perfil'::text; END IF;
  IF n.filial_ids IS DISTINCT FROM u.filial_ids THEN v_alterados := v_alterados || 'filial_ids'::text; END IF;
  IF cardinality(v_alterados) = 0 THEN
    RETURN plataforma.usuario_json(u);
  END IF;
  -- RN-CORE-01: tirar o perfil do último administrador ativo é recusado.
  IF u.perfil = 'administrador' AND n.perfil <> 'administrador' AND u.ativo THEN
    PERFORM plataforma.exigir_outro_admin(t.id, u.id);
  END IF;
  UPDATE plataforma.usuario SET nome = n.nome, perfil = n.perfil, filial_ids = n.filial_ids WHERE id = u.id
    RETURNING * INTO n;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.usuario.editar', 'usuario', u.id, NULL,
    jsonb_build_object('campos', to_jsonb(v_alterados)), p_request_id);
  RETURN plataforma.usuario_json(n);
END $$;

CREATE OR REPLACE FUNCTION plataforma.empresa_usuario_redefinir_senha(p_id uuid, p_usuario uuid, p_senha_hash text,
  p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  u plataforma.usuario;
  v_revogadas integer;
BEGIN
  t := plataforma.empresa_alvo(p_id, false);
  u := plataforma.usuario_alvo(t.id, p_usuario);
  IF plataforma.auditoria_repetida(t.id, 'plataforma.usuario.redefinir_senha', p_request_id) IS NOT NULL THEN
    RETURN plataforma.usuario_json(u);
  END IF;
  UPDATE plataforma.usuario SET senha_hash = p_senha_hash, falhas_login = 0, bloqueado_ate = NULL,
    deve_trocar_senha = true, senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL
  WHERE id = u.id RETURNING * INTO u;
  v_revogadas := plataforma.revogar_sessoes_usuario(t.id, u.id);
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.usuario.redefinir_senha', 'usuario', u.id, NULL,
    jsonb_build_object('sessoes_revogadas', v_revogadas), p_request_id);
  RETURN plataforma.usuario_json(u);
END $$;

CREATE OR REPLACE FUNCTION plataforma.usuario_mudar_situacao(p_id uuid, p_usuario uuid, p_acao text, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  u plataforma.usuario;
  v_revogadas integer := 0;
BEGIN
  t := plataforma.empresa_alvo(p_id, false);
  IF p_acao = 'excluir' AND plataforma.auditoria_repetida(t.id, 'plataforma.usuario.excluir', p_request_id) IS NOT NULL THEN
    RETURN jsonb_build_object('id', p_usuario, 'situacao', 'excluido');
  END IF;
  u := plataforma.usuario_alvo(t.id, p_usuario);
  IF (p_acao = 'reativar' AND u.ativo) OR (p_acao = 'inativar' AND NOT u.ativo) THEN
    RETURN plataforma.usuario_json(u);
  END IF;
  IF p_acao IN ('inativar', 'excluir') AND u.perfil = 'administrador' AND u.ativo THEN
    PERFORM plataforma.exigir_outro_admin(t.id, u.id);
  END IF;
  IF p_acao = 'reativar' THEN
    UPDATE plataforma.usuario SET ativo = true WHERE id = u.id RETURNING * INTO u;
  ELSE
    UPDATE plataforma.usuario SET ativo = false,
        deleted_at = CASE WHEN p_acao = 'excluir' THEN now() END
      WHERE id = u.id RETURNING * INTO u;
    v_revogadas := plataforma.revogar_sessoes_usuario(t.id, u.id);
  END IF;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.usuario.' || p_acao, 'usuario', u.id, NULL,
    jsonb_build_object('situacao', plataforma.usuario_situacao(u), 'sessoes_revogadas', v_revogadas), p_request_id);
  RETURN plataforma.usuario_json(u);
END $$;
COMMENT ON FUNCTION plataforma.usuario_mudar_situacao(uuid, uuid, text, text) IS
  'Interna (0078): o corpo de empresa_usuario_inativar, _reativar e _excluir. RN-CORE-01, RN-CORE-17.';

CREATE OR REPLACE FUNCTION plataforma.empresa_usuario_inativar(p_id uuid, p_usuario uuid, p_request_id text)
  RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT plataforma.usuario_mudar_situacao(p_id, p_usuario, 'inativar', p_request_id) $$;
CREATE OR REPLACE FUNCTION plataforma.empresa_usuario_reativar(p_id uuid, p_usuario uuid, p_request_id text)
  RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT plataforma.usuario_mudar_situacao(p_id, p_usuario, 'reativar', p_request_id) $$;
CREATE OR REPLACE FUNCTION plataforma.empresa_usuario_excluir(p_id uuid, p_usuario uuid, p_request_id text)
  RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT plataforma.usuario_mudar_situacao(p_id, p_usuario, 'excluir', p_request_id) $$;

COMMENT ON FUNCTION plataforma.empresa_usuarios_listar(uuid) IS
  'Portal /config (0078): os usuários não excluídos da empresa, por nome, como usuario_json. Só macuxierp_config. RN-CORE-17.';
COMMENT ON FUNCTION plataforma.empresa_usuario_criar(uuid, text, text, text, text, uuid[], text) IS
  'Portal /config (0078): cria o usuário com a senha provisória. Devolve usuario_json. Erros: docs/banco/README.md. Só macuxierp_config. RN-CORE-17.';
COMMENT ON FUNCTION plataforma.empresa_usuario_editar(uuid, uuid, jsonb, text) IS
  'Portal /config (0078): altera nome, perfil e filial_ids. Devolve usuario_json. Erros: docs/banco/README.md. Só macuxierp_config. RN-CORE-01, RN-CORE-17.';
COMMENT ON FUNCTION plataforma.empresa_usuario_redefinir_senha(uuid, uuid, text, text) IS
  'Portal /config (0078): senha provisória, zera falhas e trava, revoga as sessões. Devolve usuario_json. Só macuxierp_config. RN-CORE-17.';
COMMENT ON FUNCTION plataforma.empresa_usuario_inativar(uuid, uuid, text) IS
  'Portal /config (0078): o usuário não entra e segue na lista (reversível); revoga as sessões. Erros: docs/banco/README.md. Só macuxierp_config. RN-CORE-01, RN-CORE-17.';
COMMENT ON FUNCTION plataforma.empresa_usuario_reativar(uuid, uuid, text) IS
  'Portal /config (0078): volta a ativo o usuário inativo. Só macuxierp_config. RN-CORE-17.';
COMMENT ON FUNCTION plataforma.empresa_usuario_excluir(uuid, uuid, text) IS
  'Portal /config (0078): exclusão lógica (deleted_at); some da lista e libera o e-mail; revoga as sessões. Erros: docs/banco/README.md. Só macuxierp_config. RN-CORE-01, RN-CORE-17.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; internas sem EXECUTE; as do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION plataforma.usuario_situacao(plataforma.usuario),
  plataforma.usuario_alvo(uuid, uuid), plataforma.ha_outro_admin(uuid, uuid), plataforma.exigir_outro_admin(uuid, uuid),
  plataforma.revogar_sessoes_usuario(uuid, uuid),
  plataforma.usuario_json(plataforma.usuario), plataforma.auditoria_repetida(uuid, text, text),
  plataforma.usuario_mudar_situacao(uuid, uuid, text, text),
  plataforma.empresa_usuarios_listar(uuid), plataforma.empresa_usuario_criar(uuid, text, text, text, text, uuid[], text),
  plataforma.empresa_usuario_editar(uuid, uuid, jsonb, text),
  plataforma.empresa_usuario_redefinir_senha(uuid, uuid, text, text),
  plataforma.empresa_usuario_inativar(uuid, uuid, text), plataforma.empresa_usuario_reativar(uuid, uuid, text),
  plataforma.empresa_usuario_excluir(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_usuarios_listar(uuid),
  plataforma.empresa_usuario_criar(uuid, text, text, text, text, uuid[], text),
  plataforma.empresa_usuario_editar(uuid, uuid, jsonb, text),
  plataforma.empresa_usuario_redefinir_senha(uuid, uuid, text, text),
  plataforma.empresa_usuario_inativar(uuid, uuid, text), plataforma.empresa_usuario_reativar(uuid, uuid, text),
  plataforma.empresa_usuario_excluir(uuid, uuid, text) TO macuxierp_config;
