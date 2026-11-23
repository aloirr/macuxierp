-- 0036 — Troca obrigatória da senha provisória do usuário do ERP (T-0052, v0.3.1; ADR 0012). Aditiva e reexecutável:
-- ADD COLUMN IF NOT EXISTS, GRANT e CREATE OR REPLACE.
--
-- Decisão do Alexandre (23/11/2026, ~09h55 de Manaus), via gerente-projetos: a senha provisória (definida pelo portal
-- /config ou por um operador) obriga o usuário a trocá-la no primeiro acesso.
--
-- O que entra:
-- - coluna plataforma.usuario.deve_trocar_senha (boolean NOT NULL DEFAULT false): default false de propósito, as linhas
--   que já existem não são forçadas a trocar (ao contrário de plataforma.superadmin, default true na 0033);
-- - leitura da coluna para macuxierp_worker e macuxierp_leitura (o SELECT deles em plataforma.usuario é por coluna,
--   0002); o macuxierp_app já tem SELECT, INSERT e UPDATE de tabela (0002), que cobre a coluna nova;
-- - plataforma.empresa_primeiro_admin_criar e plataforma.empresa_primeiro_admin_senha (versões da 0033; a 0035 não as
--   redefiniu) iguais, só gravando deve_trocar_senha = true no administrador. Mesma assinatura, SECURITY DEFINER e
--   search_path; o CREATE OR REPLACE mantém dono e privilégios (EXECUTE só do macuxierp_config, 0033), e o REVOKE/GRANT
--   abaixo os reafirma.
--
-- Premissas (banco-dados):
-- - quem zera a coluna é o modulo-core na API, quando o próprio usuário troca a senha (UPDATE do macuxierp_app no
--   próprio tenant, sob a RLS da 0002); o banco não tem gatilho para isso;
-- - a auditoria das duas funções continua igual (sem e-mail, nome nem hash).

ALTER TABLE plataforma.usuario ADD COLUMN IF NOT EXISTS deve_trocar_senha boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN plataforma.usuario.deve_trocar_senha IS
  'true quando a senha é provisória (definida pelo portal /config ou por um operador): o usuário precisa trocá-la no próximo acesso. A troca pelo próprio usuário zera (quem zera é o modulo-core na API). Default false de propósito: as linhas existentes não são forçadas a trocar (ao contrário de plataforma.superadmin, default true na 0033). T-0052 (0036).';

GRANT SELECT (deve_trocar_senha) ON plataforma.usuario TO macuxierp_worker, macuxierp_leitura;

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
  INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, deve_trocar_senha)
  VALUES (v_usuario, t.id, lower(btrim(p_email)), btrim(p_nome), p_senha_hash, 'administrador', true);
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.admin.criar', 'usuario', v_usuario, NULL,
    jsonb_build_object('perfil', 'administrador', 'ativo', true), p_request_id);
  RETURN v_usuario;
END $$;
COMMENT ON FUNCTION plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text) IS
  'Portal /config (0033; 0036 grava deve_trocar_senha = true): cria o 1º administrador da empresa (ativa ou suspensa) se ela não tem administrador ativo, com a senha provisória; audita sem e-mail, nome nem hash. Só macuxierp_config. T-0050, T-0052.';

CREATE OR REPLACE FUNCTION plataforma.empresa_primeiro_admin_senha(p_id uuid, p_senha_hash text, p_request_id text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  v_usuario uuid;
  v_revogadas integer;
BEGIN
  t := plataforma.empresa_alvo(p_id, false);
  v_usuario := plataforma.primeiro_admin(t.id);
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'a empresa não tem administrador' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE plataforma.usuario SET senha_hash = p_senha_hash, falhas_login = 0, bloqueado_ate = NULL,
    deve_trocar_senha = true
  WHERE id = v_usuario;
  UPDATE plataforma.sessao SET revogada_em = now()
  WHERE tenant_id = t.id AND usuario_id = v_usuario AND revogada_em IS NULL;
  GET DIAGNOSTICS v_revogadas = ROW_COUNT;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.admin.redefinir_senha', 'usuario', v_usuario, NULL,
    jsonb_build_object('sessoes_revogadas', v_revogadas), p_request_id);
  RETURN v_usuario;
END $$;
COMMENT ON FUNCTION plataforma.empresa_primeiro_admin_senha(uuid, text, text) IS
  'Portal /config (0033; 0036 grava deve_trocar_senha = true): redefine a senha provisória do 1º administrador (zera falhas e trava, revoga as sessões dele) e audita sem hash. Só macuxierp_config. T-0050, T-0052.';

REVOKE ALL ON FUNCTION plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text),
  plataforma.empresa_primeiro_admin_senha(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text),
  plataforma.empresa_primeiro_admin_senha(uuid, text, text) TO macuxierp_config;
