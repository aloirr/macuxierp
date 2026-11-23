-- 0033 — Superadmin de plataforma e portal /config (T-0050, etapa E2; ADR 0012, seções 1, 4 e 6; RN-CORE-01 e
-- RN-CORE-09). Aditiva e reexecutável: CREATE ... IF NOT EXISTS, CREATE OR REPLACE e DO com EXCEPTION.
--
-- O que entra:
-- - papel macuxierp_config (NOLOGIN, sem BYPASSRLS): a apps/api entra nele só com SET LOCAL ROLE (o app é membro com
--   INHERIT FALSE e SET TRUE, PG16) e só ele executa as funções de lista fechada da ADR §4;
-- - plataforma.superadmin e plataforma.sessao_superadmin (regra 5, tenant_id = tenant de referência);
-- - plataforma.auditoria.superadmin_id (autor do portal), com CHECK de um autor só; o app e o worker não gravam a coluna;
-- - o perfil analista_implantacao no CHECK de plataforma.usuario.perfil (RN-CORE-01, RN-CORE-09);
-- - as funções SECURITY DEFINER do portal (login, sessão, troca de senha, empresas e Idempotency-Key de /v1/plataforma/*).
--
-- Premissas (decididas pelo gerente-projetos na T-0050):
-- - RLS ligada SEM FORCE nas duas tabelas novas, com a política isolamento_tenant de controle.preparar_tabela (exigida
--   pelo teste da regra 5). A ADR fala em "RLS forçado", mas as funções SECURITY DEFINER são donas das tabelas e, no
--   admin sem superusuário do DBaaS, o FORCE sem política que as libere as cegaria. Mesmo padrão da 0002 ("dono da
--   tabela, sem FORCE RLS"). Nenhum GRANT de tabela a app, worker, leitura ou config: a proteção é o privilégio.
-- - superadmin_senha_atual() faz parte da família superadmin_trocar_senha(...) da ADR §4: a API confere o argon2 da
--   senha atual, e a sessão não leva o e-mail para usar superadmin_para_login.
-- - superadmin_abrir_sessao também recusa o superadmin com a trava da §6 ainda de pé (defesa em profundidade; a API já
--   confere antes).
-- - Nenhuma função lê schema de módulo (core, cadastros, pedido, faturamento, fiscal, integracao_fdv, sefaz_simulador):
--   o superadmin não vê dado de negócio. Nenhuma grava nome de empresa, e-mail, nome de pessoa, senha ou hash na
--   auditoria (LGPD, regra 8).
-- - Sessão inválida = SQLSTATE próprio MXS01 ("sessão de superadmin inválida", sem dado pessoal), que a API traduz
--   em 401.

-- Papel do portal. Criado uma vez, com os atributos finais (nenhuma migração faz ALTER ROLE de atributo; molde da 0001).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'macuxierp_config') THEN
    BEGIN
      CREATE ROLE macuxierp_config NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
END $$;

-- O app ganha o papel só por SET ROLE, nunca por herança (PG16). Concessão concorrente de outro banco do mesmo
-- cluster (testes em paralelo) pode falhar: se, depois do erro, a concessão está lá, segue.
DO $$
BEGIN
  BEGIN
    GRANT macuxierp_config TO macuxierp_app WITH INHERIT FALSE, SET TRUE;
  EXCEPTION WHEN OTHERS THEN
    IF NOT EXISTS (SELECT 1 FROM pg_auth_members m
                   WHERE m.roleid = 'macuxierp_config'::regrole AND m.member = 'macuxierp_app'::regrole
                     AND m.set_option AND NOT m.inherit_option) THEN
      RAISE;
    END IF;
  END;
END $$;

GRANT USAGE ON SCHEMA plataforma TO macuxierp_config;

-- Superadmin (ADR §1): fora dos tenants; o tenant_id é sempre o de referência (D9).
CREATE TABLE IF NOT EXISTS plataforma.superadmin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%' AND length(email) <= 254),
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  senha_hash text NOT NULL CHECK (senha_hash LIKE '$argon2id$%'),
  deve_trocar_senha boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  falhas_login integer NOT NULL DEFAULT 0 CHECK (falhas_login >= 0),
  bloqueado_ate timestamptz,
  ultimo_acesso_em timestamptz,
  senha_trocada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT superadmin_tenant_referencia CHECK (tenant_id = plataforma.tenant_referencia())
);
SELECT controle.preparar_tabela('plataforma.superadmin');
CREATE UNIQUE INDEX IF NOT EXISTS superadmin_email_uq ON plataforma.superadmin (email) WHERE deleted_at IS NULL;
COMMENT ON TABLE plataforma.superadmin IS
  'Superadmin de plataforma (portal /config, ADR 0012). Sem GRANT a papel nenhum: só as funções SECURITY DEFINER da 0033 leem e gravam. T-0050.';

-- Sessão do superadmin (ADR §1): só o SHA-256 do token opaco; absoluta de 8 h e ociosidade de 30 min.
CREATE TABLE IF NOT EXISTS plataforma.sessao_superadmin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  superadmin_id uuid NOT NULL REFERENCES plataforma.superadmin (id),
  token_hash plataforma.sha256_hex NOT NULL UNIQUE,
  expira_em timestamptz NOT NULL,
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT sessao_superadmin_tenant_referencia CHECK (tenant_id = plataforma.tenant_referencia())
);
SELECT controle.preparar_tabela('plataforma.sessao_superadmin');
CREATE INDEX IF NOT EXISTS sessao_superadmin_superadmin_idx ON plataforma.sessao_superadmin (superadmin_id);
COMMENT ON TABLE plataforma.sessao_superadmin IS
  'Sessão do portal /config (ADR 0012): token só em SHA-256; vencida, ociosa ou revogada há mais de 30 dias sai em superadmin_abrir_sessao. Sem GRANT a papel nenhum. T-0050.';

-- Autor do portal na auditoria (ADR §1): usuario_id OU superadmin_id, nunca os dois.
ALTER TABLE plataforma.auditoria ADD COLUMN IF NOT EXISTS superadmin_id uuid REFERENCES plataforma.superadmin (id);
ALTER TABLE plataforma.auditoria DROP CONSTRAINT IF EXISTS auditoria_um_autor,
  ADD CONSTRAINT auditoria_um_autor CHECK (usuario_id IS NULL OR superadmin_id IS NULL);
CREATE INDEX IF NOT EXISTS auditoria_superadmin_idx ON plataforma.auditoria (superadmin_id, ocorrido_em)
  WHERE superadmin_id IS NOT NULL;
COMMENT ON COLUMN plataforma.auditoria.superadmin_id IS
  'Superadmin autor (portal /config, ADR 0012); só as funções da 0033 gravam. Com ele, usuario_id é nulo (auditoria_um_autor).';
-- O app e o worker não forjam autoria de superadmin: INSERT só nas colunas de sempre (lista fechada por coluna).
-- Coluna nova em plataforma.auditoria que o app ou o worker gravem PRECISA entrar nesta lista (migração nova).
REVOKE INSERT ON plataforma.auditoria FROM macuxierp_app, macuxierp_worker;
GRANT INSERT (id, tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois, request_id, ocorrido_em,
  created_at, updated_at, deleted_at, external_id) ON plataforma.auditoria TO macuxierp_app, macuxierp_worker;
COMMENT ON CONSTRAINT auditoria_um_autor ON plataforma.auditoria IS
  'Um autor só: usuario_id OU superadmin_id (0033). O INSERT do app e do worker é por coluna, sem superadmin_id: coluna nova que eles gravem precisa entrar no GRANT INSERT (...) da 0033 em migração nova. T-0050.';

-- Perfil analista_implantacao (RN-CORE-01, RN-CORE-09; ADR 0012 §1).
ALTER TABLE plataforma.usuario DROP CONSTRAINT IF EXISTS usuario_perfil_check,
  ADD CONSTRAINT usuario_perfil_check CHECK (perfil IN ('administrador', 'gerente', 'faturista', 'fiscal', 'vendedor',
    'leitura', 'analista_implantacao'));

-- ---------------------------------------------------------------------------------------------------------------
-- Funções internas (sem EXECUTE para ninguém): só as funções do portal as chamam, como donas.
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.instante_iso(p timestamptz) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
COMMENT ON FUNCTION plataforma.instante_iso(timestamptz) IS
  'Interna (0033): instante em ISO 8601 UTC com "Z" (z.string().datetime() do SDK). T-0050.';

CREATE OR REPLACE FUNCTION plataforma.sessao_superadmin_valida(p_sessao uuid, p_token_hash text,
  p_permitir_troca boolean)
  RETURNS TABLE (sessao_id uuid, superadmin_id uuid, nome text, deve_trocar_senha boolean, expira_em timestamptz)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  UPDATE plataforma.sessao_superadmin x SET ultimo_uso_em = now()
  FROM plataforma.superadmin a
  WHERE ((p_sessao IS NOT NULL AND x.id = p_sessao) OR (p_token_hash IS NOT NULL AND x.token_hash = p_token_hash))
    AND a.id = x.superadmin_id
    AND x.revogada_em IS NULL AND x.deleted_at IS NULL AND x.expira_em > now()
    AND x.ultimo_uso_em > now() - interval '30 minutes'
    AND a.ativo AND a.deleted_at IS NULL
    AND (p_permitir_troca OR NOT a.deve_trocar_senha)
  RETURNING x.id, x.superadmin_id, a.nome, a.deve_trocar_senha, x.expira_em
$$;
COMMENT ON FUNCTION plataforma.sessao_superadmin_valida(uuid, text, boolean) IS
  'Interna (0033): a regra única de sessão de superadmin válida (pelo id ou pelo hash do token): não revogada, não excluída, expira_em > now(), menos de 30 min ociosa, superadmin ativo e não excluído e, salvo p_permitir_troca, sem troca de senha pendente; renova ultimo_uso_em. Vazio se inválida. ADR 0012 §1 e §4. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.exigir_superadmin(p_permitir_troca boolean DEFAULT false) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_txt text := nullif(btrim(current_setting('macuxierp.sessao_superadmin', true)), '');
  v_sa uuid;
BEGIN
  IF v_txt IS NULL OR v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'sessão de superadmin inválida' USING ERRCODE = 'MXS01';
  END IF;
  SELECT v.superadmin_id INTO v_sa FROM plataforma.sessao_superadmin_valida(v_txt::uuid, NULL, p_permitir_troca) v;
  IF v_sa IS NULL THEN
    RAISE EXCEPTION 'sessão de superadmin inválida' USING ERRCODE = 'MXS01';
  END IF;
  RETURN v_sa;
END $$;
COMMENT ON FUNCTION plataforma.exigir_superadmin(boolean) IS
  'Interna (0033): confere a sessão de macuxierp.sessao_superadmin por sessao_superadmin_valida (que renova ultimo_uso_em) e devolve o superadmin_id; senão MXS01. ADR 0012 §4. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.auditar_superadmin(p_tenant uuid, p_superadmin uuid, p_acao text, p_entidade text,
  p_entidade_id uuid, p_antes jsonb, p_depois jsonb, p_request_id text) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  INSERT INTO plataforma.auditoria (tenant_id, usuario_id, superadmin_id, acao, entidade, entidade_id, antes, depois,
    request_id)
  VALUES (p_tenant, NULL, p_superadmin, p_acao, p_entidade, p_entidade_id, p_antes, p_depois, p_request_id)
$$;
COMMENT ON FUNCTION plataforma.auditar_superadmin(uuid, uuid, text, text, uuid, jsonb, jsonb, text) IS
  'Interna (0033): linha de auditoria do portal (usuario_id nulo, superadmin_id do autor). Quem chama não passa nome, e-mail, senha nem hash. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.licencas_json(p_tenant uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('modulo', m.modulo, 'ativo', m.ativo,
           'valido_ate', plataforma.instante_iso(m.valido_ate)) ORDER BY m.modulo), '[]'::jsonb)
  FROM plataforma.tenant_modulo m
  WHERE m.tenant_id = p_tenant AND m.deleted_at IS NULL
$$;
COMMENT ON FUNCTION plataforma.licencas_json(uuid) IS
  'Interna (0033): licenças não excluídas do tenant, por módulo, no formato LicencaModuloPlataforma. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.primeiro_admin(p_tenant uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT u.id FROM plataforma.usuario u
  WHERE u.tenant_id = p_tenant AND u.perfil = 'administrador' AND u.ativo AND u.deleted_at IS NULL
  ORDER BY u.created_at, u.id
  LIMIT 1
$$;
COMMENT ON FUNCTION plataforma.primeiro_admin(uuid) IS
  'Interna (0033): o administrador ativo e não excluído mais antigo do tenant (created_at, id), ou nulo. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.empresa_json(p_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'nome', t.nome, 'fuso', t.fuso, 'situacao', t.situacao,
    'modulos', plataforma.licencas_json(t.id),
    'primeiro_admin', (SELECT jsonb_build_object('id', u.id, 'ativo', u.ativo,
                         'bloqueado', coalesce(u.bloqueado_ate > now(), false))
                       FROM plataforma.usuario u WHERE u.id = plataforma.primeiro_admin(t.id)),
    'created_at', plataforma.instante_iso(t.created_at),
    'updated_at', plataforma.instante_iso(t.updated_at))
  FROM plataforma.tenant t
  WHERE t.id = p_id
$$;
COMMENT ON FUNCTION plataforma.empresa_json(uuid) IS
  'Interna (0033): a empresa no formato EmpresaPlataforma do SDK (portal-config.ts), sem e-mail nem nome do admin. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.empresa_visivel(t plataforma.tenant) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT t.id <> plataforma.tenant_referencia() AND t.situacao <> 'referencia' AND t.deleted_at IS NULL $$;
COMMENT ON FUNCTION plataforma.empresa_visivel(plataforma.tenant) IS
  'Interna (0033): a empresa que o portal enxerga (não é a de referência nem está excluída); filtro único de empresa_alvo, empresas_listar e empresa_ler. T-0050.';

-- Versão anterior (só a sessão de desenvolvimento a teve): a reexecução não deixa duas assinaturas.
DROP FUNCTION IF EXISTS plataforma.empresa_alvo(uuid);
CREATE OR REPLACE FUNCTION plataforma.empresa_alvo(p_id uuid, p_ativo_ou_suspenso boolean) RETURNS plataforma.tenant
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  t plataforma.tenant;
BEGIN
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_id AND plataforma.empresa_visivel(x) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_ativo_ou_suspenso AND t.situacao NOT IN ('ativo', 'suspenso') THEN
    RAISE EXCEPTION 'empresa fora de ativo ou suspenso' USING ERRCODE = 'check_violation';
  END IF;
  RETURN t;
END $$;
COMMENT ON FUNCTION plataforma.empresa_alvo(uuid, boolean) IS
  'Interna (0033): trava e devolve a empresa alvo do portal; inexistente, excluída ou de referência = no_data_found; com p_ativo_ou_suspenso, situação fora de ativo|suspenso = check_violation. T-0050.';

-- ---------------------------------------------------------------------------------------------------------------
-- Login e sessão do superadmin (executáveis só por macuxierp_config; as de login rodam sem sessão).
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.superadmin_para_login(p_email text)
  RETURNS TABLE (id uuid, senha_hash text, nome text, ativo boolean, falhas_login integer, bloqueado_ate timestamptz,
    deve_trocar_senha boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT s.id, s.senha_hash, s.nome, s.ativo, s.falhas_login, s.bloqueado_ate, s.deve_trocar_senha
  FROM plataforma.superadmin s
  WHERE s.email = lower(btrim(p_email)) AND s.deleted_at IS NULL
$$;
COMMENT ON FUNCTION plataforma.superadmin_para_login(text) IS
  'Portal /config (0033): o superadmin não excluído do e-mail (normalizado), para a API conferir o argon2 e a trava. Sem sessão. Só macuxierp_config. ADR 0012 §4. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_registrar_falha(p_id uuid, p_falhas integer, p_trava timestamptz)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_falhas integer;
  v_trava timestamptz;
BEGIN
  -- Só sobe: duas falhas concorrentes (ou um p_falhas atrasado) não zeram a contagem nem recuam a trava
  -- (greatest ignora NULL).
  UPDATE plataforma.superadmin
  SET falhas_login = greatest(falhas_login + 1, p_falhas), bloqueado_ate = greatest(bloqueado_ate, p_trava)
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING falhas_login, bloqueado_ate INTO v_falhas, v_trava;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'superadmin não encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), p_id, 'plataforma.superadmin.falha',
    'superadmin', p_id, NULL, jsonb_build_object('falhas', v_falhas, 'bloqueado_ate', plataforma.instante_iso(v_trava)),
    NULL);
END $$;
COMMENT ON FUNCTION plataforma.superadmin_registrar_falha(uuid, integer, timestamptz) IS
  'Portal /config (0033): soma a falha (falhas_login = greatest(atual + 1, p_falhas)) e só estende a trava (greatest(bloqueado_ate, p_trava)) (ADR 0012 §6) e audita no tenant de referência. Sem sessão. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_abrir_sessao(p_id uuid, p_token_hash plataforma.sha256_hex,
  p_expira_em timestamptz) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sessao uuid;
BEGIN
  IF p_expira_em IS NULL OR p_expira_em <= now() OR p_expira_em > now() + interval '8 hours' THEN
    RAISE EXCEPTION 'validade da sessão fora de (agora, agora + 8 h]' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE plataforma.superadmin SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso_em = now()
  WHERE id = p_id AND ativo AND deleted_at IS NULL AND (bloqueado_ate IS NULL OR bloqueado_ate <= now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sessão de superadmin inválida' USING ERRCODE = 'MXS01';
  END IF;
  INSERT INTO plataforma.sessao_superadmin (superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES (p_id, p_token_hash, p_expira_em, now())
  RETURNING id INTO v_sessao;
  -- Limpeza da ADR §1: sessão vencida, ociosa ou revogada há mais de 30 dias (só ids e datas).
  -- No máximo 500 por login, para não segurar trava; o resto sai nos próximos logins.
  DELETE FROM plataforma.sessao_superadmin
  WHERE ctid IN (
    SELECT x.ctid FROM plataforma.sessao_superadmin x
    WHERE x.expira_em < now() - interval '30 days' OR x.ultimo_uso_em < now() - interval '30 days'
       OR x.revogada_em < now() - interval '30 days'
    ORDER BY x.expira_em LIMIT 500);
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), p_id, 'plataforma.superadmin.entrar',
    'superadmin', p_id, NULL, NULL, NULL);
  RETURN v_sessao;
END $$;
COMMENT ON FUNCTION plataforma.superadmin_abrir_sessao(uuid, plataforma.sha256_hex, timestamptz) IS
  'Portal /config (0033): depois do argon2 certo, zera falhas e trava, abre a sessão (até 8 h), limpa as de mais de 30 dias e audita. Sem sessão. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_sessao_por_token(p_token_hash plataforma.sha256_hex)
  RETURNS TABLE (sessao_id uuid, superadmin_id uuid, nome text, deve_trocar_senha boolean, expira_em timestamptz)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT v.sessao_id, v.superadmin_id, v.nome, v.deve_trocar_senha, v.expira_em
  FROM plataforma.sessao_superadmin_valida(NULL, p_token_hash, true) v
$$;
COMMENT ON FUNCTION plataforma.superadmin_sessao_por_token(plataforma.sha256_hex) IS
  'Portal /config (0033): a sessão válida do hash do token (aceita troca de senha pendente), com ultimo_uso_em atualizado; vazio se inválida. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_sair(p_sessao_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin(true);
BEGIN
  IF p_sessao_id IS DISTINCT FROM current_setting('macuxierp.sessao_superadmin', true)::uuid THEN
    RAISE EXCEPTION 'sessão de superadmin inválida' USING ERRCODE = 'MXS01';
  END IF;
  UPDATE plataforma.sessao_superadmin SET revogada_em = now() WHERE id = p_sessao_id AND revogada_em IS NULL;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), v_sa, 'plataforma.superadmin.sair',
    'superadmin', v_sa, NULL, NULL, NULL);
END $$;
COMMENT ON FUNCTION plataforma.superadmin_sair(uuid) IS
  'Portal /config (0033): revoga a sessão corrente (a mesma da configuração local) e audita. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_senha_atual() RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin(true);
BEGIN
  RETURN (SELECT senha_hash FROM plataforma.superadmin WHERE id = v_sa);
END $$;
COMMENT ON FUNCTION plataforma.superadmin_senha_atual() IS
  'Portal /config (0033): hash argon2 do superadmin da sessão, para a API conferir a senha atual antes da troca. Família superadmin_trocar_senha(...) da ADR 0012 §4 (premissa da T-0050: a sessão não leva o e-mail). Só macuxierp_config.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_trocar_senha(p_senha_hash_atual text, p_senha_hash_nova text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin(true);
  v_sessao uuid := current_setting('macuxierp.sessao_superadmin', true)::uuid;
  v_revogadas integer;
BEGIN
  UPDATE plataforma.superadmin
  SET senha_hash = p_senha_hash_nova, deve_trocar_senha = false, senha_trocada_em = now(), falhas_login = 0,
    bloqueado_ate = NULL
  WHERE id = v_sa AND senha_hash = p_senha_hash_atual;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a senha mudou; entre de novo' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE plataforma.sessao_superadmin SET revogada_em = now()
  WHERE superadmin_id = v_sa AND id <> v_sessao AND revogada_em IS NULL;
  GET DIAGNOSTICS v_revogadas = ROW_COUNT;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), v_sa, 'plataforma.superadmin.senha',
    'superadmin', v_sa, NULL, jsonb_build_object('sessoes_revogadas', v_revogadas), NULL);
END $$;
COMMENT ON FUNCTION plataforma.superadmin_trocar_senha(text, text) IS
  'Portal /config (0033): troca a senha (só se o hash atual ainda é o conferido), tira a troca pendente, zera a trava, revoga as outras sessões e audita. Só macuxierp_config. ADR 0012 §4. T-0050.';

-- ---------------------------------------------------------------------------------------------------------------
-- Empresas (ADR §4): toda função exige sessão de superadmin e nunca toca o tenant de referência.
-- ---------------------------------------------------------------------------------------------------------------

-- Versão anterior (cursor por slug, text; só a sessão de desenvolvimento a teve): a reexecução não deixa duas.
DROP FUNCTION IF EXISTS plataforma.empresas_listar(text, text, integer);
CREATE OR REPLACE FUNCTION plataforma.empresas_listar(p_busca text, p_cursor uuid, p_limite integer)
  RETURNS SETOF jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_busca text := nullif(lower(btrim(p_busca)), '');
BEGIN
  -- Paginação por id, como o contrato (ConsultaPaginada, paginaDe e paginar de packages/platform-sdk/src/listas.ts).
  -- O limite fica em 1..201: a API pede limite + 1 (LIMITE_MAXIMO 200 + 1) para saber se há próxima página.
  RETURN QUERY
  SELECT plataforma.empresa_json(t.id)
  FROM plataforma.tenant t
  WHERE plataforma.empresa_visivel(t)
    AND (v_busca IS NULL OR strpos(t.slug, v_busca) > 0)
    AND (p_cursor IS NULL OR t.id > p_cursor)
  ORDER BY t.id
  LIMIT greatest(1, least(coalesce(p_limite, 201), 201));
END $$;
COMMENT ON FUNCTION plataforma.empresas_listar(text, uuid, integer) IS
  'Portal /config (0033): empresas (sem a de referência e sem excluídas) por id, com busca no slug e cursor por id (contrato de listas.ts); limite 1..201 (a API pede limite + 1, LIMITE_MAXIMO 200 + 1). Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.empresa_ler(p_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
BEGIN
  RETURN (SELECT plataforma.empresa_json(t.id) FROM plataforma.tenant t
          WHERE t.id = p_id AND plataforma.empresa_visivel(t));
END $$;
COMMENT ON FUNCTION plataforma.empresa_ler(uuid) IS
  'Portal /config (0033): a empresa (EmpresaPlataforma), ou NULL se não existe, foi excluída ou é a de referência. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.empresa_criar(p_slug text, p_nome text, p_fuso text, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_slug text := lower(btrim(p_slug));
  v_fuso text := coalesce(nullif(btrim(p_fuso), ''), 'America/Manaus');
  v_id uuid := gen_random_uuid();
BEGIN
  -- Espelho de SLUGS_RESERVADOS (packages/platform-sdk/src/portal-config.ts): mudou lá, muda aqui (migração nova).
  IF v_slug IN ('referencia', 'config', 'plataforma') THEN
    RAISE EXCEPTION 'slug reservado' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_fuso) THEN
    RAISE EXCEPTION 'fuso desconhecido' USING ERRCODE = 'check_violation';
  END IF;
  -- Slug repetido cai no unique_violation natural de plataforma.tenant.slug.
  INSERT INTO plataforma.tenant (id, tenant_id, slug, nome, fuso, situacao)
  VALUES (v_id, v_id, v_slug, btrim(p_nome), v_fuso, 'ativo');
  INSERT INTO plataforma.tenant_modulo (tenant_id, modulo, ativo) VALUES (v_id, 'core', true);
  PERFORM plataforma.auditar_superadmin(v_id, v_sa, 'plataforma.empresa.criar', 'tenant', v_id, NULL,
    jsonb_build_object('slug', v_slug, 'situacao', 'ativo', 'modulos', jsonb_build_array('core')), p_request_id);
  RETURN plataforma.empresa_json(v_id);
END $$;
COMMENT ON FUNCTION plataforma.empresa_criar(text, text, text, text) IS
  'Portal /config (0033): cria a empresa (ativa, com a licença do core) e audita sem o nome. Slug reservado ou fuso desconhecido = check_violation. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.empresa_situacao(p_id uuid, p_situacao text, p_motivo text, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_motivo text := btrim(p_motivo);
  t plataforma.tenant;
  v_revogadas integer := 0;
BEGIN
  IF p_situacao IS NULL OR p_situacao NOT IN ('ativo', 'suspenso') THEN
    RAISE EXCEPTION 'situação fora de ativo ou suspenso' USING ERRCODE = 'check_violation';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'motivo com 3 a 200 caracteres' USING ERRCODE = 'check_violation';
  END IF;
  t := plataforma.empresa_alvo(p_id, true);
  IF t.situacao = p_situacao THEN
    RETURN plataforma.empresa_json(t.id);
  END IF;
  UPDATE plataforma.tenant SET situacao = p_situacao WHERE id = t.id;
  IF p_situacao = 'suspenso' THEN
    UPDATE plataforma.sessao SET revogada_em = now() WHERE tenant_id = t.id AND revogada_em IS NULL;
    GET DIAGNOSTICS v_revogadas = ROW_COUNT;
  END IF;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.empresa.situacao', 'tenant', t.id,
    jsonb_build_object('situacao', t.situacao),
    jsonb_build_object('situacao', p_situacao, 'motivo', v_motivo, 'sessoes_revogadas', v_revogadas), p_request_id);
  RETURN plataforma.empresa_json(t.id);
END $$;
COMMENT ON FUNCTION plataforma.empresa_situacao(uuid, text, text, text) IS
  'Portal /config (0033): suspende ou reativa a empresa (suspender revoga as sessões do tenant na mesma transação) e audita com o motivo. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.empresa_modulos(p_id uuid, p_modulos jsonb, p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  e jsonb;
  v_antes jsonb;
BEGIN
  IF p_modulos IS NULL OR jsonb_typeof(p_modulos) <> 'array' OR jsonb_array_length(p_modulos) = 0 THEN
    RAISE EXCEPTION 'lista de módulos vazia ou inválida' USING ERRCODE = 'check_violation';
  END IF;
  FOR e IN SELECT x.value FROM jsonb_array_elements(p_modulos) x LOOP
    IF jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'modulo') IS DISTINCT FROM 'string'
       OR jsonb_typeof(e -> 'ativo') IS DISTINCT FROM 'boolean'
       OR coalesce(jsonb_typeof(e -> 'valido_ate'), 'null') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'módulo fora do formato {modulo, ativo, valido_ate}' USING ERRCODE = 'check_violation';
    END IF;
    IF e ->> 'modulo' = 'core' AND NOT (e ->> 'ativo')::boolean THEN
      RAISE EXCEPTION 'o core não pode ser desligado' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT x.value ->> 'modulo') FROM jsonb_array_elements(p_modulos) x) THEN
    RAISE EXCEPTION 'módulo repetido' USING ERRCODE = 'check_violation';
  END IF;
  t := plataforma.empresa_alvo(p_id, true);
  v_antes := plataforma.licencas_json(t.id);
  -- A dependência entre módulos (depende dos manifestos) é conferida na API (ADR §4); aqui só grava.
  FOR e IN SELECT x.value FROM jsonb_array_elements(p_modulos) x LOOP
    INSERT INTO plataforma.tenant_modulo (tenant_id, modulo, ativo, valido_ate)
    VALUES (t.id, e ->> 'modulo', (e ->> 'ativo')::boolean, (e ->> 'valido_ate')::timestamptz)
    ON CONFLICT (tenant_id, modulo) DO UPDATE
      SET ativo = EXCLUDED.ativo, valido_ate = EXCLUDED.valido_ate, deleted_at = NULL;
  END LOOP;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.modulos.alterar', 'tenant', t.id,
    jsonb_build_object('modulos', v_antes), jsonb_build_object('modulos', plataforma.licencas_json(t.id)),
    p_request_id);
  RETURN plataforma.empresa_json(t.id);
END $$;
COMMENT ON FUNCTION plataforma.empresa_modulos(uuid, jsonb, text) IS
  'Portal /config (0033): liga, desliga ou reativa licenças ([{modulo, ativo, valido_ate}]) da empresa ativa ou suspensa; o core nunca desliga; a dependência entre módulos é da API. Audita antes e depois. Só macuxierp_config. T-0050.';

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
  INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil)
  VALUES (v_usuario, t.id, lower(btrim(p_email)), btrim(p_nome), p_senha_hash, 'administrador');
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.admin.criar', 'usuario', v_usuario, NULL,
    jsonb_build_object('perfil', 'administrador', 'ativo', true), p_request_id);
  RETURN v_usuario;
END $$;
COMMENT ON FUNCTION plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text) IS
  'Portal /config (0033): cria o 1º administrador da empresa (ativa ou suspensa) se ela não tem administrador ativo; audita sem e-mail, nome nem hash. Só macuxierp_config. T-0050.';

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
  UPDATE plataforma.usuario SET senha_hash = p_senha_hash, falhas_login = 0, bloqueado_ate = NULL
  WHERE id = v_usuario;
  UPDATE plataforma.sessao SET revogada_em = now()
  WHERE tenant_id = t.id AND usuario_id = v_usuario AND revogada_em IS NULL;
  GET DIAGNOSTICS v_revogadas = ROW_COUNT;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.admin.redefinir_senha', 'usuario', v_usuario, NULL,
    jsonb_build_object('sessoes_revogadas', v_revogadas), p_request_id);
  RETURN v_usuario;
END $$;
COMMENT ON FUNCTION plataforma.empresa_primeiro_admin_senha(uuid, text, text) IS
  'Portal /config (0033): redefine a senha do 1º administrador (zera falhas e trava, revoga as sessões dele) e audita sem hash. Só macuxierp_config. T-0050.';

-- ---------------------------------------------------------------------------------------------------------------
-- Idempotency-Key das rotas /v1/plataforma/* (RN-CORE-05; ADR 0012 §4 e §5, decisão do engenheiro-software na T-0050).
-- Sempre no tenant de referência (nunca o do chamador); só rota `<MÉTODO> /v1/plataforma/...`, como a chave de
-- packages/platform-sdk/src/idempotencia.ts (ChaveIdempotencia.rota). Molde do IdempotenciaPg do platform-sdk.
-- Nenhuma política nem GRANT novo em plataforma.idempotencia: as funções são donas.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.exigir_rota_plataforma(p_rota text) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_rota IS NULL OR p_rota !~ '^(POST|PUT|PATCH|DELETE) /v1/plataforma/' THEN
    RAISE EXCEPTION 'rota fora de <MÉTODO> /v1/plataforma/' USING ERRCODE = 'check_violation';
  END IF;
END $$;
COMMENT ON FUNCTION plataforma.exigir_rota_plataforma(text) IS
  'Interna (0033): a checagem única da rota da Idempotency-Key do portal, `(POST|PUT|PATCH|DELETE) /v1/plataforma/...`; senão check_violation. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.idem_plataforma_reservar(p_chave text, p_rota text,
  p_hash_corpo plataforma.sha256_hex) RETURNS TABLE (situacao text, status integer, resposta jsonb)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_ref uuid := plataforma.tenant_referencia();
  v_nova uuid;
  r record;
BEGIN
  PERFORM plataforma.exigir_superadmin();
  PERFORM plataforma.exigir_rota_plataforma(p_rota);
  DELETE FROM plataforma.idempotencia i
  WHERE i.tenant_id = v_ref AND i.chave = p_chave AND i.rota = p_rota AND i.expira_em <= now();
  INSERT INTO plataforma.idempotencia (tenant_id, chave, rota, hash_corpo, expira_em)
  VALUES (v_ref, p_chave, p_rota, p_hash_corpo, now() + interval '24 hours')
  ON CONFLICT (tenant_id, chave, rota) DO NOTHING
  RETURNING id INTO v_nova;
  IF v_nova IS NOT NULL THEN
    RETURN QUERY SELECT 'nova'::text, NULL::integer, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.hash_corpo, i.status, i.resposta INTO r
  FROM plataforma.idempotencia i
  WHERE i.tenant_id = v_ref AND i.chave = p_chave AND i.rota = p_rota;
  IF NOT FOUND THEN
    -- A concorrente sumiu entre o INSERT e a leitura: a API responde como em andamento (tente de novo).
    RETURN QUERY SELECT 'em_andamento'::text, NULL::integer, NULL::jsonb;
  ELSIF r.hash_corpo <> p_hash_corpo THEN
    RETURN QUERY SELECT 'conflito'::text, NULL::integer, NULL::jsonb;
  ELSIF r.status IS NOT NULL THEN
    RETURN QUERY SELECT 'concluida'::text, r.status, r.resposta;
  ELSE
    RETURN QUERY SELECT 'em_andamento'::text, NULL::integer, NULL::jsonb;
  END IF;
END $$;
COMMENT ON FUNCTION plataforma.idem_plataforma_reservar(text, text, plataforma.sha256_hex) IS
  'Portal /config (0033): reserva a Idempotency-Key de /v1/plataforma/* no tenant de referência (24 h); devolve nova, em_andamento, concluida (status e resposta) ou conflito. Exige sessão. Só macuxierp_config. T-0050.';

CREATE OR REPLACE FUNCTION plataforma.idem_plataforma_concluir(p_chave text, p_rota text, p_status integer,
  p_resposta jsonb) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  PERFORM plataforma.exigir_superadmin();
  PERFORM plataforma.exigir_rota_plataforma(p_rota);
  UPDATE plataforma.idempotencia i SET status = p_status, resposta = p_resposta, updated_at = now()
  WHERE i.tenant_id = plataforma.tenant_referencia() AND i.chave = p_chave AND i.rota = p_rota AND i.status IS NULL;
END $$;
COMMENT ON FUNCTION plataforma.idem_plataforma_concluir(text, text, integer, jsonb) IS
  'Portal /config (0033): conclui a reserva ainda aberta de /v1/plataforma/* no tenant de referência; resposta NULL aceita (senha provisória grava só o status, ADR 0012 §5). Exige sessão. Só macuxierp_config. T-0050.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios das funções: nada para PUBLIC; as internas sem EXECUTE; as do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION plataforma.instante_iso(timestamptz),
  plataforma.sessao_superadmin_valida(uuid, text, boolean), plataforma.exigir_superadmin(boolean),
  plataforma.auditar_superadmin(uuid, uuid, text, text, uuid, jsonb, jsonb, text), plataforma.licencas_json(uuid),
  plataforma.primeiro_admin(uuid), plataforma.empresa_json(uuid), plataforma.empresa_visivel(plataforma.tenant),
  plataforma.empresa_alvo(uuid, boolean), plataforma.exigir_rota_plataforma(text),
  plataforma.superadmin_para_login(text), plataforma.superadmin_registrar_falha(uuid, integer, timestamptz),
  plataforma.superadmin_abrir_sessao(uuid, plataforma.sha256_hex, timestamptz),
  plataforma.superadmin_sessao_por_token(plataforma.sha256_hex), plataforma.superadmin_sair(uuid),
  plataforma.superadmin_senha_atual(), plataforma.superadmin_trocar_senha(text, text),
  plataforma.empresas_listar(text, uuid, integer), plataforma.empresa_ler(uuid),
  plataforma.empresa_criar(text, text, text, text), plataforma.empresa_situacao(uuid, text, text, text),
  plataforma.empresa_modulos(uuid, jsonb, text), plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text),
  plataforma.empresa_primeiro_admin_senha(uuid, text, text),
  plataforma.idem_plataforma_reservar(text, text, plataforma.sha256_hex),
  plataforma.idem_plataforma_concluir(text, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  plataforma.superadmin_para_login(text), plataforma.superadmin_registrar_falha(uuid, integer, timestamptz),
  plataforma.superadmin_abrir_sessao(uuid, plataforma.sha256_hex, timestamptz),
  plataforma.superadmin_sessao_por_token(plataforma.sha256_hex), plataforma.superadmin_sair(uuid),
  plataforma.superadmin_senha_atual(), plataforma.superadmin_trocar_senha(text, text),
  plataforma.empresas_listar(text, uuid, integer), plataforma.empresa_ler(uuid),
  plataforma.empresa_criar(text, text, text, text), plataforma.empresa_situacao(uuid, text, text, text),
  plataforma.empresa_modulos(uuid, jsonb, text), plataforma.empresa_primeiro_admin_criar(uuid, text, text, text, text),
  plataforma.empresa_primeiro_admin_senha(uuid, text, text),
  plataforma.idem_plataforma_reservar(text, text, plataforma.sha256_hex),
  plataforma.idem_plataforma_concluir(text, text, integer, jsonb)
  TO macuxierp_config;
