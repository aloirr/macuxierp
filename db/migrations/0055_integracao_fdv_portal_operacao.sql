-- 0055 — Operação da Integração FDV no portal /config (T-0086, v0.3.12; desenho docs/desenho/T-0086.md §2 a §4; ADR 0013;
-- pedido R-20261124-181938-gerente-projetos). Aditiva e reexecutável: só CREATE OR REPLACE, REVOKE, GRANT e COMMENT. A
-- migração não muda nenhuma linha de dado, tabela, política de RLS nem grant de tabela: só cria funções e privilégios.
--
-- O que entra (schema integracao_fdv, SECURITY DEFINER, search_path fixo, EXECUTE só do macuxierp_config, no molde das
-- portal_* da 0038): o superadmin não lê tabela do módulo, só estas funções, que fazem a MESMA consulta e a MESMA escrita de
-- modules/integracao-fdv/api/operacao.ts (lerInsumosMonitor, lerInsumosLog e reprocessarCadastro) e devolvem o jsonb que o
-- repositorioPortalSql de modules/integracao-fdv/api/plataforma.ts valida (InsumosMonitorPortal, InsumosLogPortal e
-- ResultadoReprocessarPortal):
-- - portal_monitor(uuid): credencial ativa (sem a chave), quantos cadastros habilitados, último sinal aceito e a fila (lotes
--   em voo e registros pendentes, somados como o CorpoSinal.fila). Só leitura, sem trava nem auditoria;
-- - portal_log(uuid, text): os 20 envios mais recentes do cadastro e os erros por linha abertos JÁ AGRUPADOS por (código,
--   campo), com a quantidade de registros, o total e a pausa do cursor. Nunca registro_external_id, nome, documento, payload
--   nem fonte_refs (ADR 0013). Só leitura, sem trava nem auditoria;
-- - portal_reprocessar(uuid, text, text): marca para o próximo ciclo delta só os registros em falha (erro aberto) ou pendentes
--   (pendente, ou hash_confirmado diferente do hash), a regra do planejarReprocessar do domain (RN-INF-03): pendente = true e
--   fonte_refs || {"reenvio": "reprocessar"} (MARCA_REENVIO.reprocessar, que o lote lê para a origem). Nunca o integrado, sem
--   carga completa (o cursor não volta) e sem inativação nova (o payload, o hash e o ativo não mudam). Lote em voo no cadastro
--   = MXI03 com DETAIL lote_em_voo (a API traduz em 409). Idempotente por request_id: a repetição com o mesmo request_id e o
--   mesmo cadastro devolve o resultado gravado na auditoria, sem efeito novo. Audita integracao-fdv.entidade.reprocessar.
--
-- Regras copiadas da 0038: a empresa entra com FOR KEY SHARE (portal_empresa); a leitura vale para qualquer empresa visível e
-- a escrita exige 'ativo' e o módulo licenciado (MXI04); cadastro fora da F2 = check_violation; credencial ausente na escrita =
-- MXI01; ordem dos bloqueios credencial -> cursor_entidade -> registro_publicado (a credencial só é lida, sem trava).
--
-- Premissas (banco-dados, T-0086):
-- - a origem do envio fora de ciclo|reprocessar|zerar (contagens.origem desconhecida) sai como 'ciclo' (o Zod do plugin só
--   aceita as três do SDK);
-- - os grupos do Log vêm ordenados por quantidade (maior primeiro), código e campo, no máximo LIMITE_ERROS_LOG_FDV (200);
--   total_erros conta todos os (registro, código, campo) abertos, como o lerInsumosLog;
-- - a quantidade do grupo é o número de registros distintos com aquele (código, campo) aberto (o DISTINCT ON do lerInsumosLog);
-- - a repetição do reprocessar com o mesmo request_id vale mesmo depois de o lote do ciclo entrar em voo (devolve o resultado
--   original; não dá 409), porque a conferência da idempotência vem antes da do lote em voo.

-- ---------------------------------------------------------------------------------------------------------------
-- Funções do portal (EXECUTE só do macuxierp_config).
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION integracao_fdv.portal_monitor(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_c integracao_fdv.credencial := integracao_fdv.portal_credencial_ativa(v_t, false, false);
BEGIN
  RETURN jsonb_build_object(
    'credencial_ativa', v_c.id IS NOT NULL,
    'conector_id', v_c.conector_id,
    'habilitadas', coalesce(cardinality(v_c.entidades_habilitadas), 0),
    'ultimo_sinal_aceito_em', (
      SELECT plataforma.instante_iso(s.ultimo_aceito_em) FROM integracao_fdv.sinal s
       WHERE s.tenant_id = v_t AND s.deleted_at IS NULL),
    'fila', jsonb_build_object(
      'lotes', (SELECT count(*)::integer FROM integracao_fdv.lote_envio l
                 WHERE l.tenant_id = v_t AND l.estado IN ('montado', 'enviando', 'aceito') AND l.deleted_at IS NULL),
      'linhas', (SELECT count(*)::integer FROM integracao_fdv.registro_publicado r
                  WHERE r.tenant_id = v_t AND r.pendente AND r.deleted_at IS NULL)));
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_monitor(uuid) IS
  'Portal /config (0055): os insumos do Monitor do conector da empresa visível (o lerInsumosMonitor de modules/integracao-fdv/api/operacao.ts): {credencial_ativa, conector_id, habilitadas, ultimo_sinal_aceito_em (ISO UTC), fila {lotes em voo, linhas pendentes}}. Sem a chave nem dado de negócio; sem trava nem auditoria. Só macuxierp_config. ADR 0013. T-0086.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_log(p_tenant uuid, p_entidade text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_e integracao_fdv.entidade_hub;
BEGIN
  IF p_entidade IS NULL OR NOT (p_entidade = ANY (integracao_fdv.portal_entidades_f2())) THEN
    RAISE EXCEPTION 'cadastro fora da F2' USING ERRCODE = 'check_violation';
  END IF;
  v_e := p_entidade::integracao_fdv.entidade_hub;
  RETURN jsonb_build_object(
    'envios', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('em', plataforma.instante_iso(x.em), 'estado', x.estado,
               'registros', x.registros, 'com_erro', x.com_erro, 'origem', x.origem) ORDER BY x.created_at DESC, x.id DESC),
             '[]'::jsonb)
        FROM (SELECT l.id, l.created_at, coalesce(l.enviado_em, l.created_at) AS em, l.estado,
                     greatest(coalesce((l.contagens ->> 'registros')::integer, 0)
                              + coalesce((l.contagens ->> 'invalidas')::integer, 0), 0) AS registros,
                     (SELECT count(*)::integer FROM integracao_fdv.lote_erro e
                       WHERE e.tenant_id = l.tenant_id AND e.lote_envio_id = l.id AND e.deleted_at IS NULL) AS com_erro,
                     CASE WHEN l.contagens ->> 'origem' IN ('ciclo', 'reprocessar', 'zerar') THEN l.contagens ->> 'origem'
                          ELSE 'ciclo' END AS origem
                FROM integracao_fdv.lote_envio l
               WHERE l.tenant_id = v_t AND l.entidade = v_e AND l.deleted_at IS NULL
               ORDER BY l.created_at DESC, l.id DESC LIMIT 20) x),
    'erros', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', g.codigo, 'campo', g.campo, 'quantidade', g.quantidade)
               ORDER BY g.quantidade DESC, g.codigo, g.campo NULLS FIRST), '[]'::jsonb)
        FROM (SELECT a.codigo, a.campo, count(*)::integer AS quantidade
                FROM (SELECT DISTINCT e.registro_external_id, e.codigo::text AS codigo, e.campo
                        FROM integracao_fdv.lote_erro e
                       WHERE e.tenant_id = v_t AND e.entidade = v_e AND e.resolvido_em IS NULL AND e.deleted_at IS NULL
                         AND e.registro_external_id IS NOT NULL) a
               GROUP BY a.codigo, a.campo
               ORDER BY count(*) DESC, a.codigo, a.campo NULLS FIRST LIMIT 200) g),
    'total_erros', (
      SELECT count(*)::integer FROM (SELECT DISTINCT e.registro_external_id, e.codigo, e.campo
                                        FROM integracao_fdv.lote_erro e
                                       WHERE e.tenant_id = v_t AND e.entidade = v_e AND e.resolvido_em IS NULL
                                         AND e.deleted_at IS NULL AND e.registro_external_id IS NOT NULL) y),
    'pausada_motivo', (
      SELECT k.pausada_motivo FROM integracao_fdv.cursor_entidade k
       WHERE k.tenant_id = v_t AND k.entidade = v_e AND k.deleted_at IS NULL));
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_log(uuid, text) IS
  'Portal /config (0055): o Log de um cadastro da F2 (fora = check_violation) da empresa visível, como o lerInsumosLog de modules/integracao-fdv/api/operacao.ts mas só com códigos, campos e contagens: {envios (20 mais recentes: em ISO UTC, estado, registros, com_erro, origem ciclo|reprocessar|zerar), erros [{codigo, campo, quantidade de registros}] agrupados (até 200), total_erros, pausada_motivo}. Nunca registro_external_id, nome, documento, payload nem fonte_refs; sem trava nem auditoria. Só macuxierp_config. ADR 0013. T-0086.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_reprocessar(p_tenant uuid, p_entidade text, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, true);
  v_c integracao_fdv.credencial;
  v_e integracao_fdv.entidade_hub;
  v_cursor uuid;
  v_anterior jsonb;
  v_ids uuid[];
  v_falhas integer;
  v_pendentes integer;
  v_r jsonb;
BEGIN
  v_c := integracao_fdv.portal_credencial_ativa(v_t, false, true);
  IF p_entidade IS NULL OR NOT (p_entidade = ANY (integracao_fdv.portal_entidades_f2())) THEN
    RAISE EXCEPTION 'cadastro fora da F2' USING ERRCODE = 'check_violation';
  END IF;
  v_e := p_entidade::integracao_fdv.entidade_hub;
  -- a trava do cursor serializa com o montarLoteNoBanco e com outro reprocessar do mesmo cadastro (sem cursor: sem trava)
  SELECT k.id INTO v_cursor FROM integracao_fdv.cursor_entidade k
   WHERE k.tenant_id = v_t AND k.entidade = v_e AND k.deleted_at IS NULL
   FOR UPDATE;
  -- idempotência por request_id (antes do lote em voo: a repetição devolve o resultado original, sem efeito novo)
  IF p_request_id IS NOT NULL THEN
    SELECT a.depois INTO v_anterior FROM plataforma.auditoria a
     WHERE a.tenant_id = v_t AND a.entidade = 'cursor_entidade' AND a.acao = 'integracao-fdv.entidade.reprocessar'
       AND a.request_id = p_request_id AND a.depois ->> 'entidade' = p_entidade
     ORDER BY a.ocorrido_em, a.id LIMIT 1;
    IF v_anterior IS NOT NULL THEN
      RETURN jsonb_build_object('falhas', v_anterior -> 'falhas', 'pendentes', v_anterior -> 'pendentes',
        'pedido_em', v_anterior -> 'pedido_em');
    END IF;
  END IF;
  IF integracao_fdv.portal_lote_em_voo(v_t, v_e) THEN
    RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'lote_em_voo';
  END IF;
  -- RN-INF-03 (situacaoRegistro / planejarReprocessar do domain): falha = erro aberto; pendente = pendente ou hash não
  -- confirmado; o resto é integrado e não entra. Só registros com payload (o anulado já foi inativado e confirmado).
  -- O WHERE já tira o integrado (que nem é travado); a contagem separa falha de pendente como o domain.
  WITH alvo AS (
    SELECT r.id,
           EXISTS (SELECT 1 FROM integracao_fdv.lote_erro e
                    WHERE e.tenant_id = r.tenant_id AND e.entidade = r.entidade
                      AND e.registro_external_id = r.registro_external_id
                      AND e.resolvido_em IS NULL AND e.deleted_at IS NULL) AS erro_aberto
      FROM integracao_fdv.registro_publicado r
     WHERE r.tenant_id = v_t AND r.entidade = v_e AND r.deleted_at IS NULL AND r.payload IS NOT NULL
       AND (r.pendente OR r.hash_confirmado IS DISTINCT FROM r.hash
            OR EXISTS (SELECT 1 FROM integracao_fdv.lote_erro e
                        WHERE e.tenant_id = r.tenant_id AND e.entidade = r.entidade
                          AND e.registro_external_id = r.registro_external_id
                          AND e.resolvido_em IS NULL AND e.deleted_at IS NULL))
     ORDER BY r.id
       FOR UPDATE OF r)
  SELECT coalesce(array_agg(alvo.id ORDER BY alvo.id), '{}'),
         count(*) FILTER (WHERE alvo.erro_aberto)::integer,
         count(*) FILTER (WHERE NOT alvo.erro_aberto)::integer
    INTO v_ids, v_falhas, v_pendentes
    FROM alvo;
  IF cardinality(v_ids) > 0 THEN
    UPDATE integracao_fdv.registro_publicado SET pendente = true, fonte_refs = fonte_refs || '{"reenvio": "reprocessar"}'::jsonb
     WHERE tenant_id = v_t AND id = ANY (v_ids);
    IF v_cursor IS NOT NULL THEN
      UPDATE integracao_fdv.cursor_entidade SET proximo_em = least(proximo_em, now()) WHERE tenant_id = v_t AND id = v_cursor;
    END IF;
  END IF;
  v_r := jsonb_build_object('falhas', v_falhas, 'pendentes', v_pendentes, 'pedido_em', plataforma.instante_iso(now()));
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.entidade.reprocessar', 'cursor_entidade', v_cursor, NULL,
    v_r || jsonb_build_object('entidade', p_entidade), p_request_id);
  RETURN v_r;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_reprocessar(uuid, text, text) IS
  'Portal /config (0055): o efeito do POST /entidades/:e/reprocessar (MXI04 fora de ativo ou sem licença; MXI01 sem credencial; fora da F2 = check_violation): trava o cursor, devolve o resultado gravado quando o request_id já foi usado no cadastro (idempotente), senão recusa com lote em voo (MXI03, DETAIL lote_em_voo) e marca só falha e pendente (planejarReprocessar, RN-INF-03) com pendente = true e fonte_refs.reenvio = reprocessar, nunca o integrado, sem carga completa nem inativação nova; antecipa o cursor quando marcou algo, audita integracao-fdv.entidade.reprocessar e devolve {falhas, pendentes, pedido_em}. Só macuxierp_config. ADR 0013. T-0086.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; só macuxierp_config (o GRANT USAGE no schema é da 0038).
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION integracao_fdv.portal_monitor(uuid), integracao_fdv.portal_log(uuid, text),
  integracao_fdv.portal_reprocessar(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.portal_monitor(uuid), integracao_fdv.portal_log(uuid, text),
  integracao_fdv.portal_reprocessar(uuid, text, text) TO macuxierp_config;
