-- 0064 — Zerar pedidos não faturados pelo portal /config (T-0093, v0.3.13; RN-CAD-10). Mesmo desenho da 0043: o banco
-- só fornece os fatos e aplica o plano; quem sai e quem fica (mantidos por nota ou título) é decidido no domain do
-- pedido (função pura planoZeragemPedidos). Aditiva e reexecutável: CREATE OR REPLACE, troca do gatilho só de inserção
-- do pedido_evento e da aprovacao (mesmo nome, mesma recusa), REVOKE, GRANT e COMMENT; não muda nenhuma linha de dado.
-- O porquê das travas, do gatilho e do pedido do FDV: docs/banco/README.md, seção da migração.

-- o USAGE no schema é da 0043

CREATE OR REPLACE FUNCTION plataforma.portal_empresa_licenciada(p_tenant uuid, p_modulo text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  t plataforma.tenant;
BEGIN
  t := plataforma.empresa_alvo_leitura(p_tenant);
  IF t.situacao <> 'ativo' THEN
    RAISE EXCEPTION 'empresa fora de ativo' USING ERRCODE = 'MXC04', DETAIL = 'empresa_inativa';
  END IF;
  IF NOT plataforma.modulo_licenciado(t.id, p_modulo) THEN
    RAISE EXCEPTION '%', format('módulo %s desligado na empresa', p_modulo)
      USING ERRCODE = 'MXC04', DETAIL = 'modulo_desligado';
  END IF;
  RETURN t.id;
END $$;
COMMENT ON FUNCTION plataforma.portal_empresa_licenciada(uuid, text) IS
  'Interna (0064): confere a empresa alvo com FOR KEY SHARE (inexistente, de referência ou excluída = P0002; fora de ativo = MXC04 empresa_inativa; p_modulo sem licença ativa e vigente = MXC04 modulo_desligado). Devolve o id da empresa. T-0093.';

-- O FOR SHARE na fila vem antes da leitura das notas (o porquê: docs/banco/README.md, 0064).
CREATE OR REPLACE FUNCTION faturamento.pedidos_com_uso(p_tenant uuid, p_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_nota uuid[];
  v_titulo uuid[];
BEGIN
  IF p_ids IS NULL OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'lista de pedidos nula ou com nulo' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM faturamento.pedido_a_faturar x
   WHERE x.tenant_id = p_tenant AND x.pedido_id = ANY (p_ids) ORDER BY x.id FOR SHARE;
  SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_nota
    FROM (SELECT n.pedido_id AS r FROM faturamento.nota n
           WHERE n.tenant_id = p_tenant AND n.pedido_id = ANY (p_ids) FOR SHARE) s;
  SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_titulo
    FROM (SELECT n.pedido_id AS r FROM faturamento.titulo x
            JOIN faturamento.nota n ON n.tenant_id = x.tenant_id AND n.id = x.nota_id
           WHERE x.tenant_id = p_tenant AND n.pedido_id = ANY (p_ids) FOR SHARE OF x) s;
  RETURN jsonb_build_object('com_nota', to_jsonb(v_nota), 'com_titulo', to_jsonb(v_titulo));
END $$;
COMMENT ON FUNCTION faturamento.pedidos_com_uso(uuid, uuid[]) IS
  'Interna (0064): p_ids (nulo ou com nulo = check_violation). Devolve {com_nota: [uuid], com_titulo: [uuid]}. T-0093.';

-- Sem SECURITY DEFINER: o gatilho vê o current_user de quem apaga.
CREATE OR REPLACE FUNCTION pedido.somente_insercao_salvo_zerar() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('macuxierp.pedido_zerar', true) = 'on'
     AND (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = TG_RELID)
       = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'tabela % é só de inserção (% recusado)', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
COMMENT ON FUNCTION pedido.somente_insercao_salvo_zerar() IS
  'Gatilho (0064) somente_insercao do pedido.pedido_evento e do pedido.aprovacao: 42501 no UPDATE e no DELETE, salvo o DELETE do pedido.portal_zerar. T-0093.';

DROP TRIGGER IF EXISTS somente_insercao ON pedido.pedido_evento;
CREATE TRIGGER somente_insercao BEFORE UPDATE OR DELETE ON pedido.pedido_evento
  FOR EACH ROW EXECUTE FUNCTION pedido.somente_insercao_salvo_zerar();
DROP TRIGGER IF EXISTS somente_insercao ON pedido.aprovacao;
CREATE TRIGGER somente_insercao BEFORE UPDATE OR DELETE ON pedido.aprovacao
  FOR EACH ROW EXECUTE FUNCTION pedido.somente_insercao_salvo_zerar();

CREATE OR REPLACE FUNCTION pedido.portal_zeragem_fatos(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := plataforma.portal_empresa_licenciada(p_tenant, 'pedido');
  v_l jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'origem', s.origem) ORDER BY s.id), '[]')
    INTO v_l
    FROM (SELECT x.id, x.status::text AS status, x.origem FROM pedido.pedido x
           WHERE x.tenant_id = v_t AND x.deleted_at IS NULL FOR SHARE) s;
  RETURN jsonb_build_object('pedidos', v_l);
END $$;
COMMENT ON FUNCTION pedido.portal_zeragem_fatos(uuid) IS
  'Portal /config (0064, RN-CAD-10): os pedidos não excluídos da empresa, só leitura com FOR SHARE. Devolve {pedidos: [{id, status, origem: fdv | bko}]}, sem dado pessoal. MXS01, P0002, MXC04. Só macuxierp_config. T-0093.';

CREATE OR REPLACE FUNCTION faturamento.portal_pedidos_com_uso(p_tenant uuid, p_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := (plataforma.empresa_alvo_leitura(p_tenant)).id;
BEGIN
  RETURN faturamento.pedidos_com_uso(v_t, p_ids);
END $$;
COMMENT ON FUNCTION faturamento.portal_pedidos_com_uso(uuid, uuid[]) IS
  'Portal /config (0064, RN-CAD-10): dos pedidos de p_ids, os com nota e os com título (faturamento.pedidos_com_uso). Só lê. Devolve {com_nota: [uuid], com_titulo: [uuid]}. MXS01, P0002; p_ids nulo ou com nulo = check_violation. Só macuxierp_config. T-0093.';

CREATE OR REPLACE FUNCTION pedido.portal_zerar(p_tenant uuid, p_plano jsonb, p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := plataforma.portal_empresa_licenciada(p_tenant, 'pedido');
  v_ids uuid[];
  v_vivos integer;
  v_faturados integer;
  v_fdv integer;
  v_uso jsonb;
  v_n_pedido integer := 0;
  v_n_item integer := 0;
  v_n_evento integer := 0;
  v_n_aprovacao integer := 0;
  v_apagados jsonb;
BEGIN
  PERFORM plataforma.portal_refs_uuid(p_plano, ARRAY['apagar']);
  v_ids := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_plano -> 'apagar', '[]')) x ORDER BY 1);

  IF cardinality(v_ids) > 0 THEN
    -- (1)
    SELECT count(*) FILTER (WHERE s.deleted_at IS NULL), count(*) FILTER (WHERE s.status IN ('faturado', 'faturado_parcial')),
           count(*) FILTER (WHERE s.origem = 'fdv')
      INTO v_vivos, v_faturados, v_fdv
      FROM (SELECT x.deleted_at, x.status, x.origem FROM pedido.pedido x
             WHERE x.tenant_id = v_t AND x.id = ANY (v_ids) ORDER BY x.id FOR UPDATE) s;
    IF v_vivos <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'sumiu', HINT = 'pedido';
    END IF;
    IF v_faturados > 0 THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'em_uso', HINT = 'pedido';
    END IF;

    -- (2)
    v_uso := faturamento.pedidos_com_uso(v_t, v_ids);
    IF jsonb_array_length(v_uso -> 'com_nota') > 0 OR jsonb_array_length(v_uso -> 'com_titulo') > 0 THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'em_uso', HINT = 'pedido';
    END IF;

    -- (3) DELETE de fato, filho -> pai; o gatilho só de inserção deixa passar só o dono com a marca desta transação
    BEGIN
      PERFORM set_config('macuxierp.pedido_zerar', 'on', true);
      DELETE FROM pedido.aprovacao WHERE tenant_id = v_t AND pedido_id = ANY (v_ids);
      GET DIAGNOSTICS v_n_aprovacao = ROW_COUNT;
      DELETE FROM pedido.pedido_evento WHERE tenant_id = v_t AND pedido_id = ANY (v_ids);
      GET DIAGNOSTICS v_n_evento = ROW_COUNT;
      DELETE FROM pedido.pedido_item WHERE tenant_id = v_t AND pedido_id = ANY (v_ids);
      GET DIAGNOSTICS v_n_item = ROW_COUNT;
      DELETE FROM pedido.pedido WHERE tenant_id = v_t AND id = ANY (v_ids);
      GET DIAGNOSTICS v_n_pedido = ROW_COUNT;
      PERFORM set_config('macuxierp.pedido_zerar', 'off', true);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'referencia', HINT = 'pedido';
    END;
  END IF;

  -- (4)
  v_apagados := jsonb_build_array(
    jsonb_build_object('tabela', 'pedido', 'quantidade', v_n_pedido),
    jsonb_build_object('tabela', 'pedido_item', 'quantidade', v_n_item),
    jsonb_build_object('tabela', 'pedido_evento', 'quantidade', v_n_evento),
    jsonb_build_object('tabela', 'aprovacao', 'quantidade', v_n_aprovacao));
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'pedido.dados.zerar', 'empresa', v_t, NULL,
    jsonb_build_object('apagados', v_apagados, 'apagados_fdv', coalesce(v_fdv, 0)), p_request_id);
  RETURN jsonb_build_object('apagados', v_apagados);
END $$;
COMMENT ON FUNCTION pedido.portal_zerar(uuid, jsonb, text) IS
  'Portal /config (0064, RN-CAD-10): p_plano = {apagar: [uuid]} (fora do formato = check_violation). MXC03 sumiu ou em_uso (HINT = pedido); MXS01, P0002, MXC04. Devolve {apagados: [{tabela, quantidade}]}. Só macuxierp_config. T-0093.';

REVOKE ALL ON FUNCTION plataforma.portal_empresa_licenciada(uuid, text), faturamento.pedidos_com_uso(uuid, uuid[]),
  pedido.somente_insercao_salvo_zerar(), pedido.portal_zeragem_fatos(uuid),
  faturamento.portal_pedidos_com_uso(uuid, uuid[]), pedido.portal_zerar(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedido.portal_zeragem_fatos(uuid), faturamento.portal_pedidos_com_uso(uuid, uuid[]),
  pedido.portal_zerar(uuid, jsonb, text) TO macuxierp_config;
