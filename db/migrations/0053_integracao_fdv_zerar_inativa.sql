-- 0053 — Zerar por cadastro inativa no Macuxi FDV (T-0086 §5, emenda da RN-CAD-10, R-20261124-170915-alexandre).
-- O cadastros.portal_zerar passa a marcar no espelho do FDV, antes de apagar e na mesma transação, cada registro
-- publicado que sai do ERP: ativo = false e pendente, com o payload de sempre (ativo = false) e o hash novo. O conector
-- envia a inativação depois, no ciclo delta, a partir do espelho. Sai o desligamento do espelho (portal_zerar_espelho, que
-- fica só para a versão anterior da API) e o cursor não volta ao início; o lote em voo continua bloqueando.
-- Aditiva e reexecutável: só CREATE OR REPLACE, REVOKE e COMMENT; a migração não muda nenhuma linha de dado.
-- Regras, alvos por entidade e o porquê de cada coluna: docs/banco/README.md, seção da 0053.

-- ---------------------------------------------------------------------------------------------------------------
-- Hash do registro em SQL (RN-INF-03), igual ao hashRegistro de modules/integracao-fdv/domain/canonico.ts.
-- ---------------------------------------------------------------------------------------------------------------

-- JSON canônico do jsonCanonico: chaves na ordem dos bytes UTF-8 (COLLATE "C" = compararBinario), sem espaços, texto
-- com o escape do JSON.stringify (o do Postgres é o mesmo: \" \\ \b \f \n \r \t e \u00xx minúsculo). Número sai como o
-- jsonb guarda; o payload vem do JSON.stringify do worker (inteiros e decimais curtos, sem expoente), então o texto
-- é o mesmo do JS.
CREATE OR REPLACE FUNCTION integracao_fdv.json_canonico(p jsonb) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      RETURN '{' || coalesce((SELECT string_agg(to_json(e.key)::text || ':' || integracao_fdv.json_canonico(e.value), ','
                                                ORDER BY e.key COLLATE "C")
                                FROM jsonb_each(p) e), '') || '}';
    WHEN 'array' THEN
      RETURN '[' || coalesce((SELECT string_agg(integracao_fdv.json_canonico(a.v), ',' ORDER BY a.o)
                                FROM jsonb_array_elements(p) WITH ORDINALITY AS a(v, o)), '') || ']';
    ELSE
      RETURN p::text;
  END CASE;
END $$;
COMMENT ON FUNCTION integracao_fdv.json_canonico(jsonb) IS
  'Interna (0053): o jsonCanonico de modules/integracao-fdv/domain/canonico.ts (chaves em COLLATE "C", sem espaços, escape do JSON.stringify; número como o jsonb guarda). O teste da 0053 confere com o JS. T-0086.';

CREATE OR REPLACE FUNCTION integracao_fdv.hash_registro(p_payload jsonb) RETURNS plataforma.sha256_hex
  LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT encode(sha256(convert_to(integracao_fdv.json_canonico(p_payload - 'alterado_em'), 'UTF8')), 'hex')::plataforma.sha256_hex $$;
COMMENT ON FUNCTION integracao_fdv.hash_registro(jsonb) IS
  'Interna (0053): o hashRegistro de modules/integracao-fdv/domain/canonico.ts (SHA-256 hex do JSON canônico do payload, sem alterado_em; RN-INF-03). T-0086.';

-- ---------------------------------------------------------------------------------------------------------------
-- integracao_fdv.portal_inativar_espelho: as linhas do espelho dos registros que o zerar apaga ficam inativas e pendentes.
-- ---------------------------------------------------------------------------------------------------------------
-- p_entidades = entidades do Hub tocadas (F2; travas e lote em voo); p_ids = {entidade: [alvo]}, chaves de p_entidades,
-- alvo = uuid em texto (a linha com esse erp_id) ou objeto {filial_id?, produto_id?, tabela_preco_id?,
-- condicao_pagamento_id?: uuid} (as linhas cujo fonte_refs o contém: preco, estoque e forma_pagamento, que não têm o UUID
-- do registro do ERP no erp_id). Só linha ativa, não excluída e com payload. A forma de pagamento só sai sem prazo ativo
-- com ela (T-0009 2.3), conferido depois dos prazos.
CREATE OR REPLACE FUNCTION integracao_fdv.portal_inativar_espelho(p_tenant uuid, p_entidades text[], p_ids jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_e text;
  v_linhas uuid[];
  v_pendentes text[] := '{}';
  v_out jsonb;
BEGIN
  PERFORM integracao_fdv.portal_conferir_entidades(p_entidades);
  IF p_ids IS NULL OR jsonb_typeof(p_ids) <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(p_ids) e
        WHERE NOT (e.key = ANY (p_entidades)) OR jsonb_typeof(e.value) <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) a
                       WHERE jsonb_typeof(a) NOT IN ('string', 'object') OR a = '{}'::jsonb)) THEN
    RAISE EXCEPTION 'alvos fora do formato {entidade: [uuid | {chave: uuid}]}' USING ERRCODE = 'check_violation';
  END IF;
  -- os uuid (erp_id e os valores dos objetos) pela regex única da 0043
  PERFORM plataforma.portal_refs_uuid(coalesce((
    SELECT jsonb_object_agg(s.k, s.vs) FROM (
      SELECT x.k, jsonb_agg(x.v) AS vs FROM (
        SELECT 'erp_id' AS k, a AS v FROM jsonb_each(p_ids) e, jsonb_array_elements(e.value) a WHERE jsonb_typeof(a) = 'string'
        UNION ALL
        SELECT f.key, f.value FROM jsonb_each(p_ids) e, jsonb_array_elements(e.value) a,
               jsonb_each(CASE WHEN jsonb_typeof(a) = 'object' THEN a ELSE '{}'::jsonb END) f) x
       GROUP BY x.k) s), '{}'),
    ARRAY['erp_id', 'filial_id', 'produto_id', 'tabela_preco_id', 'condicao_pagamento_id']);
  IF cardinality(p_entidades) = 0 THEN
    RETURN jsonb_build_object('inativacao_fdv', '[]'::jsonb);
  END IF;

  -- travas na ordem da 0038/0043: sinal -> cursor_entidade -> registro_publicado (a credencial não é lida: ligada ou
  -- desligada, a inativação fica pendente no espelho)
  PERFORM 1 FROM integracao_fdv.sinal s WHERE s.tenant_id = v_t FOR UPDATE;
  PERFORM 1 FROM integracao_fdv.cursor_entidade k
   WHERE k.tenant_id = v_t AND k.entidade::text = ANY (p_entidades) ORDER BY k.entidade, k.id FOR UPDATE;
  FOREACH v_e IN ARRAY p_entidades LOOP
    IF integracao_fdv.portal_lote_em_voo(v_t, v_e::integracao_fdv.entidade_hub) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'lote_em_voo', HINT = v_e;
    END IF;
  END LOOP;
  PERFORM 1 FROM integracao_fdv.registro_publicado r
   WHERE r.tenant_id = v_t AND r.entidade::text = ANY (p_entidades) ORDER BY r.id FOR UPDATE;

  -- (1) as linhas dos alvos, menos a forma de pagamento: erp_id (índice registro_publicado_erp_id_uq) ou fonte_refs
  --     (índice GIN registro_publicado_fonte_refs_idx)
  SELECT coalesce(array_agg(DISTINCT l.id), '{}') INTO v_linhas FROM (
    SELECT r.id FROM jsonb_each(p_ids) e, jsonb_array_elements(e.value) a, integracao_fdv.registro_publicado r
     WHERE jsonb_typeof(a) = 'string' AND e.key <> 'forma_pagamento'
       AND r.tenant_id = v_t AND r.entidade = e.key::integracao_fdv.entidade_hub AND r.erp_id = (a #>> '{}')::uuid
       AND r.ativo AND r.deleted_at IS NULL AND r.payload IS NOT NULL
    UNION ALL
    SELECT r.id FROM jsonb_each(p_ids) e, jsonb_array_elements(e.value) a, integracao_fdv.registro_publicado r
     WHERE jsonb_typeof(a) = 'object' AND e.key <> 'forma_pagamento'
       AND r.tenant_id = v_t AND r.entidade = e.key::integracao_fdv.entidade_hub AND r.fonte_refs @> a
       AND r.ativo AND r.deleted_at IS NULL AND r.payload IS NOT NULL) l;
  v_pendentes := v_pendentes || integracao_fdv.portal_inativar_linhas(v_t, v_linhas);

  -- (2) a forma de pagamento, depois dos prazos: só a que ficou sem prazo ativo com ela
  SELECT coalesce(array_agg(DISTINCT r.id), '{}') INTO v_linhas
    FROM jsonb_array_elements(coalesce(p_ids -> 'forma_pagamento', '[]')) a, integracao_fdv.registro_publicado r
   WHERE r.tenant_id = v_t AND r.entidade = 'forma_pagamento'
     AND (CASE WHEN jsonb_typeof(a) = 'string' THEN r.erp_id = (a #>> '{}')::uuid ELSE r.fonte_refs @> a END)
     AND r.ativo AND r.deleted_at IS NULL AND r.payload IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM integracao_fdv.registro_publicado p
                      WHERE p.tenant_id = v_t AND p.entidade = 'prazo_pagamento' AND p.ativo AND p.deleted_at IS NULL
                        AND p.payload IS NOT NULL AND p.payload ->> 'forma_external_id' = r.registro_external_id);
  v_pendentes := v_pendentes || integracao_fdv.portal_inativar_linhas(v_t, v_linhas);

  -- {inativacao_fdv: [{entidade, quantidade}]}: só as que ficaram pendentes, na ordem de carga
  SELECT coalesce(jsonb_agg(jsonb_build_object('entidade', f.e, 'quantidade', c.n) ORDER BY f.o), '[]') INTO v_out
    FROM unnest(integracao_fdv.portal_entidades_f2()) WITH ORDINALITY AS f(e, o)
    JOIN (SELECT x AS e, count(*)::int AS n FROM unnest(v_pendentes) x GROUP BY x) c ON c.e = f.e;
  PERFORM integracao_fdv.portal_antecipar(v_t, ARRAY(SELECT DISTINCT x FROM unnest(v_pendentes) x ORDER BY 1));
  RETURN jsonb_build_object('inativacao_fdv', v_out);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_inativar_espelho(uuid, text[], jsonb) IS
  'Interna (0053, RN-CAD-10 emendada): chamada pelo cadastros.portal_zerar antes do DELETE, na mesma transação. p_entidades da F2 (portal_conferir_entidades); p_ids = {entidade de p_entidades: [uuid do erp_id | {filial_id?, produto_id?, tabela_preco_id?, condicao_pagamento_id?: uuid} contido no fonte_refs]} (fora do formato = check_violation). Travas sinal -> cursor_entidade -> registro_publicado; lote em voo numa entidade = MXI03 (DETAIL lote_em_voo, HINT = entidade). Linha ativa com payload do alvo: nunca publicada (sem hash_confirmado nem ultimo_lote_envio_id) sai do espelho (deleted_at); a publicada fica ativo = false, payload com ativo = false, hash novo (hash_registro), pendente se o hash difere do confirmado, fonte_refs com inativado_por = zerar (origem no Log do conector, R-20261124-181938). erp_id = NULL nas duas (a recarga religa a chave ao UUID novo) e alterado_em/fonte_ocorrido_em >= agora (evento velho do registro apagado não o reativa, M3). Forma de pagamento só sem prazo ativo com ela. Antecipa a agenda; o cursor não volta ao início. Não audita (a auditoria é a do zerar). Devolve {inativacao_fdv: [{entidade, quantidade >= 1}]} na ordem de carga. P0002. T-0086.';

-- Aplica a inativação às linhas dadas (já travadas por quem chama); devolve a entidade de cada linha que ficou pendente.
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
    SELECT r.id, r.payload || '{"ativo": false}'::jsonb AS payload,
           integracao_fdv.hash_registro(r.payload || '{"ativo": false}'::jsonb) AS hash
      FROM integracao_fdv.registro_publicado r
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
COMMENT ON FUNCTION integracao_fdv.portal_inativar_linhas(uuid, uuid[]) IS
  'Interna (0053): o efeito do portal_inativar_espelho nas linhas p_ids do tenant (a nunca publicada sai com deleted_at; a publicada fica inativa, com payload ativo = false, hash novo, pendente se difere do confirmado e fonte_refs com inativado_por = zerar, que o Log do conector lê; erp_id = NULL). Devolve a entidade de cada linha pendente. T-0086.';

-- ---------------------------------------------------------------------------------------------------------------
-- cadastros.portal_zerar: a inativação no espelho entra antes do DELETE (passo 4), na mesma transação.
-- ---------------------------------------------------------------------------------------------------------------
-- Alvos por tabela que sai (o que o ERP apaga, inclusive pela cascata do plano): filial, vendedor, produto,
-- produto_unidade, cliente e cliente_endereco pelo id (erp_id); condicao_pagamento = prazo_pagamento pelo id e
-- forma_pagamento por {condicao_pagamento_id}; tabela_preco_item = preco por {tabela_preco_id, filial_id, produto_id};
-- estoque_saldo = estoque por {filial_id, produto_id}. tabela_preco (referência do espelho), estoque_movimento e
-- cliente_contato não são entidade do Hub.
CREATE OR REPLACE FUNCTION cadastros.portal_zerar(p_tenant uuid, p_plano jsonb, p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := cadastros.portal_zerar_empresa(p_tenant);
  v_tabelas text[] := cadastros.portal_zerar_tabelas();
  v_anulaveis jsonb := cadastros.portal_zerar_anulaveis();
  v_apagar jsonb;
  v_anular jsonb;
  v_uso jsonb;
  v_tab text;
  v_col text;
  v_ids uuid[];
  v_n integer;
  v_apagados jsonb := '[]';
  v_anulados jsonb := '[]';
  v_alvos jsonb;
  v_inativacao jsonb;
  v_out jsonb;
BEGIN
  -- formato e listas fechadas
  IF NOT cadastros.portal_zerar_plano_valido(p_plano) THEN
    RAISE EXCEPTION 'plano de zeragem fora do formato ou das listas fechadas' USING ERRCODE = 'check_violation';
  END IF;

  -- {tabela: [ids]} (e {"tabela.coluna": [ids]} no anular), juntando as repetições
  SELECT coalesce(jsonb_object_agg(k, ids), '{}') INTO v_apagar FROM (
    SELECT x ->> 'tabela' AS k, jsonb_agg(DISTINCT i) AS ids
      FROM jsonb_array_elements(coalesce(p_plano -> 'apagar', '[]')) x, jsonb_array_elements_text(x -> 'ids') i GROUP BY 1) a;
  SELECT coalesce(jsonb_object_agg(k, ids), '{}') INTO v_uso FROM (
    SELECT x ->> 'tabela' AS k, jsonb_agg(DISTINCT i) AS ids
      FROM jsonb_array_elements(coalesce(p_plano -> 'em_uso', '[]')) x, jsonb_array_elements_text(x -> 'ids') i GROUP BY 1) a;
  SELECT coalesce(jsonb_object_agg(k, ids), '{}') INTO v_anular FROM (
    SELECT (x ->> 'tabela') || '.' || (x ->> 'coluna') AS k, jsonb_agg(DISTINCT i) AS ids
      FROM jsonb_array_elements(coalesce(p_plano -> 'anular', '[]')) x, jsonb_array_elements_text(x -> 'ids') i GROUP BY 1) a;

  -- (1) nada do que sai pode estar em uso (o plano já devia ter tirado; se não tirou, o estado mudou)
  FOREACH v_tab IN ARRAY v_tabelas LOOP
    IF cadastros.portal_zerar_ids(v_apagar, v_tab) && cadastros.portal_zerar_ids(v_uso, v_tab) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'em_uso', HINT = v_tab;
    END IF;
  END LOOP;

  -- (2) FOR UPDATE nos registros que saem, na ordem pai -> filho; o que sumiu = o estado mudou
  FOREACH v_tab IN ARRAY v_tabelas LOOP
    v_ids := cadastros.portal_zerar_ids(v_apagar, v_tab);
    CONTINUE WHEN cardinality(v_ids) = 0;
    EXECUTE format('SELECT count(*)::int FROM (SELECT 1 FROM cadastros.%I x WHERE x.tenant_id = $1 AND x.id = ANY ($2)'
                   ' ORDER BY x.id FOR UPDATE) s', v_tab) INTO v_n USING v_t, v_ids;
    IF v_n <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'sumiu', HINT = v_tab;
    END IF;
  END LOOP;

  -- (3) anular: as linhas existem e a coluna ainda aponta para um registro que sai (senão o estado mudou)
  FOR v_tab, v_col IN SELECT split_part(k, '.', 1), split_part(k, '.', 2) FROM jsonb_object_keys(v_anular) k ORDER BY k LOOP
    v_ids := cadastros.portal_zerar_ids(v_anular, v_tab || '.' || v_col);
    EXECUTE format('SELECT count(*)::int FROM (SELECT 1 FROM cadastros.%I x WHERE x.tenant_id = $1 AND x.id = ANY ($2)'
                   ' AND x.%I = ANY ($3) ORDER BY x.id FOR UPDATE) s', v_tab, v_col)
      INTO v_n USING v_t, v_ids, cadastros.portal_zerar_ids(v_apagar, v_anulaveis ->> (v_tab || '.' || v_col));
    IF v_n <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'anular_fora_do_plano',
        HINT = v_tab || '.' || v_col;
    END IF;
    EXECUTE format('UPDATE cadastros.%I SET %I = NULL WHERE tenant_id = $1 AND id = ANY ($2)', v_tab, v_col)
      USING v_t, v_ids;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_anulados := v_anulados || jsonb_build_array(jsonb_build_object('tabela', v_tab, 'coluna', v_col, 'quantidade', v_n));
  END LOOP;

  -- (4) inativação no espelho do FDV (0053), antes do DELETE e na mesma transação: o erro aqui desfaz tudo. Os mantidos
  --     não estão em v_apagar, então não são inativados. MXI03 lote_em_voo se uma entidade tocada tem lote em voo.
  SELECT coalesce(jsonb_object_agg(a.entidade, a.alvos), '{}') INTO v_alvos FROM (
    SELECT m.entidade, v_apagar -> m.tabela AS alvos
      FROM (VALUES ('filial', 'filial'), ('vendedor', 'vendedor'), ('prazo_pagamento', 'condicao_pagamento'),
                   ('produto', 'produto'), ('produto_unidade', 'produto_unidade'), ('cliente', 'cliente'),
                   ('cliente_endereco', 'cliente_endereco')) AS m(entidade, tabela)
     WHERE v_apagar ? m.tabela
    UNION ALL
    SELECT 'forma_pagamento', jsonb_agg(jsonb_build_object('condicao_pagamento_id', i))
      FROM jsonb_array_elements_text(coalesce(v_apagar -> 'condicao_pagamento', '[]')) i HAVING count(*) > 0
    UNION ALL
    SELECT 'preco', jsonb_agg(DISTINCT jsonb_strip_nulls(jsonb_build_object('tabela_preco_id', x.tabela_preco_id,
             'filial_id', x.filial_id, 'produto_id', x.produto_id)))
      FROM cadastros.tabela_preco_item x
     WHERE x.tenant_id = v_t AND x.id = ANY (cadastros.portal_zerar_ids(v_apagar, 'tabela_preco_item')) HAVING count(*) > 0
    UNION ALL
    SELECT 'estoque', jsonb_agg(DISTINCT jsonb_build_object('filial_id', x.filial_id, 'produto_id', x.produto_id))
      FROM cadastros.estoque_saldo x
     WHERE x.tenant_id = v_t AND x.id = ANY (cadastros.portal_zerar_ids(v_apagar, 'estoque_saldo')) HAVING count(*) > 0) a;
  v_inativacao := integracao_fdv.portal_inativar_espelho(v_t, ARRAY(SELECT jsonb_object_keys(v_alvos)), v_alvos)
                    -> 'inativacao_fdv';

  -- (5) DELETE na ordem filho -> pai. Referência do próprio schema que ainda segura o registro = o estado mudou.
  --     O gatilho só de inserção do estoque_movimento é desligado só em volta do DELETE, nesta transação: o ALTER
  --     TABLE é transacional (um erro o desfaz junto), a função roda como dona da tabela e o gatilho volta ligado antes
  --     do fim; a trava ACCESS EXCLUSIVE que ele toma vale até o commit (o zerar é raro, só do superadmin, e só desliga
  --     quando há movimento a apagar).
  BEGIN
    FOREACH v_tab IN ARRAY ARRAY(SELECT t FROM unnest(v_tabelas) WITH ORDINALITY AS u(t, o) ORDER BY o DESC) LOOP
      CONTINUE WHEN NOT (v_apagar ? v_tab);
      v_ids := cadastros.portal_zerar_ids(v_apagar, v_tab);
      IF v_tab = 'estoque_movimento' AND cardinality(v_ids) > 0 THEN
        ALTER TABLE cadastros.estoque_movimento DISABLE TRIGGER somente_insercao;
      END IF;
      EXECUTE format('DELETE FROM cadastros.%I WHERE tenant_id = $1 AND id = ANY ($2)', v_tab) USING v_t, v_ids;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_tab = 'estoque_movimento' AND cardinality(v_ids) > 0 THEN
        ALTER TABLE cadastros.estoque_movimento ENABLE TRIGGER somente_insercao;
      END IF;
      v_apagados := v_apagados || jsonb_build_array(jsonb_build_object('tabela', v_tab, 'quantidade', v_n));
    END LOOP;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXC03', DETAIL = 'referencia', HINT = v_tab;
  END;

  -- (6) auditoria: quem, quando e as contagens (inativacao_fdv só quando há o que inativar); nunca id nem dado do cadastro
  v_out := jsonb_build_object('apagados', v_apagados, 'anulados', v_anulados)
        || CASE WHEN jsonb_array_length(v_inativacao) > 0 THEN jsonb_build_object('inativacao_fdv', v_inativacao)
                ELSE '{}'::jsonb END;
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'cadastros.dados.zerar', 'empresa', v_t, NULL, v_out, p_request_id);
  RETURN v_out;
END $$;
COMMENT ON FUNCTION cadastros.portal_zerar(uuid, jsonb, text) IS
  'Portal /config (0043, 0053, RN-CAD-10 emendada em 24/11/2026): aplica o plano do planoZeragem (domain) p_plano = {apagar: [{tabela, ids}], anular: [{tabela, coluna, ids}], em_uso: [{tabela, ids}]}; tabelas da lista fechada portal_zerar_tabelas e colunas de portal_zerar_anulaveis (fora delas ou do formato = check_violation). FOR UPDATE nos registros; id de apagar em em_uso, sumido, coluna a anular que já não aponta para um registro que sai, ou referência do schema cadastros que ainda segura o DELETE = MXC03 (DETAIL em_uso | sumiu | anular_fora_do_plano | referencia, HINT = tabela). Anula; antes do DELETE e na mesma transação, integracao_fdv.portal_inativar_espelho deixa inativo e pendente no espelho do FDV o que sai e já foi publicado (lote em voo numa entidade tocada = MXI03 lote_em_voo, HINT = entidade; a integração ligada não bloqueia; o espelho não é limpo e o cursor não volta ao início); depois apaga na ordem filho -> pai (DELETE de fato, exceção à RN-CAD-08), com o gatilho só de inserção do estoque_movimento desligado só nesta transação. Audita cadastros.dados.zerar só com as contagens. Devolve {apagados: [{tabela, quantidade}], anulados: [{tabela, coluna, quantidade}], inativacao_fdv?: [{entidade, quantidade}]} (inativacao_fdv só quando há pendente). Não toca faturamento nem fiscal (regra 7). MXS01, P0002, MXC04. Só macuxierp_config. T-0058, T-0086.';

COMMENT ON FUNCTION integracao_fdv.portal_zerar_espelho(uuid, text[], text) IS
  'Portal /config (0043, RN-CAD-10): desliga do UUID antigo o espelho das entidades do Hub pedidas (F2; senão check_violation), sem apagar nem inativar no FDV, e antecipa a agenda (o porquê: docs/banco/README.md). Entidade ligada ou com lote em voo = MXI03 (DETAIL entidade_ligada | lote_em_voo, HINT = entidade). Audita integracao-fdv.espelho.zerar só com as contagens. Devolve {entidades: [{entidade, registros}]}. Desde a 0053 o zerar usa a portal_inativar_espelho (chamada pelo cadastros.portal_zerar); esta fica só para a versão anterior da API (migração aditiva) e sai quando nenhuma versão a chamar. MXS01, P0002. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: as novas são internas (sem EXECUTE para ninguém; o cadastros.portal_zerar roda como dono). O
-- cadastros.portal_zerar mantém o EXECUTE só do macuxierp_config (CREATE OR REPLACE não muda o ACL).
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION integracao_fdv.json_canonico(jsonb), integracao_fdv.hash_registro(jsonb),
  integracao_fdv.portal_inativar_espelho(uuid, text[], jsonb), integracao_fdv.portal_inativar_linhas(uuid, uuid[])
  FROM PUBLIC;
