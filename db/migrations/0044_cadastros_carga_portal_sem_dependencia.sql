-- 0044 — Carga do portal /config sem dependência entre cadastros e lista de 8 cadastros (T-0058, v0.3.6).
-- Substitui o MXC03 da 0040 (cadastros.portal_carga_iniciar não recusa mais por dependência pendente).
--
-- Decisão (Alexandre/PO, 23/11/2026 16h08 de Manaus; nomes do engenheiro-software às 16h18): nenhuma carga depende de
-- outra, e a lista do portal passa de 10 para 8 (lista e ordem em cadastros.portal_carga_cadastros()). O "Zerar dados"
-- da 0043 passa aos mesmos 8 nomes (cadastros.portal_zerar_cadastros e cadastros.portal_zeragem_fatos, no fim).
--
-- Aditiva e reexecutável: CREATE OR REPLACE, DROP ... IF EXISTS + ADD do CHECK, DROP FUNCTION IF EXISTS, REVOKE, GRANT e
-- COMMENT. Não muda nenhuma linha de dado: as execuções já gravadas com 'forma_pagamento', 'prazo_pagamento' ou
-- 'cliente_endereco' ficam como estão (o histórico não se reescreve) e continuam válidas no CHECK.

-- Interna (sem EXECUTE para ninguém): os nomes que saíram da lista, só para as execuções já gravadas.
CREATE OR REPLACE FUNCTION cadastros.portal_carga_cadastros_legados() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['forma_pagamento', 'prazo_pagamento', 'cliente_endereco']::text[] $$;
COMMENT ON FUNCTION cadastros.portal_carga_cadastros_legados() IS
  'Interna (0044): os nomes que saíram da carga do portal (forma_pagamento e prazo_pagamento viraram condicao_pagamento; cliente_endereco entrou em cliente). Só para as execuções já gravadas: o CHECK de cadastros.carga_portal os aceita; a portal_carga_iniciar não. T-0058.';

-- O CHECK antigo sai antes de a lista mudar (o novo entra logo abaixo da lista).
ALTER TABLE cadastros.carga_portal DROP CONSTRAINT IF EXISTS carga_portal_cadastro_check;

-- Interna: a lista dos 8 cadastros num lugar só, na ordem da carga (espelho de CADASTROS_CARGA_PORTAL do SDK).
CREATE OR REPLACE FUNCTION cadastros.portal_carga_cadastros() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque',
                     'cliente']::text[] $$;
COMMENT ON FUNCTION cadastros.portal_carga_cadastros() IS
  'Interna (0040, lista da 0044): os 8 cadastros da carga do portal na ordem (espelho de CADASTROS_CARGA_PORTAL do SDK); o CHECK de cadastros.carga_portal aceita estes e os de portal_carga_cadastros_legados; o teste da 0040 trava a lista. T-0058.';

-- O CHECK passa a aceitar os 8 novos e os 3 legados (ADD com o mesmo nome, depois da lista nova:
-- as linhas existentes já cabem, mesmo se a 0040 for reexecutada antes desta).
ALTER TABLE cadastros.carga_portal ADD CONSTRAINT carga_portal_cadastro_check
  CHECK (cadastro = ANY (cadastros.portal_carga_cadastros() || cadastros.portal_carga_cadastros_legados()));

-- Ativos do cadastro no tenant (filtro explícito de tenant: roda como dona, fora da RLS). O único mapeamento
-- cadastro -> tabela do banco; os nomes legados não têm contagem (NULL, como qualquer nome fora da lista).
CREATE OR REPLACE FUNCTION cadastros.portal_carga_ativos(p_tenant uuid, p_cadastro text) RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RETURN CASE p_cadastro
    WHEN 'filial' THEN (SELECT count(*) FROM cadastros.filial x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'vendedor' THEN (SELECT count(*) FROM cadastros.vendedor x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'condicao_pagamento' THEN (SELECT count(*) FROM cadastros.condicao_pagamento x
                                     WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'produto' THEN (SELECT count(*) FROM cadastros.produto x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'produto_unidade' THEN (SELECT count(*) FROM cadastros.produto_unidade x
                                  WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'preco' THEN (SELECT count(*) FROM cadastros.tabela_preco_item x
                        WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'estoque' THEN (SELECT count(*) FROM cadastros.estoque_saldo x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'cliente' THEN (SELECT count(*) FROM cadastros.cliente x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
  END::integer;
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_ativos(uuid, text) IS
  'Interna (0040, mapeamento da 0044): registros ativos (deleted_at nulo) do cadastro no tenant; condicao_pagamento conta as condições ativas; NULL fora da lista (inclusive os nomes legados). T-0058.';

-- A última execução concluída do cadastro (o chip "N com erro" e a "última carga"), contando os nomes legados que o
-- cadastro absorveu.
CREATE OR REPLACE FUNCTION cadastros.portal_carga_ultima(p_tenant uuid, p_cadastro text) RETURNS cadastros.carga_portal
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT x.* FROM cadastros.carga_portal x
   WHERE x.tenant_id = p_tenant AND x.resultado = 'concluida' AND x.deleted_at IS NULL
     AND x.cadastro = ANY (CASE p_cadastro
                             WHEN 'condicao_pagamento' THEN ARRAY['condicao_pagamento', 'forma_pagamento', 'prazo_pagamento']
                             WHEN 'cliente' THEN ARRAY['cliente', 'cliente_endereco']
                             ELSE ARRAY[p_cadastro]
                           END::text[])
   ORDER BY x.concluida_em DESC, x.id DESC LIMIT 1
$$;
COMMENT ON FUNCTION cadastros.portal_carga_ultima(uuid, text) IS
  'Interna (0040, legados da 0044): a última execução com resultado concluida do cadastro no tenant (ou nula); a de condicao_pagamento considera também forma_pagamento e prazo_pagamento, e a de cliente, cliente_endereco. T-0058.';

-- Portal /config (EXECUTE só do macuxierp_config): igual à 0040, sem a dependência (MXC03 sai).
CREATE OR REPLACE FUNCTION cadastros.portal_carga_iniciar(p_tenant uuid, p_cadastro text, p_modo text, p_request_id text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  v_id uuid;
BEGIN
  -- trava a empresa: serializa os iniciares concorrentes da mesma empresa (FOR NO KEY UPDATE, ver a 0040)
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_tenant AND plataforma.empresa_visivel(x) FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.situacao <> 'ativo' THEN
    RAISE EXCEPTION 'empresa fora de ativo' USING ERRCODE = 'MXC04', DETAIL = 'empresa_inativa';
  END IF;
  IF NOT plataforma.modulo_licenciado(t.id, 'cadastros') THEN
    RAISE EXCEPTION 'módulo cadastros desligado na empresa' USING ERRCODE = 'MXC04', DETAIL = 'modulo_desligado';
  END IF;
  -- só os 8 da lista: os nomes legados não abrem execução nova
  IF p_cadastro IS NULL OR NOT (p_cadastro = ANY (cadastros.portal_carga_cadastros())) THEN
    RAISE EXCEPTION 'cadastro fora da carga do portal' USING ERRCODE = 'check_violation';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('adicionar', 'substituir_tudo') THEN
    RAISE EXCEPTION 'modo fora do contrato' USING ERRCODE = 'check_violation';
  END IF;
  -- uma carga por vez na empresa: a aberta há 15 min ou mais é abandonada; a mais nova barra
  UPDATE cadastros.carga_portal SET resultado = 'abandonada', concluida_em = now()
   WHERE tenant_id = t.id AND resultado IS NULL AND iniciada_em <= now() - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM cadastros.carga_portal x WHERE x.tenant_id = t.id AND x.resultado IS NULL) THEN
    RAISE EXCEPTION 'carga em andamento nesta empresa' USING ERRCODE = 'MXC01', DETAIL = 'carga_em_andamento';
  END IF;
  INSERT INTO cadastros.carga_portal (tenant_id, cadastro, modo, superadmin_id, request_id)
    VALUES (t.id, p_cadastro, p_modo, v_sa, p_request_id) RETURNING id INTO v_id;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'cadastros.carga.iniciar', 'carga_portal', v_id, NULL,
    jsonb_build_object('cadastro', p_cadastro, 'modo', p_modo), p_request_id);
  RETURN v_id;
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_iniciar(uuid, text, text, text) IS
  'Portal /config (0040, sem dependência desde a 0044): tx1 do Gravar da carga. Trava a empresa (P0002 se não visível); MXC04 (DETAIL empresa_inativa | modulo_desligado); cadastro fora dos 8 (inclusive os legados) ou modo fora do contrato = check_violation; MXC01 (DETAIL carga_em_andamento) com execução aberta há menos de 15 min (a mais antiga vira abandonada); abre a execução, audita cadastros.carga.iniciar e devolve o id. Nenhuma carga depende de outra. Só macuxierp_config. T-0058.';

-- Sem uso depois da portal_carga_iniciar acima.
DROP FUNCTION IF EXISTS cadastros.portal_carga_dependencias(text);

COMMENT ON FUNCTION cadastros.portal_carga_situacao(uuid) IS
  'Portal /config (0040, lista da 0044): a aba Cargas, crua: {empresa_id, modulo_licenciado, cadastros: [8 na ordem de CADASTROS_CARGA_PORTAL: {cadastro, ativos, erros (com_erro da última concluída), ultima_carga {em, quantidade} | null}]}; a última concluída de condicao_pagamento e de cliente considera os nomes legados que absorveram. Empresa não visível = P0002. Sem auditoria. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Zerar dados (0043) nos mesmos 8 nomes (RN-CAD-10; espelho de CADASTROS_ZERAR_PORTAL do SDK, igual à carga).
-- Mesma regra da 0043, só os nomes mudam: forma_prazo vira condicao_pagamento (a mesma tabela condicao_pagamento) e
-- cliente_endereco entra em cliente (cliente traz cliente, cliente_endereco e cliente_contato dos clientes que saem,
-- o que já valia para o cliente na 0043). As tabelas do plano, as anuláveis e a portal_zerar não mudam (falam de
-- tabela, não de cadastro). Os nomes antigos passam a ser check_violation na portal_zeragem_fatos.
-- ---------------------------------------------------------------------------------------------------------------

-- Interna (sem EXECUTE para ninguém): a lista fechada do zerar, na ordem da tela.
CREATE OR REPLACE FUNCTION cadastros.portal_zerar_cadastros() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque',
                     'cliente']::text[] $$;
COMMENT ON FUNCTION cadastros.portal_zerar_cadastros() IS
  'Interna (0043, lista da 0044): lista fechada dos 8 cadastros que o portal zera (espelho de CADASTROS_ZERAR_PORTAL, os mesmos 8 da carga; RN-CAD-10), na ordem da tela. T-0058.';

-- Portal /config: os fatos do schema cadastros para o planoZeragem do domain (alcance da 0043 com os 8 nomes):
--   condicao_pagamento <- condicao_pagamento
--   cliente            <- cliente; filial (filial_id NOT NULL); vendedor, condicao_pagamento e preco (só as linhas que
--                         apontam para eles, para o domain anular a coluna)
--   cliente_endereco   <- cliente; filial (os clientes que podem sair)
--   cliente_contato    <- cliente; filial (os clientes que podem sair)
-- As demais tabelas seguem a 0043 sem mudança.
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
  c_for := 'condicao_pagamento' = ANY (p_cadastros);
  c_pro := 'produto' = ANY (p_cadastros);
  c_uni := 'produto_unidade' = ANY (p_cadastros);
  c_pre := 'preco' = ANY (p_cadastros);
  c_est := 'estoque' = ANY (p_cadastros);
  c_cli := 'cliente' = ANY (p_cadastros);

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

  IF c_cli OR c_fil THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'refs', jsonb_build_object('cliente', s.cliente_id),
             'com_chave', s.ch) ORDER BY s.id), '[]') INTO v_l
      FROM (SELECT x.id, x.cliente_id, x.external_id IS NOT NULL AS ch FROM cadastros.cliente_endereco x
             WHERE x.tenant_id = v_t AND x.cliente_id = ANY (v_csai) FOR SHARE) s;
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
  'Portal /config (0043, nomes da 0044, RN-CAD-10): os fatos do schema cadastros para o planoZeragem do domain, só leitura com FOR SHARE nas linhas devolvidas. p_cadastros da lista fechada portal_zerar_cadastros, os 8 da carga (nulo, vazio, repetido ou fora dela, inclusive forma_prazo e cliente_endereco = check_violation). condicao_pagamento traz a tabela condicao_pagamento; cliente traz cliente, cliente_endereco e cliente_contato. Devolve {tabelas: [{tabela, linhas: [{id, refs: {produto?, filial?, cliente?, tabela_preco?, vendedor?, condicao_pagamento?}, com_chave}]}]}, nas tabelas do alcance (docs/banco/README.md), na ordem pai -> filho. MXS01, P0002, MXC04. Só macuxierp_config. T-0058.';

-- Privilégios: nada para PUBLIC; internas sem EXECUTE; portal só do config (o mesmo estado da 0040 e da 0043).
REVOKE ALL ON FUNCTION cadastros.portal_carga_cadastros(), cadastros.portal_carga_cadastros_legados(),
  cadastros.portal_carga_ativos(uuid, text), cadastros.portal_carga_ultima(uuid, text),
  cadastros.portal_carga_iniciar(uuid, text, text, text), cadastros.portal_zerar_cadastros(),
  cadastros.portal_zeragem_fatos(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.portal_carga_iniciar(uuid, text, text, text),
  cadastros.portal_zeragem_fatos(uuid, text[]) TO macuxierp_config;
