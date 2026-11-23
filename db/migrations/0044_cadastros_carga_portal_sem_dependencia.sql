-- 0044 — Carga do portal /config sem dependência entre cadastros e lista de 8 cadastros (T-0058, v0.3.6).
-- Substitui o MXC03 da 0040 (cadastros.portal_carga_iniciar não recusa mais por dependência pendente).
--
-- Decisão (Alexandre/PO, 23/11/2026 16h08 de Manaus; nomes do engenheiro-software às 16h18): nenhuma carga depende de
-- outra, e a lista do portal passa de 10 para 8 (lista e ordem em cadastros.portal_carga_cadastros()).
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

-- Privilégios: nada para PUBLIC; internas sem EXECUTE; portal só do config (o mesmo estado da 0040).
REVOKE ALL ON FUNCTION cadastros.portal_carga_cadastros(), cadastros.portal_carga_cadastros_legados(),
  cadastros.portal_carga_ativos(uuid, text), cadastros.portal_carga_ultima(uuid, text),
  cadastros.portal_carga_iniciar(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.portal_carga_iniciar(uuid, text, text, text) TO macuxierp_config;
