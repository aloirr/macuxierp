-- 0079 — E-mail único entre os usuários de todas as empresas (v0.3.30, T-0133, login sem o código da empresa).
-- O superadmin fica fora (decisão A do PO), para não quebrar o /config pelo BKO da 0076 (45 A). O porquê e os erros:
-- docs/banco/README.md, seção "E-mail único no sistema todo".

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- Checagem: com e-mail repetido entre empresas (usuários não excluídos), a migração para sem mudar nada e mostra
-- só a contagem (sem e-mail, LGPD). O e-mail já é normalizado pelo CHECK da 0002.
-- ---------------------------------------------------------------------------------------------------------------
DO $checagem$
DECLARE
  v_grupos integer;
  v_linhas integer;
BEGIN
  SELECT count(*), coalesce(sum(n), 0) INTO v_grupos, v_linhas
    FROM (SELECT count(*) AS n FROM plataforma.usuario WHERE deleted_at IS NULL GROUP BY email HAVING count(*) > 1) d;
  IF v_grupos > 0 THEN
    RAISE EXCEPTION '0079: % e-mail(s) repetido(s) entre empresas, em % usuário(s); nada foi alterado', v_grupos, v_linhas
      USING ERRCODE = 'unique_violation';
  END IF;
END $checagem$;

CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_global_uq ON plataforma.usuario (email) WHERE deleted_at IS NULL;
COMMENT ON INDEX plataforma.usuario_email_global_uq IS
  'E-mail único entre os usuários não excluídos de todas as empresas (0079, T-0133): o login não pede o código da empresa. O de um excluído pode voltar. O superadmin fica fora.';
DROP INDEX IF EXISTS plataforma.usuario_email_vivo_uq;

-- ---------------------------------------------------------------------------------------------------------------
-- Internas e login.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.exigir_email_livre(p_email text) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM plataforma.usuario x WHERE x.email = p_email AND x.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'email_em_uso' USING ERRCODE = 'unique_violation';
  END IF;
END $$;
COMMENT ON FUNCTION plataforma.exigir_email_livre(text) IS
  'Interna (0079): 23505 email_em_uso se algum usuário não excluído, de qualquer empresa, já tem o e-mail (normalizado). T-0133.';

CREATE OR REPLACE FUNCTION plataforma.conta_por_email(p_email text)
  RETURNS TABLE (tipo text, tenant_id uuid, situacao_tenant text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT x.tipo, x.tenant_id, x.situacao_tenant FROM (
    SELECT 'usuario'::text AS tipo, u.tenant_id, t.situacao AS situacao_tenant, 1 AS ordem
      FROM plataforma.usuario u JOIN plataforma.tenant t ON t.id = u.tenant_id
     WHERE u.email = lower(btrim(p_email)) AND u.deleted_at IS NULL AND t.deleted_at IS NULL
    UNION ALL
    SELECT 'superadmin', NULL, NULL, 2
      FROM plataforma.superadmin s
     WHERE s.email = lower(btrim(p_email)) AND s.deleted_at IS NULL
  ) x ORDER BY x.ordem
$$;
COMMENT ON FUNCTION plataforma.conta_por_email(text) IS
  'Login sem o código da empresa (0079, T-0133): as contas do e-mail, o usuário da empresa antes do superadmin, só com {tipo, tenant_id, situacao_tenant} (sem hash, nome nem situação do usuário). No máximo uma de cada tipo. Para macuxierp_app.';

-- ---------------------------------------------------------------------------------------------------------------
-- Criar usuário (0078) e 1º administrador (0036): o e-mail livre no sistema todo.
-- ---------------------------------------------------------------------------------------------------------------
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
  v_id := plataforma.auditoria_repetida(t.id, 'plataforma.usuario.criar', p_request_id, NULL);
  IF v_id IS NOT NULL THEN
    SELECT * INTO u FROM plataforma.usuario x WHERE x.id = v_id;
    RETURN plataforma.usuario_json(u);
  END IF;
  IF nullif(btrim(p_nome), '') IS NULL OR p_perfil IS NULL THEN
    RAISE EXCEPTION 'campo obrigatório: %', CASE WHEN p_perfil IS NULL THEN 'perfil' ELSE 'nome' END
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM plataforma.exigir_email_livre(v_email);
  INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil, filial_ids, deve_trocar_senha)
  VALUES (t.id, v_email, btrim(p_nome), p_senha_hash, p_perfil, coalesce(p_filial_ids, '{}'), true)
  RETURNING * INTO u;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.usuario.criar', 'usuario', u.id, NULL,
    jsonb_build_object('perfil', u.perfil, 'ativo', true), p_request_id);
  RETURN plataforma.usuario_json(u);
END $$;

CREATE OR REPLACE FUNCTION plataforma.empresa_primeiro_admin_criar(p_id uuid, p_email text, p_nome text,
  p_senha_hash text, p_request_id text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  v_usuario uuid := gen_random_uuid();
BEGIN
  t := plataforma.empresa_alvo(p_id, true);
  IF plataforma.primeiro_admin(t.id) IS NOT NULL THEN
    RAISE EXCEPTION 'a empresa já tem administrador' USING ERRCODE = 'unique_violation';
  END IF;
  PERFORM plataforma.exigir_email_livre(lower(btrim(p_email)));
  INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, deve_trocar_senha)
  VALUES (v_usuario, t.id, lower(btrim(p_email)), btrim(p_nome), p_senha_hash, 'administrador', true);
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.admin.criar', 'usuario', v_usuario, NULL,
    jsonb_build_object('perfil', 'administrador', 'ativo', true), p_request_id);
  RETURN v_usuario;
END $$;

REVOKE ALL ON FUNCTION plataforma.exigir_email_livre(text), plataforma.conta_por_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.conta_por_email(text) TO macuxierp_app;
