-- 0042 — credencial nova vazia (DEFAULT '{}'), configurar com carga inicial pela outbox e portal_conferir_evento (T-0058;
-- R-20261123-150400). Detalhes em docs/banco/README.md.

-- lock_timeout de 5 s: motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE integracao_fdv.credencial ALTER COLUMN entidades_habilitadas SET DEFAULT '{}'::integracao_fdv.entidade_hub[];

CREATE OR REPLACE FUNCTION integracao_fdv.portal_conferir_evento(p_evento jsonb) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_evento IS NOT NULL AND (jsonb_typeof(p_evento) <> 'object'
     OR jsonb_typeof(p_evento -> 'entidades') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_evento -> 'entidades') = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_evento -> 'entidades') x
                WHERE jsonb_typeof(x.value) <> 'string')) THEN
    RAISE EXCEPTION 'evento de carga inicial fora do formato {entidades: [texto, ...]}' USING ERRCODE = 'check_violation';
  END IF;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_conferir_evento(jsonb) IS
  'Interna (0042): evento de carga inicial NULL ou {entidades: [texto, ...]} não vazio; senão check_violation. Usada pelo portal_credencial_definir e pelo portal_configurar. T-0058.';
REVOKE ALL ON FUNCTION integracao_fdv.portal_conferir_evento(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION integracao_fdv.portal_credencial_definir(p_tenant uuid, p_anterior_id uuid, p_conector_id text,
  p_ambiente text, p_chave_cifrada bytea, p_chave_prefixo text, p_chave_mestra_versao integer, p_zerar_espelho boolean,
  p_evento_carga_inicial jsonb, p_request_id text,
  -- 0042: a primeira credencial nasce vazia (R-20261123-150400); o limite segue o LIMITE_REGISTROS_LOTE dos contracts
  p_entidades text[] DEFAULT '{}'::text[],
  p_limite integer DEFAULT 5000)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, true);
  v_ant integracao_fdv.credencial;
  v_nova uuid;
  v_zerados text[] := '{}';
  v_liberadas text[] := '{}';
BEGIN
  IF p_chave_cifrada IS NULL THEN
    RAISE EXCEPTION 'chave cifrada ausente' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM integracao_fdv.portal_conferir_evento(p_evento_carga_inicial);

  -- (a) a linha única de sinal do tenant (serializa as trocas simultâneas), com o sinal antecipado
  INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em)
  VALUES (v_t, now(), (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day 6 hours') AT TIME ZONE 'UTC', now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    proximo_sinal_em = least(integracao_fdv.sinal.proximo_sinal_em, EXCLUDED.proximo_sinal_em),
    proxima_reconciliacao_em = least(integracao_fdv.sinal.proxima_reconciliacao_em, EXCLUDED.proxima_reconciliacao_em),
    proxima_busca_pedidos_em = coalesce(integracao_fdv.sinal.proxima_busca_pedidos_em, EXCLUDED.proxima_busca_pedidos_em);

  -- (b) a ativa, travada, tem de ser a que a tela leu (na primeira, os dois são NULL; anterior não nulo sem ativa = MXI02)
  v_ant := integracao_fdv.portal_credencial_ativa(v_t, true, false);
  IF v_ant.id IS DISTINCT FROM p_anterior_id THEN
    RAISE EXCEPTION 'a credencial mudou; recarregue' USING ERRCODE = 'MXI02';
  END IF;
  -- 0042: a configuração só é conferida na primeira (NULL = '{}'); na troca ela vem da ativa e p_entidades/p_limite
  -- são ignorados
  IF v_ant.id IS NULL THEN
    PERFORM integracao_fdv.portal_conferir_config(coalesce(p_entidades, '{}'::text[]), p_limite);
  END IF;

  -- (c) a ativa sai antes da nova entrar (uma ativa por tenant); a chave dela é anulada depois, pelo worker
  IF v_ant.id IS NOT NULL THEN
    UPDATE integracao_fdv.credencial SET substituida_em = now() WHERE tenant_id = v_t AND id = v_ant.id;
  END IF;

  -- (d) a nova, com a configuração do envio copiada (ou p_entidades e p_limite na primeira)
  INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo,
    chave_mestra_versao, criada_por, entidades_habilitadas, limite_registros_lote)
  VALUES (v_t, p_conector_id, p_ambiente, p_chave_cifrada, p_chave_prefixo, coalesce(p_chave_mestra_versao, 1), NULL,
    CASE WHEN v_ant.id IS NULL THEN coalesce(p_entidades, '{}'::text[])::integracao_fdv.entidade_hub[]
         ELSE v_ant.entidades_habilitadas END,
    CASE WHEN v_ant.id IS NULL THEN p_limite ELSE v_ant.limite_registros_lote END)
  RETURNING id INTO v_nova;

  -- (e) outro conector ou ambiente: cursores e confirmações do Hub deixam de valer (nada é apagado)
  IF coalesce(p_zerar_espelho, false) THEN
    WITH z AS (
      UPDATE integracao_fdv.cursor_entidade SET cursor_alterado_em = NULL, cursor_external_id = NULL, sessao_aberta_id = NULL
       WHERE tenant_id = v_t AND deleted_at IS NULL
      RETURNING entidade::text AS entidade)
    SELECT coalesce(array_agg(z.entidade ORDER BY z.entidade), '{}') INTO v_zerados FROM z;
    PERFORM integracao_fdv.portal_antecipar(v_t, v_zerados);
    UPDATE integracao_fdv.registro_publicado SET hash_confirmado = NULL, confirmado_em = NULL
     WHERE tenant_id = v_t AND payload IS NOT NULL AND (hash_confirmado IS NOT NULL OR confirmado_em IS NOT NULL);
  END IF;

  -- (f) chave nova: a pausa por credencial recusada sai e as entidades voltam a ser avaliadas já
  WITH l AS (
    UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = NULL, pausada_em = NULL
     WHERE tenant_id = v_t AND pausada_motivo = 'credencial' AND deleted_at IS NULL
    RETURNING entidade::text AS entidade)
  SELECT coalesce(array_agg(l.entidade ORDER BY l.entidade), '{}') INTO v_liberadas FROM l;
  PERFORM integracao_fdv.portal_antecipar(v_t, v_liberadas);

  -- (g) carga inicial pela outbox: só este evento, nome fixo (envelope do OutboxPg; agregado = credencial nova, versão 1)
  IF p_evento_carga_inicial IS NOT NULL THEN
    INSERT INTO plataforma.evento (tenant_id, nome, agregado_id, versao, ocorrido_em, proximo_em, payload)
    VALUES (v_t, 'integracao-fdv.carga_inicial.solicitada@1', v_nova, 1, now(), now(),
      jsonb_build_object('ator', 'sistema', 'request_id', p_request_id, 'payload', p_evento_carga_inicial));
  END IF;

  -- (h) auditoria: só identificação (nunca a chave, o prefixo nem o cifrado)
  PERFORM plataforma.auditar_superadmin(v_t, v_sa,
    CASE WHEN v_ant.id IS NULL THEN 'integracao-fdv.credencial.criar' ELSE 'integracao-fdv.credencial.trocar' END,
    'credencial', v_nova,
    CASE WHEN v_ant.id IS NULL THEN NULL
         ELSE jsonb_build_object('conector_id', v_ant.conector_id, 'ambiente', v_ant.ambiente) END,
    jsonb_build_object('conector_id', p_conector_id, 'ambiente', p_ambiente,
      'zerou_espelho', coalesce(p_zerar_espelho, false)),
    p_request_id);
  IF cardinality(v_liberadas) > 0 THEN
    PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.credencial.liberar_pausa', 'credencial', v_nova,
      jsonb_build_object('pausada_motivo', 'credencial', 'entidades', to_jsonb(v_liberadas)),
      jsonb_build_object('pausada_motivo', NULL), p_request_id);
  END IF;

  -- (i) o estado do portal (o mesmo jsonb do portal_ler)
  RETURN integracao_fdv.portal_estado(v_t);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_credencial_definir(uuid, uuid, text, text, bytea, text, integer, boolean, jsonb,
  text, text[], integer) IS
  'Portal /config (0038, 0042): o PUT /credencial (sinal -> credencial -> cursor): confere p_anterior_id contra a ativa (MXI02), substitui a anterior, grava a nova com a chave já cifrada pela API (na troca, entidades e limite copiados da ativa, p_entidades/p_limite ignorados; na primeira, p_entidades e p_limite conferidos, com DEFAULT e NULL de p_entidades = ''{}'': nasce vazia, R-20261123-150400; p_limite DEFAULT 5000), zera o espelho se pedido (sem apagar), libera a pausa de credencial, grava integracao-fdv.carga_inicial.solicitada@1 na outbox se pedida (versão 1), audita sem chave, prefixo nem cifrado e devolve o jsonb do portal_ler. Só macuxierp_config. ADR 0013. T-0056, T-0058.';

DROP FUNCTION IF EXISTS integracao_fdv.portal_configurar(uuid, text[], integer, text);

CREATE OR REPLACE FUNCTION integracao_fdv.portal_configurar(p_tenant uuid, p_entidades text[], p_limite integer,
  p_request_id text, p_evento_carga_inicial jsonb DEFAULT NULL, p_antes text[] DEFAULT NULL) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, true);
  v_c integracao_fdv.credencial;
  v_antes text[];
  v_novas text[];
BEGIN
  PERFORM integracao_fdv.portal_conferir_config(p_entidades, p_limite);
  PERFORM integracao_fdv.portal_conferir_evento(p_evento_carga_inicial);
  v_c := integracao_fdv.portal_credencial_ativa(v_t, true, true);
  v_antes := v_c.entidades_habilitadas::text[];
  -- 0042: com p_antes (o que a tela leu), a lista travada tem de ser a mesma, como conjunto (sem ordem e sem repetição);
  -- senão MXI02, sem efeito e sem auditoria (fecha a corrida de dois PUT com a carga inicial calculada pela API)
  IF p_antes IS NOT NULL AND NOT (p_antes <@ v_antes AND v_antes <@ p_antes) THEN
    RAISE EXCEPTION 'a configuração mudou; recarregue' USING ERRCODE = 'MXI02';
  END IF;
  UPDATE integracao_fdv.credencial
     SET entidades_habilitadas = p_entidades::integracao_fdv.entidade_hub[], limite_registros_lote = p_limite
   WHERE tenant_id = v_t AND id = v_c.id;
  SELECT coalesce(array_agg(e ORDER BY o), '{}') INTO v_novas
    FROM unnest(p_entidades) WITH ORDINALITY AS x(e, o) WHERE NOT (e = ANY (v_antes));
  PERFORM integracao_fdv.portal_antecipar(v_t, v_novas);
  -- 0042: carga inicial pela outbox (nome fixo, envelope do passo (g) do definir; agregado = credencial ativa, a
  -- próxima versão livre; a credencial travada serializa a conta)
  IF p_evento_carga_inicial IS NOT NULL THEN
    INSERT INTO plataforma.evento (tenant_id, nome, agregado_id, versao, ocorrido_em, proximo_em, payload)
    SELECT v_t, 'integracao-fdv.carga_inicial.solicitada@1', v_c.id, coalesce(max(e.versao), 0) + 1, now(), now(),
      jsonb_build_object('ator', 'sistema', 'request_id', p_request_id, 'payload', p_evento_carga_inicial)
      FROM plataforma.evento e
     WHERE e.tenant_id = v_t AND e.nome = 'integracao-fdv.carga_inicial.solicitada@1' AND e.agregado_id = v_c.id;
  END IF;
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.configuracao.alterar', 'credencial', v_c.id,
    jsonb_build_object('entidades_habilitadas', to_jsonb(v_antes), 'limite_registros_lote', v_c.limite_registros_lote),
    jsonb_build_object('entidades_habilitadas', to_jsonb(p_entidades), 'limite_registros_lote', p_limite),
    p_request_id);
  RETURN integracao_fdv.portal_estado(v_t);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_configurar(uuid, text[], integer, text, jsonb, text[]) IS
  'Portal /config (0038, 0042): o PUT /configuracao na credencial ativa travada (MXI01 sem ela): entidades só da F2 sem repetição e limite de 1 a 5.000 (senão check_violation), antecipa as que ligaram; com p_evento_carga_inicial ({entidades: [texto, ...]} não vazio, senão check_violation) grava integracao-fdv.carga_inicial.solicitada@1 na outbox (agregado = credencial ativa, próxima versão livre); audita integracao-fdv.configuracao.alterar e devolve o jsonb do portal_ler. Com p_antes (a lista que a tela leu) diferente, como conjunto, da lista travada: MXI02 "a configuração mudou; recarregue", sem efeito nem auditoria; NULL não confere. As chamadas de 4 e de 5 argumentos seguem iguais (DEFAULT NULL). Só macuxierp_config. ADR 0013. T-0056, T-0058.';

REVOKE ALL ON FUNCTION integracao_fdv.portal_credencial_definir(uuid, uuid, text, text, bytea, text, integer, boolean, jsonb,
  text, text[], integer), integracao_fdv.portal_configurar(uuid, text[], integer, text, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.portal_credencial_definir(uuid, uuid, text, text, bytea, text, integer, boolean,
  jsonb, text, text[], integer), integracao_fdv.portal_configurar(uuid, text[], integer, text, jsonb, text[]) TO macuxierp_config;
