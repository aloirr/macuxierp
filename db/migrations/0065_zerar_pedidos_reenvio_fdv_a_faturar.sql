-- 0065 — Critério 3 do zerar de pedidos (T-0093). Aditiva e reexecutável: CREATE OR REPLACE, REVOKE, GRANT e COMMENT; não muda nenhuma linha de dado. O porquê: docs/banco/README.md, seção da 0065.

CREATE OR REPLACE FUNCTION plataforma.portal_lista_pedidos(p_tenant uuid, p_pedido_ids uuid[]) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  -- a dimensão antes do array_position, que recusa array de mais de uma dimensão com outro código
  IF p_pedido_ids IS NULL OR coalesce(array_ndims(p_pedido_ids), 1) <> 1 OR array_position(p_pedido_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'lista de pedidos nula ou com nulo, ou fora do formato uuid[]' USING ERRCODE = 'check_violation';
  END IF;
  RETURN (plataforma.empresa_alvo_leitura(p_tenant)).id;
END $$;
COMMENT ON FUNCTION plataforma.portal_lista_pedidos(uuid, uuid[]) IS
  'Interna (0065): p_pedido_ids nulo, com nulo ou com mais de uma dimensão = check_violation; empresa nula, inexistente, de referência ou excluída = P0002 (FOR KEY SHARE). Devolve o id da empresa. T-0093.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_liberar_reenvio_pedidos(p_tenant uuid, p_pedido_ids uuid[])
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := plataforma.portal_lista_pedidos(p_tenant, p_pedido_ids);
  v_uuids uuid[];
  v_retornos integer := 0;
  v_pedidos integer := 0;
  v_out jsonb;
BEGIN
  -- travas pedido_recebido -> retorno_enviado (a ordem do recebimento: o INSERT ... ON CONFLICT trava o recebido antes
  -- de gravar o retorno)
  SELECT coalesce(array_agg(s.pedido_uuid ORDER BY s.pedido_uuid), '{}') INTO v_uuids
    FROM (SELECT r.pedido_uuid FROM integracao_fdv.pedido_recebido r
           WHERE r.tenant_id = v_t AND r.pedido_id = ANY (p_pedido_ids) ORDER BY r.id FOR UPDATE) s;
  IF cardinality(v_uuids) > 0 THEN
    PERFORM 1 FROM integracao_fdv.retorno_enviado x
     WHERE x.tenant_id = v_t AND x.pedido_uuid = ANY (v_uuids) ORDER BY x.id FOR UPDATE;
    DELETE FROM integracao_fdv.retorno_enviado x WHERE x.tenant_id = v_t AND x.pedido_uuid = ANY (v_uuids);
    GET DIAGNOSTICS v_retornos = ROW_COUNT;
    DELETE FROM integracao_fdv.pedido_recebido r WHERE r.tenant_id = v_t AND r.pedido_uuid = ANY (v_uuids);
    GET DIAGNOSTICS v_pedidos = ROW_COUNT;
  END IF;

  v_out := jsonb_build_object('pedidos_liberados', v_pedidos, 'retornos_descartados', v_retornos);
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.pedido_recebido.liberar_reenvio', 'empresa', v_t,
    NULL, v_out, NULL);
  RETURN v_out;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_liberar_reenvio_pedidos(uuid, uuid[]) IS
  'Portal /config (0065, RN-CAD-10): apaga os pedido_recebido com pedido_id em p_pedido_ids e os retorno_enviado deles. Idempotente (de novo = 0). Audita integracao-fdv.pedido_recebido.liberar_reenvio só com as contagens. Devolve {pedidos_liberados, retornos_descartados}. MXS01, check_violation, P0002. Só macuxierp_config. T-0093.';

CREATE OR REPLACE FUNCTION faturamento.portal_descartar_a_faturar(p_tenant uuid, p_pedido_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := plataforma.portal_lista_pedidos(p_tenant, p_pedido_ids);
  v_faturados integer;
  v_n integer := 0;
  v_out jsonb;
BEGIN
  SELECT count(*) FILTER (WHERE s.status IN ('faturado_parcial', 'faturado')) INTO v_faturados
    FROM (SELECT x.status FROM faturamento.pedido_a_faturar x
           WHERE x.tenant_id = v_t AND x.pedido_id = ANY (p_pedido_ids) AND x.deleted_at IS NULL
           ORDER BY x.id FOR UPDATE) s;
  IF v_faturados > 0 THEN
    RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'em_uso', HINT = 'pedido';
  END IF;
  UPDATE faturamento.pedido_a_faturar x SET status = 'cancelado'
   WHERE x.tenant_id = v_t AND x.pedido_id = ANY (p_pedido_ids) AND x.deleted_at IS NULL AND x.status = 'a_faturar';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  v_out := jsonb_build_object('a_faturar_cancelados', v_n);
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'faturamento.pedido_a_faturar.descartar', 'empresa', v_t, NULL,
    v_out, NULL);
  RETURN v_out;
END $$;
COMMENT ON FUNCTION faturamento.portal_descartar_a_faturar(uuid, uuid[]) IS
  'Portal /config (0065, RN-CAD-10): status = cancelado nos pedido_a_faturar a_faturar não excluídos com pedido_id em p_pedido_ids. faturado_parcial ou faturado = MXC03 em_uso (HINT = pedido), nada muda. Idempotente (de novo = 0). Audita faturamento.pedido_a_faturar.descartar só com a contagem. Devolve {a_faturar_cancelados}. MXS01, check_violation, P0002. Só macuxierp_config. T-0093.';

REVOKE ALL ON FUNCTION plataforma.portal_lista_pedidos(uuid, uuid[]),
  integracao_fdv.portal_liberar_reenvio_pedidos(uuid, uuid[]), faturamento.portal_descartar_a_faturar(uuid, uuid[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.portal_liberar_reenvio_pedidos(uuid, uuid[]),
  faturamento.portal_descartar_a_faturar(uuid, uuid[]) TO macuxierp_config;
