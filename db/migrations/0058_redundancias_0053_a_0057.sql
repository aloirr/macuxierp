-- 0058 — Redundâncias apontadas pelo corretor nas 0053 a 0057 (T-0086; RD-1560, 1561, 1563, 1565, 1566 e o 🟡 da 0056).
-- Mesmo comportamento: só CREATE OR REPLACE (o ACL e o COMMENT ON FUNCTION ficam), COMMENT e a troca de um CHECK por
-- outro equivalente. Reexecutável; não muda nenhuma linha de dado. O porquê: docs/banco/README.md, seção da 0058.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- RD-1563: o payload inativado calculado uma vez (LATERAL).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION integracao_fdv.portal_inativar_linhas(p_tenant uuid, p_ids uuid[]) RETURNS text[]
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_out text[];
BEGIN
  -- nunca foi ao Hub: não tem o que inativar lá (como o aplicarTrocaDeChave de api/espelho.ts; o lote em voo já barrou)
  UPDATE integracao_fdv.registro_publicado r SET deleted_at = now(), erp_id = NULL
   WHERE r.tenant_id = p_tenant AND r.id = ANY (p_ids) AND r.hash_confirmado IS NULL AND r.ultimo_lote_envio_id IS NULL;
  WITH n AS (
    SELECT r.id, x.payload, integracao_fdv.hash_registro(x.payload) AS hash
      FROM integracao_fdv.registro_publicado r
      CROSS JOIN LATERAL (SELECT r.payload || '{"ativo": false}'::jsonb AS payload) x
     WHERE r.tenant_id = p_tenant AND r.id = ANY (p_ids) AND r.deleted_at IS NULL),
  u AS (
    UPDATE integracao_fdv.registro_publicado r
       SET payload = n.payload, hash = n.hash, ativo = false, pendente = r.hash_confirmado IS DISTINCT FROM n.hash,
           fonte_refs = r.fonte_refs || '{"inativado_por": "zerar"}'::jsonb, erp_id = NULL, alterado_em = greatest(r.alterado_em, now()), fonte_ocorrido_em = greatest(r.fonte_ocorrido_em, now())
      FROM n
     WHERE r.tenant_id = p_tenant AND r.id = n.id
    RETURNING r.entidade::text AS entidade, r.pendente)
  SELECT coalesce(array_agg(u.entidade) FILTER (WHERE u.pendente), '{}') INTO v_out FROM u;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- RD-1560 e RD-1561: COMMENT ON só com parâmetros, erros e retorno (as regras e os alvos ficam no README, seção da 0053).
-- ---------------------------------------------------------------------------------------------------------------
COMMENT ON FUNCTION integracao_fdv.portal_inativar_espelho(uuid, text[], jsonb) IS
  'Interna (0053), chamada pelo cadastros.portal_zerar antes do DELETE, na mesma transação. p_entidades da F2; p_ids = {entidade de p_entidades: [uuid | {chave: uuid}]} (fora do formato = check_violation). Lote em voo numa entidade = MXI03 (DETAIL lote_em_voo, HINT = entidade); P0002. Efeito: portal_inativar_linhas. Devolve {inativacao_fdv: [{entidade, quantidade >= 1}]} na ordem de carga. Regras: docs/banco/README.md (0053). T-0086.';

COMMENT ON FUNCTION cadastros.portal_zerar(uuid, jsonb, text) IS
  'Portal /config (0043, 0053; RN-CAD-10): aplica o plano p_plano = {apagar: [{tabela, ids}], anular: [{tabela, coluna, ids}], em_uso: [{tabela, ids}]} do planoZeragem (domain); fora do formato ou das listas portal_zerar_tabelas e portal_zerar_anulaveis = check_violation. Erros: MXC03 (DETAIL em_uso | sumiu | anular_fora_do_plano | referencia, HINT = tabela), MXI03 lote_em_voo (HINT = entidade), MXS01, P0002, MXC04. Audita cadastros.dados.zerar só com as contagens. Devolve {apagados: [{tabela, quantidade}], anulados: [{tabela, coluna, quantidade}], inativacao_fdv?: [{entidade, quantidade}]}. Regras: docs/banco/README.md (0043, 0053). Só macuxierp_config. T-0058, T-0086.';

-- ---------------------------------------------------------------------------------------------------------------
-- RD-1565: os erros abertos agrupados uma vez (WITH g): erros = os 200 primeiros de g; total_erros = soma de g.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION integracao_fdv.portal_log(p_tenant uuid, p_entidade text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_e integracao_fdv.entidade_hub;
  v_out jsonb;
BEGIN
  IF p_entidade IS NULL OR NOT (p_entidade = ANY (integracao_fdv.portal_entidades_f2())) THEN
    RAISE EXCEPTION 'cadastro fora da F2' USING ERRCODE = 'check_violation';
  END IF;
  v_e := p_entidade::integracao_fdv.entidade_hub;
  WITH g AS (
    SELECT a.codigo, a.campo, count(*)::integer AS quantidade
      FROM (SELECT DISTINCT e.registro_external_id, e.codigo::text AS codigo, e.campo
              FROM integracao_fdv.lote_erro e
             WHERE e.tenant_id = v_t AND e.entidade = v_e AND e.resolvido_em IS NULL AND e.deleted_at IS NULL
               AND e.registro_external_id IS NOT NULL) a
     GROUP BY a.codigo, a.campo)
  SELECT jsonb_build_object(
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
      SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'campo', p.campo, 'quantidade', p.quantidade)
               ORDER BY p.quantidade DESC, p.codigo, p.campo NULLS FIRST), '[]'::jsonb)
        FROM (SELECT g.codigo, g.campo, g.quantidade FROM g
               ORDER BY g.quantidade DESC, g.codigo, g.campo NULLS FIRST LIMIT 200) p),
    'total_erros', (SELECT coalesce(sum(g.quantidade), 0)::integer FROM g),
    'pausada_motivo', (
      SELECT k.pausada_motivo FROM integracao_fdv.cursor_entidade k
       WHERE k.tenant_id = v_t AND k.entidade = v_e AND k.deleted_at IS NULL))
    INTO v_out;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- RD-1566: o erro aberto calculado uma vez por registro (CROSS JOIN LATERAL), no filtro e na contagem.
-- ---------------------------------------------------------------------------------------------------------------
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
  -- RN-INF-03 (planejarReprocessar do domain): falha = erro aberto; pendente = pendente ou hash não confirmado; o
  -- integrado não entra (nem é travado). Só registros com payload.
  WITH alvo AS (
    SELECT r.id, f.erro_aberto
      FROM integracao_fdv.registro_publicado r
      CROSS JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM integracao_fdv.lote_erro e
                        WHERE e.tenant_id = r.tenant_id AND e.entidade = r.entidade
                          AND e.registro_external_id = r.registro_external_id
                          AND e.resolvido_em IS NULL AND e.deleted_at IS NULL) AS erro_aberto) f
     WHERE r.tenant_id = v_t AND r.entidade = v_e AND r.deleted_at IS NULL AND r.payload IS NOT NULL
       AND (r.pendente OR r.hash_confirmado IS DISTINCT FROM r.hash OR f.erro_aberto)
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

-- ---------------------------------------------------------------------------------------------------------------
-- 🟡 da 0056: o pedido_fdv_sem_pendencia não repete PB e P de em_analise e recusado, que o pedido_fdv_sem_analise já
-- exige (status, origem e pendencias são NOT NULL: a conjunção dos dois CHECKs é a mesma). Fica PA no aprovado e P no
-- cancelado, que o sem_analise não cobre. Marca desta definição: o "= ANY (ARRAY['em_analise', 'recusado'])"; a 0056
-- reexecutada acha o 'cancelado' e não volta à anterior. Sem NOT VALID: toda linha que passava continua passando.
-- ---------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  modelo constant text := $sql$CASE
      WHEN jsonb_typeof(pendencias) IS DISTINCT FROM 'array' THEN false
      WHEN pendencias = '[]'::jsonb THEN false
      ELSE jsonb_array_length(jsonb_path_query_array(pendencias,
             '$[*] ? ((@.codigo == "prazo_incompleto" || @.codigo == "prazo_acima_do_cliente") && (%s))'))
           = jsonb_array_length(pendencias)
    END$sql$;
  p  constant text := format(modelo, '@.bloqueante == true || @.bloqueante == false');
  pa constant text := format(modelo, '@.bloqueante == false');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_pendencia'
                   AND pg_get_constraintdef(oid) LIKE '%= ANY (ARRAY[''em_analise''::text, ''recusado''::text])%') THEN
    ALTER TABLE pedido.pedido DROP CONSTRAINT IF EXISTS pedido_fdv_sem_pendencia;
    EXECUTE format(
      'ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_pendencia CHECK ('
      'origem <> ''fdv'' OR pendencias = ''[]''::jsonb OR status IN (''em_analise'', ''recusado'') '
      'OR (status = ''aprovado'' AND (%s)) OR (status = ''cancelado'' AND (%s)))',
      pa, p);
  END IF;
END $$;

COMMENT ON CONSTRAINT pedido_fdv_sem_pendencia ON pedido.pedido IS
  'D-A (0016) emendada pela RN-PED-07 (0056): o pedido do FDV tem pendencias = [] salvo em em_analise e recusado '
  '(conferidos pelo pedido_fdv_sem_analise), aprovado (só prazo não bloqueante, aceita) e cancelado (só prazo) (T-0085, 0058)';
