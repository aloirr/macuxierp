-- 0051 — Hotfix: consumir a senha temporária destrava o superadmin (RN-CORE-10; pedido do dono do produto: "Quando eu
-- clicar em esqueci a senha, é para desbloquear o usuario. para eu tentar com a senha temporaria").
-- Aditiva e reexecutável: CREATE OR REPLACE (mesma assinatura e retorno), COMMENT ON e REVOKE/GRANT reafirmados.
--
-- O que muda:
-- - plataforma.superadmin_consumir_temporaria(p_id uuid) RETURNS boolean (0048) passa a zerar também falhas_login e
--   bloqueado_ate, no mesmo UPDATE atômico que zera as duas colunas da temporária e liga deve_trocar_senha. O WHERE, o
--   retorno, a auditoria (plataforma.superadmin.senha_temporaria_usada), o DEFINER e o search_path não mudam.
--
-- O que não muda:
-- - plataforma.superadmin_abrir_sessao (0033) continua recusando o superadmin travado (MXS01): sem consumo de
--   temporária válida, a senha atual segue barrada pela trava;
-- - temporária ausente, vencida ou já usada: nada é atualizado (false), e falhas_login e bloqueado_ate ficam como estão.
--
-- A 0048 e a 0050 não são editadas (o migrar recusa sha256 diferente).

CREATE OR REPLACE FUNCTION plataforma.superadmin_consumir_temporaria(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid;
BEGIN
  -- Um UPDATE só (sem SELECT FOR UPDATE): duas conexões ao mesmo tempo, só uma acha a temporária; a outra espera a
  -- trava da linha, reavalia o WHERE e não acha nada. A trava da §6 sai junto (0051).
  UPDATE plataforma.superadmin
  SET senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL, deve_trocar_senha = true, falhas_login = 0,
    bloqueado_ate = NULL
  WHERE id = p_id AND senha_temporaria_hash IS NOT NULL AND senha_temporaria_expira_em > now()
    AND ativo AND deleted_at IS NULL
  RETURNING id INTO v_sa;
  IF v_sa IS NULL THEN
    RETURN false;
  END IF;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), v_sa,
    'plataforma.superadmin.senha_temporaria_usada', 'superadmin', v_sa, NULL, NULL, NULL);
  RETURN true;
END $$;
COMMENT ON FUNCTION plataforma.superadmin_consumir_temporaria(uuid) IS
  'Portal /config (0048; 0051 destrava): consome a senha temporária não vencida (uso único, UPDATE atômico): zera as duas colunas, liga deve_trocar_senha, zera falhas_login e bloqueado_ate (a temporária válida destrava o login) e audita plataforma.superadmin.senha_temporaria_usada; true se consumiu, false se não havia, venceu, já foi usada ou o superadmin está inativo (aí nada muda, nem a trava). A API confere o argon2 antes. Sem sessão. Só macuxierp_config. T-0076, hotfix 0051.';

-- Privilégios: o CREATE OR REPLACE os mantém; aqui são reafirmados (nada para PUBLIC; EXECUTE só do macuxierp_config).
REVOKE ALL ON FUNCTION plataforma.superadmin_consumir_temporaria(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.superadmin_consumir_temporaria(uuid) TO macuxierp_config;
