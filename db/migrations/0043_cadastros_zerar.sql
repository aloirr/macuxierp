-- 0043 — Zerar dados por cadastro pelo portal /config (T-0058, lote B; RN-CAD-10), no desenho final do
-- engenheiro-software: o banco só fornece os fatos e aplica o plano; a cascata, os "mantidos" e o que anular são
-- decididos no domain do cadastros (função pura planoZeragem). Aditiva e reexecutável: só GRANT USAGE, CREATE OR
-- REPLACE, REVOKE, GRANT e COMMENT; a migração não muda nenhuma linha de dado.
--
-- Oito funções do portal (SECURITY DEFINER, search_path fixo, EXECUTE só do macuxierp_config):
--   1. cadastros.portal_zeragem_fatos(uuid, text[]) -> jsonb
--   2. pedido.portal_usos_cadastros(uuid, jsonb) -> jsonb
--   3. faturamento.portal_usos_cadastros(uuid, jsonb) -> jsonb
--   4. integracao_fdv.portal_estado_entidades(uuid, text[]) -> jsonb
--   5. integracao_fdv.portal_zerar_espelho(uuid, text[], text) -> jsonb
--   6. cadastros.portal_zerar(uuid, jsonb, text) -> jsonb
--   7. core.portal_usos_filiais(uuid, uuid[]) -> jsonb
--   8. plataforma.portal_tirar_filiais_dos_usuarios(uuid, uuid[]) -> integer
-- Contrato, travas, listas fechadas e SQLSTATEs: docs/banco/README.md, seção "Zerar dados por cadastro (0043)".

GRANT USAGE ON SCHEMA cadastros, pedido, faturamento, core TO macuxierp_config;

-- ---------------------------------------------------------------------------------------------------------------
-- Internas do plataforma (sem EXECUTE para ninguém; só leem plataforma.tenant ou nada).
-- ---------------------------------------------------------------------------------------------------------------

-- p_refs = {chave: [uuid em texto]}, chaves de p_chaves (todas opcionais); senão check_violation. Único lugar da regex.
CREATE OR REPLACE FUNCTION plataforma.portal_refs_uuid(p_refs jsonb, p_chaves text[]) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_refs IS NULL OR jsonb_typeof(p_refs) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_each(p_refs) e
                 WHERE NOT (e.key = ANY (p_chaves))
                    OR CASE WHEN jsonb_typeof(e.value) = 'array' THEN EXISTS (
                         SELECT 1 FROM jsonb_array_elements(e.value) i
                          WHERE jsonb_typeof(i) <> 'string'
                             OR i #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
                         ELSE true END) THEN
    RAISE EXCEPTION 'referências fora do formato {%: [uuid]}', array_to_string(p_chaves, '|')
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
COMMENT ON FUNCTION plataforma.portal_refs_uuid(jsonb, text[]) IS
  'Interna (0043): p_refs é um objeto {chave: [uuid em texto]} só com chaves de p_chaves (todas opcionais); senão check_violation "referências fora do formato {a|b|...: [uuid]}". T-0058.';

-- Empresa alvo do portal travada só para leitura (FOR KEY SHARE: segura a exclusão sem brigar com o FOR UPDATE da
-- empresa_alvo); inexistente, de referência ou excluída = no_data_found. A situação e a licença ficam com quem chama.
CREATE OR REPLACE FUNCTION plataforma.empresa_alvo_leitura(p_tenant uuid) RETURNS plataforma.tenant
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  t plataforma.tenant;
BEGIN
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_tenant AND plataforma.empresa_visivel(x) FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN t;
END $$;
COMMENT ON FUNCTION plataforma.empresa_alvo_leitura(uuid) IS
  'Interna (0043): trava com FOR KEY SHARE e devolve a empresa alvo do portal (visível: não é a de referência nem excluída; senão no_data_found). Até o fim da transação. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Internas do cadastros (sem EXECUTE para ninguém).
-- ---------------------------------------------------------------------------------------------------------------

-- Espelho de CADASTROS_ZERAR_PORTAL (contracts do cadastros), na ordem da tela; forma_prazo = condicao_pagamento.
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_cadastros() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'forma_prazo', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente',
                     'cliente_endereco']::text[] $$;
COMMENT ON FUNCTION cadastros.portal_zerar_cadastros() IS
  'Interna (0043): lista fechada dos cadastros que o portal zera (espelho de CADASTROS_ZERAR_PORTAL; RN-CAD-10), na ordem da tela. T-0058.';

-- As 12 tabelas do zerar, na ordem pai -> filho das FKs do schema cadastros (o DELETE vai na ordem inversa).
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_tabelas() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'condicao_pagamento', 'tabela_preco', 'produto', 'cliente', 'produto_unidade',
                     'tabela_preco_item', 'estoque_saldo', 'estoque_movimento', 'cliente_endereco',
                     'cliente_contato']::text[] $$;
COMMENT ON FUNCTION cadastros.portal_zerar_tabelas() IS
  'Interna (0043): lista fechada das 12 tabelas do zerar (RN-CAD-10), na ordem pai -> filho das FKs; o DELETE do portal_zerar vai na ordem inversa. T-0058.';

-- Colunas anuláveis (tabela.coluna -> tabela apontada): as FKs NULL-áveis do schema cadastros para uma tabela apagável.
-- cliente.filial_id e vendedor.filial_id são NOT NULL (a filial só sai com eles); vendedor.usuario_id aponta para a
-- plataforma (não é apagável aqui).
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_anulaveis() RETURNS jsonb
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT '{"cliente.vendedor_id": "vendedor", "cliente.condicao_pagamento_id": "condicao_pagamento",
                 "cliente.tabela_preco_id": "tabela_preco"}'::jsonb $$;
COMMENT ON FUNCTION cadastros.portal_zerar_anulaveis() IS
  'Interna (0043): lista fechada das colunas que o plano pode anular ({"tabela.coluna": tabela apontada}): cliente.vendedor_id, cliente.condicao_pagamento_id e cliente.tabela_preco_id. T-0058.';

-- uuid[] de uma chave de um objeto {chave: [uuid, ...]} (sem a chave = vazio).
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_ids(p jsonb, p_chave text) RETURNS uuid[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT coalesce(ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p -> p_chave, '[]')) x
                               ORDER BY 1), '{}') $$;
COMMENT ON FUNCTION cadastros.portal_zerar_ids(jsonb, text) IS
  'Interna (0043): os uuid distintos e ordenados de p -> p_chave (lista vazia sem a chave). T-0058.';

-- O plano tem o formato {apagar: [{tabela, ids}], anular: [{tabela, coluna, ids}], em_uso: [{tabela, ids}]} (chaves
-- opcionais, nenhuma outra), com tabela das 12, "tabela.coluna" das anuláveis e ids = lista de uuid em texto?
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_plano_valido(p jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_chave text;
  v_lista jsonb;
  x jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN false;
  END IF;
  FOR v_chave, v_lista IN SELECT e.key, e.value FROM jsonb_each(p) e LOOP
    IF v_chave NOT IN ('apagar', 'anular', 'em_uso') OR jsonb_typeof(v_lista) <> 'array' THEN
      RETURN false;
    END IF;
    FOR x IN SELECT jsonb_array_elements(v_lista) LOOP
      IF jsonb_typeof(x) <> 'object' THEN
        RETURN false;
      END IF;
      IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k)
            IS DISTINCT FROM (CASE v_chave WHEN 'anular' THEN ARRAY['coluna', 'ids', 'tabela'] ELSE ARRAY['ids', 'tabela'] END)
         OR jsonb_typeof(x -> 'tabela') <> 'string' OR NOT (x ->> 'tabela' = ANY (cadastros.portal_zerar_tabelas()))
         OR jsonb_typeof(x -> 'ids') <> 'array' THEN
        RETURN false;
      END IF;
      IF v_chave = 'anular' AND (jsonb_typeof(x -> 'coluna') <> 'string'
         OR NOT (cadastros.portal_zerar_anulaveis() ? ((x ->> 'tabela') || '.' || (x ->> 'coluna')))) THEN
        RETURN false;
      END IF;
      BEGIN
        PERFORM plataforma.portal_refs_uuid(jsonb_build_object('ids', x -> 'ids'), ARRAY['ids']);
      EXCEPTION WHEN check_violation THEN
        RETURN false;
      END;
    END LOOP;
  END LOOP;
  RETURN true;
END $$;
COMMENT ON FUNCTION cadastros.portal_zerar_plano_valido(jsonb) IS
  'Interna (0043): o plano tem o formato {apagar: [{tabela, ids}], anular: [{tabela, coluna, ids}], em_uso: [{tabela, ids}]} (chaves opcionais, nenhuma outra), tabela de portal_zerar_tabelas, tabela.coluna de portal_zerar_anulaveis e ids só uuid em texto? T-0058.';

-- Conferência da empresa no molde da 0039, com o SQLSTATE do cadastros (MXC04) e a licença do módulo cadastros.
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_empresa(p_tenant uuid) RETURNS uuid
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
  IF NOT plataforma.modulo_licenciado(t.id, 'cadastros') THEN
    RAISE EXCEPTION 'módulo cadastros desligado na empresa' USING ERRCODE = 'MXC04', DETAIL = 'modulo_desligado';
  END IF;
  RETURN t.id;
END $$;
COMMENT ON FUNCTION cadastros.portal_zerar_empresa(uuid) IS
  'Interna (0043): confere a empresa alvo com FOR KEY SHARE (inexistente, de referência ou excluída = P0002; fora de ativo = MXC04 empresa_inativa; módulo cadastros sem licença ativa e vigente = MXC04 modulo_desligado). T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. cadastros.portal_zeragem_fatos: os fatos do schema cadastros para o planoZeragem do domain.
-- ---------------------------------------------------------------------------------------------------------------
-- Tabelas devolvidas (só as do alcance dos cadastros pedidos; dependências naturais = FKs do schema cadastros):
--   filial             <- filial
--   vendedor           <- vendedor; filial (vendedor.filial_id é NOT NULL)
--   condicao_pagamento <- forma_prazo
--   tabela_preco       <- preco
--   produto            <- produto
--   cliente            <- cliente; filial (filial_id NOT NULL); vendedor, forma_prazo e preco (só as linhas que
--                         apontam para eles, para o domain anular a coluna)
--   produto_unidade    <- produto_unidade; produto
--   tabela_preco_item  <- preco; produto; filial
--   estoque_saldo      <- estoque; produto; filial
--   estoque_movimento  <- estoque; produto; filial
--   cliente_endereco   <- cliente_endereco; cliente; filial (os clientes que podem sair)
--   cliente_contato    <- cliente; filial (os clientes que podem sair)
-- O cadastro pedido traz todas as linhas da empresa; a dependência traz só as linhas que apontam para as linhas
-- trazidas. Linhas com deleted_at também vêm (ainda seguram as FKs). Nenhum outro dado sai: id, refs (só as FKs não
-- nulas) e com_chave (external_id IS NOT NULL).
CREATE OR REPLACE FUNCTION cadastros.portal_zeragem_fatos(p_tenant uuid, p_cadastros text[]) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := cadastros.portal_zerar_empresa(p_tenant);
  c_fil boolean;
  c_ven boolean;
  c_for boolean;
  c_pro boolean;
  c_uni boolean;
  c_pre boolean;
  c_est boolean;
  c_cli boolean;
  c_end boolean;
  v_f uuid[] := '{}';
  v_v uuid[] := '{}';
  v_cp uuid[] := '{}';
  v_tp uuid[] := '{}';
  v_p uuid[] := '{}';
  v_c uuid[] := '{}';
  v_csai uuid[] := '{}';
  v_l jsonb;
  v_ids uuid[];
  v_out jsonb := '[]';
BEGIN
  IF p_cadastros IS NULL OR cardinality(p_cadastros) = 0 OR array_position(p_cadastros, NULL) IS NOT NULL
     OR NOT (p_cadastros <@ cadastros.portal_zerar_cadastros())
     OR cardinality(p_cadastros) <> (SELECT count(DISTINCT c) FROM unnest(p_cadastros) c) THEN
    RAISE EXCEPTION 'cadastros fora da lista, repetidos, nulos ou vazios' USING ERRCODE = 'check_violation';
  END IF;
  c_fil := 'filial' = ANY (p_cadastros);
  c_ven := 'vendedor' = ANY (p_cadastros);
  c_for := 'forma_prazo' = ANY (p_cadastros);
  c_pro := 'produto' = ANY (p_cadastros);
  c_uni := 'produto_unidade' = ANY (p_cadastros);
  c_pre := 'preco' = ANY (p_cadastros);
  c_est := 'estoque' = ANY (p_cadastros);
  c_cli := 'cliente' = ANY (p_cadastros);
  c_end := 'cliente_endereco' = ANY (p_cadastros);

  IF c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', '{}'::jsonb, 'com_chave', s.ch) ORDER BY s.id), '[]'),
           coalesce(array_agg(s.id), '{}') INTO v_l, v_f
      FROM (SELECT x.id, x.external_id IS NOT NULL AS ch FROM cadastros.filial x WHERE x.tenant_id = v_t FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'filial', 'linhas', v_l));
  END IF;

  IF c_ven OR c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('filial', s.filial_id),
             'com_chave', s.ch) ORDER BY s.id), '[]'), coalesce(array_agg(s.id), '{}') INTO v_l, v_v
      FROM (SELECT x.id, x.filial_id, x.external_id IS NOT NULL AS ch FROM cadastros.vendedor x
             WHERE x.tenant_id = v_t AND (c_ven OR x.filial_id = ANY (v_f)) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'vendedor', 'linhas', v_l));
  END IF;

  IF c_for THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', '{}'::jsonb, 'com_chave', s.ch) ORDER BY s.id), '[]'),
           coalesce(array_agg(s.id), '{}') INTO v_l, v_cp
      FROM (SELECT x.id, x.external_id IS NOT NULL AS ch FROM cadastros.condicao_pagamento x
             WHERE x.tenant_id = v_t FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'condicao_pagamento', 'linhas', v_l));
  END IF;

  IF c_pre THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', '{}'::jsonb, 'com_chave', s.ch) ORDER BY s.id), '[]'),
           coalesce(array_agg(s.id), '{}') INTO v_l, v_tp
      FROM (SELECT x.id, x.external_id IS NOT NULL AS ch FROM cadastros.tabela_preco x WHERE x.tenant_id = v_t FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'tabela_preco', 'linhas', v_l));
  END IF;

  IF c_pro THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', '{}'::jsonb, 'com_chave', s.ch) ORDER BY s.id), '[]'),
           coalesce(array_agg(s.id), '{}') INTO v_l, v_p
      FROM (SELECT x.id, x.external_id IS NOT NULL AS ch FROM cadastros.produto x WHERE x.tenant_id = v_t FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'produto', 'linhas', v_l));
  END IF;

  IF c_cli OR c_fil OR c_ven OR c_for OR c_pre THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_strip_nulls(jsonb_build_object(
             'filial', s.filial_id, 'vendedor', s.vendedor_id, 'condicao_pagamento', s.condicao_pagamento_id,
             'tabela_preco', s.tabela_preco_id)), 'com_chave', s.ch) ORDER BY s.id), '[]'),
           coalesce(array_agg(s.id), '{}'),
           coalesce(array_agg(s.id) FILTER (WHERE c_cli OR s.filial_id = ANY (v_f)), '{}')
      INTO v_l, v_c, v_csai
      FROM (SELECT x.id, x.filial_id, x.vendedor_id, x.condicao_pagamento_id, x.tabela_preco_id,
                   x.external_id IS NOT NULL AS ch
              FROM cadastros.cliente x
             WHERE x.tenant_id = v_t
               AND (c_cli OR x.filial_id = ANY (v_f) OR x.vendedor_id = ANY (v_v)
                    OR x.condicao_pagamento_id = ANY (v_cp) OR x.tabela_preco_id = ANY (v_tp))
             FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'cliente', 'linhas', v_l));
  END IF;

  IF c_uni OR c_pro THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('produto', s.produto_id),
             'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.produto_id, x.external_id IS NOT NULL AS ch FROM cadastros.produto_unidade x
             WHERE x.tenant_id = v_t AND (c_uni OR x.produto_id = ANY (v_p)) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'produto_unidade', 'linhas', v_l));
  END IF;

  IF c_pre OR c_pro OR c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('tabela_preco', s.tabela_preco_id,
             'filial', s.filial_id, 'produto', s.produto_id), 'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.tabela_preco_id, x.filial_id, x.produto_id, x.external_id IS NOT NULL AS ch
              FROM cadastros.tabela_preco_item x
             WHERE x.tenant_id = v_t AND (c_pre OR x.produto_id = ANY (v_p) OR x.filial_id = ANY (v_f)) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'tabela_preco_item', 'linhas', v_l));
  END IF;

  IF c_est OR c_pro OR c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('filial', s.filial_id,
             'produto', s.produto_id), 'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.filial_id, x.produto_id, x.external_id IS NOT NULL AS ch FROM cadastros.estoque_saldo x
             WHERE x.tenant_id = v_t AND (c_est OR x.produto_id = ANY (v_p) OR x.filial_id = ANY (v_f)) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'estoque_saldo', 'linhas', v_l));
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('filial', s.filial_id,
             'produto', s.produto_id), 'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.filial_id, x.produto_id, x.external_id IS NOT NULL AS ch FROM cadastros.estoque_movimento x
             WHERE x.tenant_id = v_t AND (c_est OR x.produto_id = ANY (v_p) OR x.filial_id = ANY (v_f)) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'estoque_movimento', 'linhas', v_l));
  END IF;

  IF c_end OR c_cli OR c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('cliente', s.cliente_id),
             'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.cliente_id, x.external_id IS NOT NULL AS ch FROM cadastros.cliente_endereco x
             WHERE x.tenant_id = v_t AND (c_end OR x.cliente_id = ANY (v_csai)) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'cliente_endereco', 'linhas', v_l));
  END IF;

  IF c_cli OR c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('cliente', s.cliente_id),
             'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.cliente_id, x.external_id IS NOT NULL AS ch FROM cadastros.cliente_contato x
             WHERE x.tenant_id = v_t AND x.cliente_id = ANY (v_csai) FOR SHARE) s;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'cliente_contato', 'linhas', v_l));
  END IF;

  RETURN jsonb_build_object('tabelas', v_out);
END $$;
COMMENT ON FUNCTION cadastros.portal_zeragem_fatos(uuid, text[]) IS
  'Portal /config (0043, RN-CAD-10): os fatos do schema cadastros para o planoZeragem do domain, só leitura com FOR SHARE nas linhas devolvidas. p_cadastros da lista fechada portal_zerar_cadastros (nulo, vazio, repetido ou fora dela = check_violation). Devolve {tabelas: [{tabela, linhas: [{id, refs: {produto?, filial?, cliente?, tabela_preco?, vendedor?, condicao_pagamento?}, com_chave}]}]}, nas tabelas do alcance (docs/banco/README.md), na ordem pai -> filho. MXS01, P0002, MXC04. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- 6. cadastros.portal_zerar: aplica o plano do domain.
-- ---------------------------------------------------------------------------------------------------------------
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

  -- (4) DELETE na ordem filho -> pai. Referência do próprio schema que ainda segura o registro = o estado mudou.
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

  -- (5) auditoria: quem, quando e as contagens; nunca id nem dado do cadastro
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'cadastros.dados.zerar', 'empresa', v_t, NULL,
    jsonb_build_object('apagados', v_apagados, 'anulados', v_anulados), p_request_id);
  RETURN jsonb_build_object('apagados', v_apagados, 'anulados', v_anulados);
END $$;
COMMENT ON FUNCTION cadastros.portal_zerar(uuid, jsonb, text) IS
  'Portal /config (0043, RN-CAD-10): aplica o plano do planoZeragem (domain) p_plano = {apagar: [{tabela, ids}], anular: [{tabela, coluna, ids}], em_uso: [{tabela, ids}]}; tabelas da lista fechada portal_zerar_tabelas e colunas de portal_zerar_anulaveis (fora delas ou do formato = check_violation). FOR UPDATE nos registros; id de apagar em em_uso, sumido, coluna a anular que já não aponta para um registro que sai, ou referência do schema cadastros que ainda segura o DELETE = MXC03 (DETAIL em_uso | sumiu | anular_fora_do_plano | referencia, HINT = tabela). Anula e depois apaga na ordem filho -> pai (DELETE de fato, exceção à RN-CAD-08), com o gatilho só de inserção do estoque_movimento desligado só nesta transação. Audita cadastros.dados.zerar só com as contagens. Devolve {apagados: [{tabela, quantidade}], anulados: [{tabela, coluna, quantidade}]}. Não toca faturamento nem fiscal (regra 7). MXS01, P0002, MXC04. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- 2. pedido.portal_usos_cadastros: quais cadastros pedidos estão em pedido.
-- ---------------------------------------------------------------------------------------------------------------
-- p_refs = {filial, vendedor, condicao_pagamento, tabela_preco, produto, cliente: [uuid]} (todas opcionais; outra chave
-- ou valor que não seja lista = check_violation). A mesma p_refs serve ao faturamento.portal_usos_cadastros.
CREATE OR REPLACE FUNCTION pedido.portal_usos_cadastros(p_tenant uuid, p_refs jsonb) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid;
  v_out jsonb := '[]';
  v_k text;
  v_ids uuid[];
  v_uso uuid[];
BEGIN
  v_t := (plataforma.empresa_alvo_leitura(p_tenant)).id;
  PERFORM plataforma.portal_refs_uuid(p_refs, ARRAY['filial', 'vendedor', 'condicao_pagamento', 'tabela_preco', 'produto', 'cliente']);
  FOREACH v_k IN ARRAY ARRAY['filial', 'vendedor', 'condicao_pagamento', 'tabela_preco', 'produto', 'cliente'] LOOP
    v_ids := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_refs -> v_k, '[]')) x);
    CONTINUE WHEN cardinality(v_ids) = 0;
    IF v_k = 'produto' THEN
      SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_uso
        FROM (SELECT i.produto_id AS r FROM pedido.pedido_item i
               WHERE i.tenant_id = v_t AND i.produto_id = ANY (v_ids) FOR SHARE) s;
    ELSE
      EXECUTE format('SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), ''{}'') FROM (SELECT p.%1$I AS r FROM pedido.pedido p'
                     ' WHERE p.tenant_id = $1 AND p.%1$I = ANY ($2) FOR SHARE) s', v_k || '_id')
        INTO v_uso USING v_t, v_ids;
    END IF;
    IF cardinality(v_uso) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', v_k, 'ids', to_jsonb(v_uso), 'motivo', 'pedido'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('em_uso', v_out);
END $$;
COMMENT ON FUNCTION pedido.portal_usos_cadastros(uuid, jsonb) IS
  'Portal /config (0043, RN-CAD-10): dos cadastros em p_refs ({filial, vendedor, condicao_pagamento, tabela_preco, produto, cliente: [uuid]}), os que estão em pedido (pedido.pedido e, no produto, pedido.pedido_item; inclusive linhas com deleted_at), com FOR SHARE nas linhas que referenciam. Devolve {em_uso: [{tabela, ids, motivo: "pedido"}]} (só as tabelas com uso). Só lê. MXS01, P0002; formato errado = check_violation. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. faturamento.portal_usos_cadastros: quais cadastros pedidos estão em título ou nota; filiais com algo fiscal.
-- ---------------------------------------------------------------------------------------------------------------
-- Nota: filial e cliente (faturamento.nota) e produto (faturamento.nota_item); título: filial e cliente. "Filial com
-- nota" = a filial pedida com qualquer linha fiscal: nota, serie_numeracao, inutilizacao, contingencia,
-- configuracao_filial ou configuracao_filial_historico. FOR SHARE na nota, no item e no título; FOR KEY SHARE nas
-- demais (segura o DELETE sem barrar a reserva de número nem a emissão da filial). O pedido_a_faturar não entra: ele
-- só existe com o pedido, que o pedido.portal_usos_cadastros já devolve.
CREATE OR REPLACE FUNCTION faturamento.portal_usos_cadastros(p_tenant uuid, p_refs jsonb) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid;
  v_f uuid[];
  v_c uuid[];
  v_p uuid[];
  v_uso uuid[];
  v_fiscal uuid[] := '{}';
  v_out jsonb := '[]';
BEGIN
  v_t := (plataforma.empresa_alvo_leitura(p_tenant)).id;
  PERFORM plataforma.portal_refs_uuid(p_refs, ARRAY['filial', 'vendedor', 'condicao_pagamento', 'tabela_preco', 'produto', 'cliente']);
  v_f := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_refs -> 'filial', '[]')) x);
  v_c := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_refs -> 'cliente', '[]')) x);
  v_p := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(coalesce(p_refs -> 'produto', '[]')) x);

  IF cardinality(v_f) > 0 THEN
    -- filial com nota (qualquer linha fiscal)
    -- (o FOR SHARE/FOR KEY SHARE não vale direto num UNION: cada parte trava no próprio subselect)
    SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_fiscal FROM (
      SELECT a.r FROM (SELECT n.filial_id AS r FROM faturamento.nota n
                        WHERE n.tenant_id = v_t AND n.filial_id = ANY (v_f) FOR SHARE) a
      UNION ALL
      SELECT a.r FROM (SELECT x.filial_id AS r FROM faturamento.serie_numeracao x
                        WHERE x.tenant_id = v_t AND x.filial_id = ANY (v_f) FOR KEY SHARE) a
      UNION ALL
      SELECT a.r FROM (SELECT x.filial_id AS r FROM faturamento.inutilizacao x
                        WHERE x.tenant_id = v_t AND x.filial_id = ANY (v_f) FOR KEY SHARE) a
      UNION ALL
      SELECT a.r FROM (SELECT x.filial_id AS r FROM faturamento.contingencia x
                        WHERE x.tenant_id = v_t AND x.filial_id = ANY (v_f) FOR KEY SHARE) a
      UNION ALL
      SELECT a.r FROM (SELECT x.filial_id AS r FROM faturamento.configuracao_filial x
                        WHERE x.tenant_id = v_t AND x.filial_id = ANY (v_f) FOR KEY SHARE) a
      UNION ALL
      SELECT a.r FROM (SELECT x.filial_id AS r FROM faturamento.configuracao_filial_historico x
                        WHERE x.tenant_id = v_t AND x.filial_id = ANY (v_f) FOR KEY SHARE) a) s;
    IF cardinality(v_fiscal) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'filial', 'ids', to_jsonb(v_fiscal), 'motivo', 'nota'));
    END IF;
    SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_uso
      FROM (SELECT x.filial_id AS r FROM faturamento.titulo x WHERE x.tenant_id = v_t AND x.filial_id = ANY (v_f) FOR SHARE) s;
    IF cardinality(v_uso) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'filial', 'ids', to_jsonb(v_uso), 'motivo', 'titulo'));
    END IF;
  END IF;

  IF cardinality(v_p) > 0 THEN
    SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_uso
      FROM (SELECT i.produto_id AS r FROM faturamento.nota_item i WHERE i.tenant_id = v_t AND i.produto_id = ANY (v_p) FOR SHARE) s;
    IF cardinality(v_uso) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'produto', 'ids', to_jsonb(v_uso), 'motivo', 'nota'));
    END IF;
  END IF;

  IF cardinality(v_c) > 0 THEN
    SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_uso
      FROM (SELECT n.cliente_id AS r FROM faturamento.nota n WHERE n.tenant_id = v_t AND n.cliente_id = ANY (v_c) FOR SHARE) s;
    IF cardinality(v_uso) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'cliente', 'ids', to_jsonb(v_uso), 'motivo', 'nota'));
    END IF;
    SELECT coalesce(array_agg(DISTINCT s.r ORDER BY s.r), '{}') INTO v_uso
      FROM (SELECT x.cliente_id AS r FROM faturamento.titulo x WHERE x.tenant_id = v_t AND x.cliente_id = ANY (v_c) FOR SHARE) s;
    IF cardinality(v_uso) > 0 THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('tabela', 'cliente', 'ids', to_jsonb(v_uso), 'motivo', 'titulo'));
    END IF;
  END IF;

  RETURN jsonb_build_object('em_uso', v_out, 'filiais_com_nota', to_jsonb(v_fiscal));
END $$;
COMMENT ON FUNCTION faturamento.portal_usos_cadastros(uuid, jsonb) IS
  'Portal /config (0043, RN-CAD-10): dos cadastros em p_refs (o mesmo formato do pedido.portal_usos_cadastros), os que estão em nota (filial e cliente da nota, produto do item) ou título (filial e cliente), e as filiais pedidas com qualquer linha fiscal (nota, série, inutilização, contingência, configuração fiscal e o histórico dela). Devolve {em_uso: [{tabela, ids, motivo: "nota" | "titulo"}], filiais_com_nota: [uuid]}. Só lê: FOR SHARE na nota, no item e no título; FOR KEY SHARE nas demais. MXS01, P0002; formato errado = check_violation. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- 4 e 5. Integração FDV: estado das entidades e espelho zerado.
-- ---------------------------------------------------------------------------------------------------------------

-- Entidades do Hub (nomes de integracao_fdv.entidade_hub) da F2, sem nulo nem repetição; senão check_violation.
CREATE OR REPLACE FUNCTION integracao_fdv.portal_conferir_entidades(p_entidades text[]) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_entidades IS NULL OR array_position(p_entidades, NULL) IS NOT NULL
     OR NOT (p_entidades <@ integracao_fdv.portal_entidades_f2())
     OR cardinality(p_entidades) <> (SELECT count(DISTINCT e) FROM unnest(p_entidades) e) THEN
    RAISE EXCEPTION 'entidades fora da F2, repetidas ou nulas' USING ERRCODE = 'check_violation';
  END IF;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_conferir_entidades(text[]) IS
  'Interna (0043): entidades só da F2 (portal_entidades_f2), sem nulo nem repetição (lista vazia vale); senão check_violation. T-0058.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_estado_entidades(p_tenant uuid, p_entidades text[]) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_c integracao_fdv.credencial;
BEGIN
  PERFORM integracao_fdv.portal_conferir_entidades(p_entidades);
  v_c := integracao_fdv.portal_credencial_ativa(v_t, false, false);
  RETURN jsonb_build_object('entidades', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'entidade', e.e,
             'ligada', v_c.id IS NOT NULL AND coalesce(e.e::integracao_fdv.entidade_hub = ANY (v_c.entidades_habilitadas), false),
             'lote_em_voo', integracao_fdv.portal_lote_em_voo(v_t, e.e::integracao_fdv.entidade_hub)) ORDER BY e.o)
      FROM unnest(p_entidades) WITH ORDINALITY AS e(e, o)), '[]'));
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_estado_entidades(uuid, text[]) IS
  'Portal /config (0043, RN-CAD-10): para cada entidade do Hub pedida (F2; nula, repetida ou fora = check_violation), {entidade, ligada (credencial ativa com a entidade habilitada, como o portal_ler), lote_em_voo (portal_lote_em_voo)}, na ordem pedida: {entidades: [...]}. Só lê. MXS01, P0002 (não exige licença: a leitura vale para qualquer empresa visível). Só macuxierp_config. T-0058.';

-- O porquê do desligamento sem apagar nem anular o payload: docs/banco/README.md, seção "Zerar dados por cadastro (0043)".
CREATE OR REPLACE FUNCTION integracao_fdv.portal_zerar_espelho(p_tenant uuid, p_entidades text[], p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_c integracao_fdv.credencial;
  v_e text;
  v_n integer;
  v_out jsonb := '[]';
  v_zerados text[];
BEGIN
  PERFORM integracao_fdv.portal_conferir_entidades(p_entidades);
  IF cardinality(p_entidades) = 0 THEN
    RETURN jsonb_build_object('entidades', '[]'::jsonb);
  END IF;
  -- travas na ordem da 0038: sinal -> credencial -> cursor_entidade -> registro_publicado
  PERFORM 1 FROM integracao_fdv.sinal s WHERE s.tenant_id = v_t FOR UPDATE;
  v_c := integracao_fdv.portal_credencial_ativa(v_t, true, false);
  PERFORM 1 FROM integracao_fdv.cursor_entidade k
   WHERE k.tenant_id = v_t AND k.entidade::text = ANY (p_entidades) ORDER BY k.entidade, k.id FOR UPDATE;
  -- reconfere o que o domain leu no portal_estado_entidades
  FOREACH v_e IN ARRAY p_entidades LOOP
    IF v_c.id IS NOT NULL AND v_e::integracao_fdv.entidade_hub = ANY (v_c.entidades_habilitadas) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'entidade_ligada', HINT = v_e;
    END IF;
    IF integracao_fdv.portal_lote_em_voo(v_t, v_e::integracao_fdv.entidade_hub) THEN
      RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'lote_em_voo', HINT = v_e;
    END IF;
  END LOOP;
  PERFORM 1 FROM integracao_fdv.registro_publicado r
   WHERE r.tenant_id = v_t AND r.entidade::text = ANY (p_entidades) ORDER BY r.id FOR UPDATE;

  FOREACH v_e IN ARRAY p_entidades LOOP
    UPDATE integracao_fdv.registro_publicado r
       SET erp_id = NULL,
           hash_confirmado = CASE WHEN r.payload IS NULL THEN r.hash_confirmado END,
           confirmado_em = CASE WHEN r.payload IS NULL THEN r.confirmado_em END
     WHERE r.tenant_id = v_t AND r.entidade = v_e::integracao_fdv.entidade_hub;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_array(jsonb_build_object('entidade', v_e, 'registros', v_n));
  END LOOP;

  WITH z AS (
    UPDATE integracao_fdv.cursor_entidade SET cursor_alterado_em = NULL, cursor_external_id = NULL, sessao_aberta_id = NULL
     WHERE tenant_id = v_t AND entidade::text = ANY (p_entidades) AND deleted_at IS NULL
    RETURNING entidade::text AS entidade)
  SELECT coalesce(array_agg(z.entidade ORDER BY z.entidade), '{}') INTO v_zerados FROM z;
  PERFORM integracao_fdv.portal_antecipar(v_t, v_zerados);

  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.espelho.zerar', 'empresa', v_t, NULL,
    jsonb_build_object('entidades', v_out), p_request_id);
  RETURN jsonb_build_object('entidades', v_out);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_zerar_espelho(uuid, text[], text) IS
  'Portal /config (0043, RN-CAD-10): desliga do UUID antigo o espelho das entidades do Hub pedidas (F2; senão check_violation), sem apagar nem inativar no FDV, e antecipa a agenda (o porquê: docs/banco/README.md). Entidade ligada ou com lote em voo = MXI03 (DETAIL entidade_ligada | lote_em_voo, HINT = entidade). Audita integracao-fdv.espelho.zerar só com as contagens. Devolve {entidades: [{entidade, registros}]}. MXS01, P0002. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- 7 e 8. Filial: usos no core e filial_ids dos usuários (o core e a plataforma também guardam filial_id, sem FK).
-- ---------------------------------------------------------------------------------------------------------------
-- core.certificado.filial_id e core.aviso_a1.filial_id são NOT NULL (0003, 0009): não há certificado de empresa sem filial.
CREATE OR REPLACE FUNCTION core.portal_usos_filiais(p_tenant uuid, p_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid;
  v_uso uuid[];
BEGIN
  v_t := (plataforma.empresa_alvo_leitura(p_tenant)).id;
  IF p_ids IS NULL THEN
    RAISE EXCEPTION 'lista de filiais nula' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(array_agg(DISTINCT u.r ORDER BY u.r), '{}') INTO v_uso FROM (
    SELECT s.r FROM (SELECT x.filial_id AS r FROM core.certificado x
                      WHERE x.tenant_id = v_t AND x.filial_id = ANY (p_ids) FOR SHARE) s
    UNION ALL
    SELECT s.r FROM (SELECT x.filial_id AS r FROM core.aviso_a1 x
                      WHERE x.tenant_id = v_t AND x.filial_id = ANY (p_ids) FOR SHARE) s
    UNION ALL
    SELECT s.r FROM (SELECT x.filial_id AS r FROM core.ambiente_fiscal x
                      WHERE x.tenant_id = v_t AND x.filial_id = ANY (p_ids) FOR SHARE) s) u;
  RETURN jsonb_build_object('em_uso', CASE WHEN cardinality(v_uso) = 0 THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('tabela', 'filial', 'ids', to_jsonb(v_uso), 'motivo', 'fiscal')) END);
END $$;
COMMENT ON FUNCTION core.portal_usos_filiais(uuid, uuid[]) IS
  'Portal /config (0043, RN-CAD-10): das filiais em p_ids, as que têm core.certificado, core.aviso_a1 ou core.ambiente_fiscal (inclusive linhas com deleted_at), com FOR SHARE nelas. Devolve {em_uso: [{tabela: "filial", ids, motivo: "fiscal"}]} (vazio sem uso). Só lê. MXS01, P0002; p_ids nulo = check_violation. Só macuxierp_config. T-0058.';

-- FOR UPDATE nos usuários em ordem de id (sem deadlock entre dois zerar); o updated_at vem do gatilho tocar_updated_at.
CREATE OR REPLACE FUNCTION plataforma.portal_tirar_filiais_dos_usuarios(p_tenant uuid, p_ids uuid[]) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid;
  v_ids uuid[] := array_remove(p_ids, NULL);
  v_n integer;
BEGIN
  v_t := (plataforma.empresa_alvo_leitura(p_tenant)).id;
  IF p_ids IS NULL THEN
    RAISE EXCEPTION 'lista de filiais nula' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM plataforma.usuario u WHERE u.tenant_id = v_t AND u.filial_ids && v_ids ORDER BY u.id FOR UPDATE;
  UPDATE plataforma.usuario u
     SET filial_ids = ARRAY(SELECT f FROM unnest(u.filial_ids) WITH ORDINALITY AS x(f, o)
                       WHERE NOT coalesce(f = ANY (v_ids), false) ORDER BY o)
   WHERE u.tenant_id = v_t AND u.filial_ids && v_ids;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION plataforma.portal_tirar_filiais_dos_usuarios(uuid, uuid[]) IS
  'Portal /config (0043, RN-CAD-10): tira as filiais de p_ids do plataforma.usuario.filial_ids (uuid[]) dos usuários da empresa (inclusive com deleted_at), mantendo as outras na ordem; devolve quantos usuários mudaram. Só no efeito do zerar, antes do cadastros.portal_zerar. Não audita (a auditoria do zerar tem as contagens). MXS01, P0002; p_ids nulo = check_violation. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; as internas sem EXECUTE; as oito do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION cadastros.portal_zerar_cadastros(), cadastros.portal_zerar_tabelas(),
  cadastros.portal_zerar_anulaveis(), cadastros.portal_zerar_ids(jsonb, text), cadastros.portal_zerar_plano_valido(jsonb),
  cadastros.portal_zerar_empresa(uuid), plataforma.portal_refs_uuid(jsonb, text[]), plataforma.empresa_alvo_leitura(uuid),
  cadastros.portal_zeragem_fatos(uuid, text[]), cadastros.portal_zerar(uuid, jsonb, text),
  pedido.portal_usos_cadastros(uuid, jsonb), faturamento.portal_usos_cadastros(uuid, jsonb),
  integracao_fdv.portal_conferir_entidades(text[]), integracao_fdv.portal_estado_entidades(uuid, text[]),
  integracao_fdv.portal_zerar_espelho(uuid, text[], text), core.portal_usos_filiais(uuid, uuid[]),
  plataforma.portal_tirar_filiais_dos_usuarios(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.portal_zeragem_fatos(uuid, text[]), cadastros.portal_zerar(uuid, jsonb, text),
  pedido.portal_usos_cadastros(uuid, jsonb), faturamento.portal_usos_cadastros(uuid, jsonb),
  integracao_fdv.portal_estado_entidades(uuid, text[]), integracao_fdv.portal_zerar_espelho(uuid, text[], text),
  core.portal_usos_filiais(uuid, uuid[]), plataforma.portal_tirar_filiais_dos_usuarios(uuid, uuid[]) TO macuxierp_config;
