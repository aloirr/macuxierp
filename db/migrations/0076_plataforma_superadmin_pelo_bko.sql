-- 0076 — /config pelo menu do BKO sem login de novo (v0.3.21, decisão 45 A; ADR 0012 §1 e §4, emenda da 45 A).
-- Aditiva e reexecutável: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE, COMMENT ON e
-- REVOKE/GRANT. Motivo em docs/banco/README.md (0076).
-- MXS11 = TROCAR_SENHA e MXS12 = SEM_ACESSO_CONFIG na API.

SET LOCAL lock_timeout = '5s';

-- (a) Origem da sessão do /config aberta pelo BKO. ------------------------------------------------------------------
ALTER TABLE plataforma.sessao_superadmin ADD COLUMN IF NOT EXISTS origem_sessao_bko uuid;
COMMENT ON COLUMN plataforma.sessao_superadmin.origem_sessao_bko IS
  'Sessão do BKO (plataforma.sessao.id) que abriu esta sessão do /config pela superadmin_abrir_sessao_pelo_bko (0076); nula no login com senha. Sem FK (README, 0076). v0.3.21, 45 A.';
CREATE INDEX IF NOT EXISTS sessao_superadmin_origem_bko_idx ON plataforma.sessao_superadmin (origem_sessao_bko)
  WHERE origem_sessao_bko IS NOT NULL AND revogada_em IS NULL;

-- Interna: o superadmin apto do e-mail (as duas funções do BKO usam a mesma regra).
CREATE OR REPLACE FUNCTION plataforma.superadmin_apto_por_email(p_email text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT s.id FROM plataforma.superadmin s
  WHERE s.email = lower(btrim(p_email)) AND s.ativo AND s.deleted_at IS NULL
    AND (s.bloqueado_ate IS NULL OR s.bloqueado_ate <= now()) AND NOT s.deve_trocar_senha
$$;
COMMENT ON FUNCTION plataforma.superadmin_apto_por_email(text) IS
  'Interna (0076, 45 A): o id do superadmin do e-mail (normalizado) que está ativo, não excluído, destravado e sem troca de senha pendente; NULL se não houver. Sem EXECUTE para ninguém: só as funções do /config pelo BKO a chamam, como donas. v0.3.21.';

-- (b) O item "Configuração" no menu do BKO. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.superadmin_acesso_pelo_bko(p_tenant uuid, p_usuario uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM plataforma.usuario u
    WHERE u.tenant_id = p_tenant AND u.id = p_usuario AND u.deleted_at IS NULL
      AND plataforma.superadmin_apto_por_email(u.email) IS NOT NULL)
$$;
COMMENT ON FUNCTION plataforma.superadmin_acesso_pelo_bko(uuid, uuid) IS
  'Portal /config pelo BKO (0076, 45 A): true se o e-mail (normalizado) do usuário não excluído do tenant é o de um superadmin ativo, não excluído, destravado e sem troca de senha pendente; false nos outros casos. Só lê, não audita, não devolve e-mail. Só macuxierp_config. v0.3.21.';

-- (c) Abrir o /config com a sessão do BKO. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.superadmin_abrir_sessao_pelo_bko(p_refresh_hash plataforma.sha256_hex,
  p_token_hash plataforma.sha256_hex, p_expira_max timestamptz)
  RETURNS TABLE (superadmin_id uuid, expira_em timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_bko plataforma.sessao;
  v_email text;
  v_deve boolean;
  v_sa uuid;
  v_expira timestamptz;
  v_sessao uuid;
BEGIN
  -- Sessão do BKO válida: só lida e travada contra a chamada concorrente do mesmo refresh.
  SELECT x.* INTO v_bko FROM plataforma.sessao x
  WHERE x.refresh_hash = p_refresh_hash AND x.revogada_em IS NULL AND x.deleted_at IS NULL AND x.expira_em > now()
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- A regra de ativo do BKO: tenant em 'ativo' e não excluído; usuário ativo e não excluído.
  SELECT u.email, u.deve_trocar_senha INTO v_email, v_deve
  FROM plataforma.usuario u JOIN plataforma.tenant t ON t.id = u.tenant_id
  WHERE u.tenant_id = v_bko.tenant_id AND u.id = v_bko.usuario_id AND u.ativo AND u.deleted_at IS NULL
    AND t.situacao = 'ativo' AND t.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_deve THEN
    RAISE EXCEPTION 'troca de senha pendente no ERP' USING ERRCODE = 'MXS11';
  END IF;
  v_sa := plataforma.superadmin_apto_por_email(v_email);
  IF v_sa IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao /config' USING ERRCODE = 'MXS12';
  END IF;
  -- least ignora NULL: o p_expira_max nulo é recusado à parte.
  v_expira := least(p_expira_max, v_bko.expira_em, now() + interval '8 hours');
  IF p_expira_max IS NULL OR v_expira <= now() THEN
    RAISE EXCEPTION 'validade da sessão fora de (agora, agora + 8 h]' USING ERRCODE = 'check_violation';
  END IF;
  -- Uma sessão do /config por sessão do BKO (a família inteira do refresh rotativo).
  UPDATE plataforma.sessao_superadmin x SET revogada_em = now()
  WHERE x.superadmin_id = v_sa AND x.revogada_em IS NULL
    AND x.origem_sessao_bko IN (SELECT b.id FROM plataforma.sessao b
                                WHERE b.tenant_id = v_bko.tenant_id AND b.familia = v_bko.familia);
  INSERT INTO plataforma.sessao_superadmin (superadmin_id, token_hash, expira_em, ultimo_uso_em, origem_sessao_bko)
  VALUES (v_sa, p_token_hash, v_expira, now(), v_bko.id)
  RETURNING id INTO v_sessao;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), v_sa, 'plataforma.superadmin.entrar_pelo_bko',
    'superadmin', v_sa, NULL,
    jsonb_build_object('tenant_origem', v_bko.tenant_id, 'usuario_id', v_bko.usuario_id, 'sessao_bko_id', v_bko.id),
    NULL);
  superadmin_id := v_sa;
  expira_em := v_expira;
  RETURN NEXT;
END $$;
COMMENT ON FUNCTION plataforma.superadmin_abrir_sessao_pelo_bko(plataforma.sha256_hex, plataforma.sha256_hex, timestamptz) IS
  'Portal /config pelo BKO (0076, 45 A): pelo hash do refresh do BKO (não revogado, não excluído, não vencido; tenant ativo; usuário ativo e não excluído; senão nenhuma linha), acha o superadmin do mesmo e-mail normalizado, revoga a sessão do /config aberta antes pela mesma família do BKO, abre a nova com expira_em = least(p_expira_max, expira_em do refresh, agora + 8 h) e origem_sessao_bko, e audita plataforma.superadmin.entrar_pelo_bko no tenant de referência com {tenant_origem, usuario_id, sessao_bko_id}. Não muda a sessão do BKO nem falhas_login, bloqueado_ate e ultimo_acesso_em do superadmin. MXS11 (troca pendente do usuário), MXS12 (sem superadmin apto), 23514 (validade), 23505 (token repetido). Só macuxierp_config. v0.3.21.';

REVOKE ALL ON FUNCTION plataforma.superadmin_apto_por_email(text), plataforma.superadmin_acesso_pelo_bko(uuid, uuid),
  plataforma.superadmin_abrir_sessao_pelo_bko(plataforma.sha256_hex, plataforma.sha256_hex, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.superadmin_acesso_pelo_bko(uuid, uuid),
  plataforma.superadmin_abrir_sessao_pelo_bko(plataforma.sha256_hex, plataforma.sha256_hex, timestamptz)
  TO macuxierp_config;
