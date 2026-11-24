-- 0050 — Temporária cancelada no login certo e ajustes acumulados (T-0083, v0.3.11; RN-CORE-10, RN-CORE-13).
-- Aditiva e reexecutável: CREATE OR REPLACE (mesmas assinaturas), DROP IF EXISTS + CREATE (superadmin_para_login, o
-- tipo de retorno muda), COMMENT ON e REVOKE/GRANT.
--
-- O que entra:
-- (a) plataforma.superadmin_cancelar_temporaria(p_id uuid) RETURNS boolean (nova): o primeiro login certo com a senha
--     atual cancela a temporária pendente (decisão do PO, T-0083 item 1). Um UPDATE só (molde da
--     superadmin_consumir_temporaria da 0048): zera senha_temporaria_hash e senha_temporaria_expira_em quando há
--     temporária, vencida ou não; NÃO mexe em deve_trocar_senha (a senha atual não é provisória). true se cancelou;
--     audita plataforma.superadmin.senha_temporaria_cancelada (sem e-mail nem hash) só nesse caso;
-- (b) plataforma.superadmin_emitir_temporaria (mesma assinatura): passa a recusar o superadmin inativo (P0002, a mesma
--     recusa do inexistente ou excluído, com DETAIL superadmin_inativo; o inexistente ganha DETAIL
--     superadmin_inexistente) e a validade acima de now() + 73 h (23514, DETAIL validade_acima_do_teto; a API manda
--     72 h, e a hora a mais cobre a diferença de relógio entre a API e o banco). A mensagem das recusas antigas não muda;
-- (c) COMMENT ON da core.ambiente_fiscal_a1_real (0047): o limite da trava consultiva em REPEATABLE READ e
--     SERIALIZABLE (o corpo não muda);
-- (d) plataforma.superadmin_para_login (mesma assinatura de entrada): passa a devolver também o email, como está em
--     plataforma.superadmin (já normalizado pelo CHECK da 0033), no fim do retorno da 0048; a API lê dele o destino do
--     e-mail da temporária. O tipo de retorno muda: DROP + CREATE, com o REVOKE/GRANT refeito (molde da 0048).
--     Chamadores: apps/api/src/plataforma/servico.ts (lista as colunas pelo nome; segue funcionando sem o email) e os
--     testes com SELECT * (seguem funcionando).
--
-- A 0047, a 0048 e a 0049 não são editadas (o migrar recusa sha256 diferente).

-- (a) Cancelar a temporária. ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.superadmin_cancelar_temporaria(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid;
BEGIN
  -- Um UPDATE só (sem SELECT FOR UPDATE): duas conexões ao mesmo tempo, só uma acha a temporária; a outra espera a
  -- trava da linha, reavalia o WHERE e não acha nada (nem audita).
  UPDATE plataforma.superadmin
  SET senha_temporaria_hash = NULL, senha_temporaria_expira_em = NULL
  WHERE id = p_id AND senha_temporaria_hash IS NOT NULL
  RETURNING id INTO v_sa;
  IF v_sa IS NULL THEN
    RETURN false;
  END IF;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), v_sa,
    'plataforma.superadmin.senha_temporaria_cancelada', 'superadmin', v_sa, NULL, NULL, NULL);
  RETURN true;
END $$;
COMMENT ON FUNCTION plataforma.superadmin_cancelar_temporaria(uuid) IS
  'Portal /config (0050): o login certo com a senha atual cancela a senha temporária pendente (vencida ou não; UPDATE atômico): zera as duas colunas, sem tocar em deve_trocar_senha, e audita plataforma.superadmin.senha_temporaria_cancelada sem e-mail nem hash; true se cancelou, false se não havia. A API confere o argon2 da senha atual antes. Sem sessão. Só macuxierp_config. RN-CORE-13, T-0083.';

-- (b) Emitir: recusa o inativo e a validade acima do teto. ---------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.superadmin_emitir_temporaria(p_id uuid, p_hash text, p_expira_em timestamptz)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_expira_em IS NULL OR p_expira_em <= now() THEN
    RAISE EXCEPTION 'validade da senha temporária precisa ser futura' USING ERRCODE = 'check_violation';
  END IF;
  IF p_expira_em > now() + interval '73 hours' THEN
    RAISE EXCEPTION 'validade da senha temporária passa de 73 horas' USING ERRCODE = 'check_violation',
      DETAIL = 'validade_acima_do_teto';
  END IF;
  UPDATE plataforma.superadmin SET senha_temporaria_hash = p_hash, senha_temporaria_expira_em = p_expira_em
  WHERE id = p_id AND ativo AND deleted_at IS NULL;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM plataforma.superadmin s WHERE s.id = p_id AND s.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'superadmin não encontrado' USING ERRCODE = 'no_data_found', DETAIL = 'superadmin_inativo';
    END IF;
    RAISE EXCEPTION 'superadmin não encontrado' USING ERRCODE = 'no_data_found', DETAIL = 'superadmin_inexistente';
  END IF;
  PERFORM plataforma.auditar_superadmin(plataforma.tenant_referencia(), p_id, 'plataforma.superadmin.senha_esquecida',
    'superadmin', p_id, NULL, jsonb_build_object('expira_em', plataforma.instante_iso(p_expira_em)), NULL);
END $$;
COMMENT ON FUNCTION plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz) IS
  'Portal /config (0048; 0050 recusa o inativo e o teto): "esqueci a senha" — grava a senha temporária (hash argon2id e validade vinda da API: futura, senão 23514, e até now() + 73 h, senão 23514 DETAIL validade_acima_do_teto) do superadmin ativo e não excluído (senão P0002, DETAIL superadmin_inativo ou superadmin_inexistente), sem tocar em senha_hash (vale em paralelo); reemitir substitui. Audita plataforma.superadmin.senha_esquecida sem e-mail nem hash. Sem sessão. Só macuxierp_config. T-0076, T-0083.';

-- Privilégios: nada para PUBLIC; EXECUTE só do macuxierp_config (a nova nasce com EXECUTE para PUBLIC; o CREATE OR
-- REPLACE da emitir mantém os da 0048, reafirmados aqui).
REVOKE ALL ON FUNCTION plataforma.superadmin_cancelar_temporaria(uuid),
  plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.superadmin_cancelar_temporaria(uuid),
  plataforma.superadmin_emitir_temporaria(uuid, text, timestamptz) TO macuxierp_config;

-- (c) O limite da trava da 0047, no COMMENT (pedido do engenheiro). -----------------------------------------------
COMMENT ON FUNCTION core.ambiente_fiscal_a1_real() IS
  'T-0080 (0047; RN-CORE-08, ADR 0006; COMMENT da 0050): gatilho de core.ambiente_fiscal (ambiente_fiscal_a1_real) e de '
  'core.certificado (certificado_a1_real). A filial do tenant não fica em producao (sem deleted_at) com A1 vigente '
  '(ativo, sem deleted_at) de origem teste: a ida para produção é recusada com MXA01, DETAIL a1_de_teste; o A1 de teste '
  'que fica vigente numa filial em produção, com MXA01, DETAIL a1_de_teste_em_producao. Vale para todos os papéis e '
  'para o dono. SECURITY DEFINER só para ler a outra tabela pelo tenant e filial da linha, sem depender da RLS e dos '
  'grants de quem grava; não devolve nada do certificado. Concorrência: a trava consultiva por tenant e filial '
  '(pg_advisory_xact_lock) serializa as duas gravações, e a garantia vale em READ COMMITTED (o padrão da API), em que o '
  'EXISTS depois da trava lê um retrato novo e enxerga a outra gravação já confirmada. Em REPEATABLE READ ou '
  'SERIALIZABLE o retrato da transação é tirado antes da trava (no primeiro comando), então a segunda gravação não vê '
  'a primeira: nesses níveis a trava não garante a regra (em SERIALIZABLE, fica só a detecção de conflito do Postgres).';

-- (d) Login devolve o email. ----------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS plataforma.superadmin_para_login(text);
CREATE FUNCTION plataforma.superadmin_para_login(p_email text)
  RETURNS TABLE (id uuid, senha_hash text, nome text, ativo boolean, falhas_login integer, bloqueado_ate timestamptz,
    deve_trocar_senha boolean, senha_temporaria_hash text, senha_temporaria_expira_em timestamptz, email text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT s.id, s.senha_hash, s.nome, s.ativo, s.falhas_login, s.bloqueado_ate, s.deve_trocar_senha,
    s.senha_temporaria_hash, s.senha_temporaria_expira_em, s.email
  FROM plataforma.superadmin s
  WHERE s.email = lower(btrim(p_email)) AND s.deleted_at IS NULL
$$;
COMMENT ON FUNCTION plataforma.superadmin_para_login(text) IS
  'Portal /config (0033; 0048 devolve a senha temporária; 0050 devolve o email gravado, destino do e-mail da temporária): o superadmin não excluído do e-mail (normalizado), para a API conferir o argon2 (da senha ou da temporária, se não vencida) e a trava. Sem sessão. Só macuxierp_config. ADR 0012 §4. T-0050, T-0076, T-0083.';

-- Privilégios: o DROP + CREATE apagou os da 0048; nada para PUBLIC, EXECUTE só do macuxierp_config.
REVOKE ALL ON FUNCTION plataforma.superadmin_para_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.superadmin_para_login(text) TO macuxierp_config;
