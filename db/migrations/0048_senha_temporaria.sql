-- 0048 — "Esqueci a senha" com senha temporária (T-0076; RN-CORE-10; ADR 0012 §4). Aditiva e reexecutável:
-- ADD COLUMN IF NOT EXISTS, DROP/ADD CONSTRAINT, CREATE OR REPLACE e DROP FUNCTION IF EXISTS + CREATE.
--
-- Decisões fechadas (gerente-projetos, modulo-core e engenheiro-software, T-0076):
-- - plataforma.usuario (0002) e plataforma.superadmin (0033) ganham senha_temporaria_hash (argon2id, mesmo formato de
--   senha_hash) e senha_temporaria_expira_em, com o CHECK nomeado <tabela>_senha_temporaria_par ("as duas nulas ou as
--   duas preenchidas") e o <tabela>_senha_temporaria_formato ($argon2id$...);
-- - a temporária vale EM PARALELO à senha atual (senha_hash não muda), é de uso único, e a validade (72 h) vem da API
--   por parâmetro: o banco só recusa a validade que já passou;
-- - usuário da empresa: a API grava e consome por UPDATE direto do macuxierp_app no próprio tenant, sob a RLS da 0002.
--   O GRANT SELECT, INSERT, UPDATE da 0002 é de tabela e cobre as colunas novas; worker e leitura têm SELECT por coluna
--   (0002, 0036) e NÃO ganham as novas (é hash de senha);
-- - superadmin: só pelas funções SECURITY DEFINER do macuxierp_config (lista fechada da ADR 0012 §4, molde da 0033):
--   superadmin_emitir_temporaria e superadmin_consumir_temporaria (novas); superadmin_para_login passa a devolver as
--   duas colunas (o tipo de retorno muda: DROP + CREATE, e o REVOKE/GRANT é refeito); superadmin_trocar_senha passa a
--   zerar as duas colunas (mesma assinatura: CREATE OR REPLACE);
-- - plataforma.auditoria.acao é texto livre (0002, sem CHECK, domain nem tabela de ações): as ações novas
--   (plataforma.superadmin.senha_esquecida e plataforma.superadmin.senha_temporaria_usada aqui; core.usuario.* pela API)
--   não pedem mudança no banco;
-- - o limite de tentativas do "esqueci a senha" fica em memória na API (fora do banco).
--
-- Premissas (banco-dados):
-- - superadmin_emitir_temporaria só alcança o superadmin não excluído (senão no_data_found); a API não revela à tela se o
--   e-mail existe. Reemitir substitui a temporária anterior;
-- - superadmin_consumir_temporaria também exige ativo e não excluído (defesa em profundidade; a API já confere pelo
--   superadmin_para_login) e não mexe na temporária vencida (fica até a próxima emissão ou troca de senha);
-- - a auditoria das duas funções não leva e-mail, nome nem hash; a da emissão leva só a validade.

-- ---------------------------------------------------------------------------------------------------------------
-- Colunas e CHECKs (as duas tabelas, mesma forma).
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE plataforma.usuario
  ADD COLUMN IF NOT EXISTS senha_temporaria_hash text,
  ADD COLUMN IF NOT EXISTS senha_temporaria_expira_em timestamptz;
ALTER TABLE plataforma.usuario DROP CONSTRAINT IF EXISTS usuario_senha_temporaria_par,
  ADD CONSTRAINT usuario_senha_temporaria_par
    CHECK ((senha_temporaria_hash IS NULL) = (senha_temporaria_expira_em IS NULL));
ALTER TABLE plataforma.usuario DROP CONSTRAINT IF EXISTS usuario_senha_temporaria_formato,
  ADD CONSTRAINT usuario_senha_temporaria_formato CHECK (senha_temporaria_hash LIKE '$argon2id$%');
COMMENT ON COLUMN plataforma.usuario.senha_temporaria_hash IS
  'Hash argon2id da senha temporária do "esqueci a senha" (mesmo formato de senha_hash); vale em paralelo à senha atual, uso único; NULL = sem temporária. A API (modulo-core) grava e consome por UPDATE no próprio tenant. Fora do SELECT do worker e da leitura. T-0076 (0048).';
COMMENT ON COLUMN plataforma.usuario.senha_temporaria_expira_em IS
  'Validade da senha temporária (a API manda, 72 h na T-0076); NULL junto com senha_temporaria_hash (usuario_senha_temporaria_par). T-0076 (0048).';
COMMENT ON CONSTRAINT usuario_senha_temporaria_par ON plataforma.usuario IS
  'As duas colunas da senha temporária nulas ou as duas preenchidas. T-0076 (0048).';

ALTER TABLE plataforma.superadmin
  ADD COLUMN IF NOT EXISTS senha_temporaria_hash text,
  ADD COLUMN IF NOT EXISTS senha_temporaria_expira_em timestamptz;
ALTER TABLE plataforma.superadmin DROP CONSTRAINT IF EXISTS superadmin_senha_temporaria_par,
  ADD CONSTRAINT superadmin_senha_temporaria_par
    CHECK ((senha_temporaria_hash IS NULL) = (senha_temporaria_expira_em IS NULL));
ALTER TABLE plataforma.superadmin DROP CONSTRAINT IF EXISTS superadmin_senha_temporaria_formato,
  ADD CONSTRAINT superadmin_senha_temporaria_formato CHECK (senha_temporaria_hash LIKE '$argon2id$%');
COMMENT ON COLUMN plataforma.superadmin.senha_temporaria_hash IS
  'Hash argon2id da senha temporária do "esqueci a senha" do portal /config; vale em paralelo à senha atual, uso único; NULL = sem temporária. Só as funções da 0033/0048 leem e gravam. T-0076 (0048).';
COMMENT ON COLUMN plataforma.superadmin.senha_temporaria_expira_em IS
  'Validade da senha temporária (parâmetro de superadmin_emitir_temporaria); NULL junto com senha_temporaria_hash (superadmin_senha_temporaria_par). T-0076 (0048).';
COMMENT ON CONSTRAINT superadmin_senha_temporaria_par ON plataforma.superadmin IS
  'As duas colunas da senha temporária nulas ou as duas preenchidas. T-0076 (0048).';

-- ---------------------------------------------------------------------------------------------------------------
-- Funções do portal (EXECUTE só do macuxierp_config; as três primeiras rodam sem sessão, como o login).
-- ---------------------------------------------------------------------------------------------------------------

-- O tipo de retorno muda (duas colunas a mais): DROP + CREATE. Chamador na API: apps/api/src/plataforma/servico.ts
-- (lista as colunas pelo nome, segue funcionando).
DROP FUNCTION IF EXISTS plataforma.superadmin_para_login(text);
CREATE FUNCTION plataforma.superadmin_para_login(p_email text)
  RETURNS TABLE (id uuid, senha_hash text, nome text, ativo boolean, falhas_login integer, bloqueado_ate timestamptz,
    deve_trocar_senha boolean, senha_temporaria_hash text, senha_temporaria_expira_em timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT s.id, s.senha_hash, s.nome, s.ativo, s.falhas_login, s.bloqueado_ate, s.deve_trocar_senha,
    s.senha_temporaria_hash, s.senha_temporaria_expira_em
  FROM plataforma.superadmin s
  WHERE s.email = lower(btrim(p_email)) AND s.deleted_at IS NULL
$$;
COMMENT ON FUNCTION plataforma.superadmin_para_login(text) IS
  'Portal /config (0033; 0048 devolve a senha temporária): o superadmin não excluído do e-mail (normalizado), para a API conferir o argon2 (da senha ou da temporária, se não vencida) e a trava. Sem sessão. Só macuxierp_config. ADR 0012 §4. T-0050, T-0076.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_emitir_temporaria(p_id uuid, p_hash text, p_expira_em timestamptz)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_expira_em IS NULL OR p_expira_em <= now() THEN
    RAISE EXCEPTION 'validade da senha temporária precisa ser futura' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE plataforma.superadmin SET senha_temporaria_hash = p_hash, senha_temporaria_expira_em = p_expira_em
  WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'superadmin não encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), p_id, 'plataforma.superadmin.senha_esquecida',
    'superadmin', p_id, NULL, jsonb_build_object('expira_em', plataforma.instante_iso(p_expira_em)), NULL);
END $$;
COMMENT ON FUNCTION plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz) IS
  'Portal /config (0048): "esqueci a senha" — grava a senha temporária (hash argon2id e validade vinda da API, que precisa ser futura) do superadmin não excluído, sem tocar em senha_hash (vale em paralelo); reemitir substitui. Audita plataforma.superadmin.senha_esquecida sem e-mail nem hash. Sem sessão. Só macuxierp_config. T-0076.';

CREATE OR REPLACE FUNCTION plataforma.superadmin_consumir_temporaria(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid;
BEGIN
  -- Um UPDATE só (sem SELECT FOR UPDATE): duas conexões ao mesmo tempo, só uma acha a temporária; a outra espera a
  -- trava da linha, reavalia o WHERE e não acha nada.
  UPDATE plataforma.superadmin
  SET senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL, deve_trocar_senha = true
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
  'Portal /config (0048): consome a senha temporária não vencida (uso único, UPDATE atômico): zera as duas colunas, liga deve_trocar_senha e audita plataforma.superadmin.senha_temporaria_usada; true se consumiu, false se não havia, venceu, já foi usada ou o superadmin está inativo. A API confere o argon2 antes. Sem sessão. Só macuxierp_config. T-0076.';

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
    bloqueado_ate = NULL, senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL
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
  'Portal /config (0033; 0048 zera a senha temporária): troca a senha (só se o hash atual ainda é o conferido), tira a troca pendente, zera a trava e a temporária, revoga as outras sessões e audita. Só macuxierp_config. ADR 0012 §4. T-0050, T-0076.';

-- Privilégios: nada para PUBLIC; EXECUTE só do macuxierp_config (o DROP + CREATE de superadmin_para_login apagou os
-- da 0033; o CREATE OR REPLACE de superadmin_trocar_senha os mantém, e aqui eles são reafirmados).
REVOKE ALL ON FUNCTION plataforma.superadmin_para_login(text),
  plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz), plataforma.superadmin_consumir_temporaria(uuid),
  plataforma.superadmin_trocar_senha(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.superadmin_para_login(text),
  plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz), plataforma.superadmin_consumir_temporaria(uuid),
  plataforma.superadmin_trocar_senha(text, text) TO macuxierp_config;
