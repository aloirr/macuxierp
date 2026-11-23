-- 0040 — Carga de cadastros SÍNCRONA pelo portal /config (T-0058, v0.3.5a; contrato
-- packages/platform-sdk/src/portal-cargas.ts; molde das funções do portal: 0033 e ADR 0012 §4, 0038/0039 e ADR 0013).
-- Aditiva e reexecutável: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, REVOKE, GRANT e COMMENT. Não muda nenhuma linha
-- de dado existente; a versão anterior da API roda igual (nada que ela usa muda).
--
-- Fluxo do "Gravar" do portal (três transações, na API):
-- - tx1 como macuxierp_config: cadastros.portal_carga_iniciar(p_tenant, p_cadastro, p_modo, p_request_id) confere a
--   sessão de superadmin, a empresa ativa e a licença do cadastros (MXC04, DETAIL empresa_inativa | modulo_desligado),
--   uma carga por vez na empresa (MXC01, DETAIL carga_em_andamento) e a dependência (MXC03, DETAIL
--   dependencia_pendente); abre a execução e audita cadastros.carga.iniciar com superadmin_id;
-- - tx2 como macuxierp_app, com app.tenant_id = tenant da rota: o executarCarga do BKO (modules/cadastros/api/carga.ts,
--   que audita 'cadastros.carga'); no "Substituir tudo", a escolha e a inativação dos ausentes (deleted_at, nunca DELETE)
--   ficam no domain do cadastros (inativarEmLote do módulo, regra 2), com a RLS do app; o banco não tem função para isso;
-- - tx3 como macuxierp_config: cadastros.portal_carga_concluir(...) fecha a execução com as contagens e audita
--   cadastros.carga.concluir.
-- A aba "Cargas" lê cadastros.portal_carga_situacao(p_tenant) (sem auditoria); o plugin monta situacao, depende_de e
-- liberado com as funções puras do SDK (situacaoCarga, dependenciaPendente).
--
-- Um lugar só para cada dado (RD-1171): a lista dos 10 cadastros é a interna cadastros.portal_carga_cadastros()
-- (IMMUTABLE; o CHECK da tabela a usa); o mapeamento cadastro -> tabela é só o CASE de cadastros.portal_carga_ativos;
-- as dependências, o CASE de cadastros.portal_carga_dependencias. A licença do módulo é a interna genérica
-- plataforma.modulo_licenciado(tenant, modulo) (RD-1172).
--
-- Índices parciais (tenant_id, external_id) WHERE deleted_at IS NULL nas tabelas da carga: servem à contagem dos ativos
-- da situação e ao inativarEmLote do módulo cadastros no "Substituir tudo" (o estoque_saldo só tem (tenant_id): é só
-- contado; a forma de pagamento usa (tenant_id, forma_external_id) da condicao_pagamento).
--
-- Premissas (banco-dados, T-0058):
-- - "ativos" = registros com deleted_at nulo no tenant (venham do BKO ou da carga); na forma de pagamento, as formas
--   distintas (forma_external_id não nulo) das condições ativas;
-- - a dependência pendente (MXC03) espelha o dependenciaPendente do SDK: a dependência está nao_carregado (sem ativo e
--   sem erro na última carga concluída). Assim o banco não recusa o que a tela mostra liberado;
-- - o que o "Substituir tudo" inativa (só com external_id; o estoque fora) é regra do domain do cadastros, não do banco;
--   a execução só guarda a contagem (inativadas, obrigatória no Substituir tudo concluído);
-- - a execução aberta há 15 min ou mais é dada por abandonada (resultado 'abandonada') no próximo iniciar da empresa;
-- - a empresa é travada com FOR NO KEY UPDATE: serializa os iniciares da mesma empresa sem brigar com o FOR KEY SHARE
--   das FKs dos INSERTs do app e do worker (o FOR UPDATE brigaria);
-- - nenhum dado pessoal na execução nem na auditoria: só cadastro, modo, resultado e contagens.

-- Interna (sem EXECUTE para ninguém). A lista dos 10 cadastros num lugar só (RD-1171): o CHECK da tabela e as funções
-- do portal a usam. Espelho de CADASTROS_CARGA_PORTAL (packages/platform-sdk/src/portal-cargas.ts), na ordem da carga.
CREATE OR REPLACE FUNCTION cadastros.portal_carga_cadastros() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco',
                     'estoque', 'cliente', 'cliente_endereco']::text[] $$;
COMMENT ON FUNCTION cadastros.portal_carga_cadastros() IS
  'Interna (0040): os 10 cadastros da carga do portal na ordem (espelho de CADASTROS_CARGA_PORTAL do SDK; o CHECK de cadastros.carga_portal a usa; o teste da 0040 trava a lista). T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Execuções da carga do portal (regra 5). Sem GRANT a app, worker, leitura ou config: só as funções a leem e gravam.
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cadastros.carga_portal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  cadastro text NOT NULL CHECK (cadastro = ANY (cadastros.portal_carga_cadastros())),
  modo text NOT NULL CHECK (modo IN ('adicionar', 'substituir_tudo')),
  superadmin_id uuid NOT NULL REFERENCES plataforma.superadmin (id),
  request_id text CHECK (length(request_id) <= 200),
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz,
  resultado text CHECK (resultado IN ('concluida', 'falhou', 'abandonada')),
  gravadas integer CHECK (gravadas >= 0),
  com_erro integer CHECK (com_erro >= 0),
  inativadas integer CHECK (inativadas >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT carga_portal_aberta CHECK ((resultado IS NULL) = (concluida_em IS NULL)),
  CONSTRAINT carga_portal_contagens CHECK (
    CASE WHEN resultado IN ('concluida', 'falhou') THEN gravadas IS NOT NULL AND com_erro IS NOT NULL
         ELSE gravadas IS NULL AND com_erro IS NULL AND inativadas IS NULL END),
  CONSTRAINT carga_portal_inativadas CHECK (inativadas IS NULL OR modo = 'substituir_tudo')
);
SELECT controle.preparar_tabela('cadastros.carga_portal');
CREATE INDEX IF NOT EXISTS carga_portal_ultima_ix ON cadastros.carga_portal (tenant_id, cadastro, concluida_em DESC);
CREATE INDEX IF NOT EXISTS carga_portal_aberta_ix ON cadastros.carga_portal (tenant_id) WHERE resultado IS NULL;
COMMENT ON TABLE cadastros.carga_portal IS
  'Execuções da carga de cadastros pelo portal /config (0040): uma por Gravar; aberta enquanto resultado é nulo. Sem dado pessoal. Só as funções portal_carga_* a acessam. T-0058.';

-- Índices dos ativos por external_id (contagem da situação e o inativarEmLote do módulo no Substituir tudo).
CREATE INDEX IF NOT EXISTS filial_carga_ativos_ix ON cadastros.filial (tenant_id, external_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vendedor_carga_ativos_ix ON cadastros.vendedor (tenant_id, external_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS condicao_pagamento_carga_ativos_ix ON cadastros.condicao_pagamento (tenant_id, external_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS condicao_pagamento_forma_carga_ativos_ix ON cadastros.condicao_pagamento
  (tenant_id, forma_external_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS produto_carga_ativos_ix ON cadastros.produto (tenant_id, external_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS produto_unidade_carga_ativos_ix ON cadastros.produto_unidade (tenant_id, external_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tabela_preco_item_carga_ativos_ix ON cadastros.tabela_preco_item (tenant_id, external_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS estoque_saldo_carga_ativos_ix ON cadastros.estoque_saldo (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cliente_carga_ativos_ix ON cadastros.cliente (tenant_id, external_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cliente_endereco_carga_ativos_ix ON cadastros.cliente_endereco (tenant_id, external_id)
  WHERE deleted_at IS NULL;

GRANT USAGE ON SCHEMA cadastros TO macuxierp_config;

-- ---------------------------------------------------------------------------------------------------------------
-- Internas (sem EXECUTE para ninguém): só as funções do portal as chamam, como donas.
-- ---------------------------------------------------------------------------------------------------------------

-- espelho de CADASTROS_CARGA_PORTAL: o depende_de de cada cadastro (packages/platform-sdk/src/portal-cargas.ts).
-- Dado diferente da lista (por isso outro CASE); um cadastro fora da lista dá NULL.
CREATE OR REPLACE FUNCTION cadastros.portal_carga_dependencias(p_cadastro text) RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE p_cadastro
    WHEN 'filial' THEN ARRAY[]::text[]
    WHEN 'vendedor' THEN ARRAY['filial']
    WHEN 'forma_pagamento' THEN ARRAY[]::text[]
    WHEN 'prazo_pagamento' THEN ARRAY['forma_pagamento']
    WHEN 'produto' THEN ARRAY[]::text[]
    WHEN 'produto_unidade' THEN ARRAY['produto']
    WHEN 'preco' THEN ARRAY['produto', 'filial']
    WHEN 'estoque' THEN ARRAY['produto', 'filial']
    WHEN 'cliente' THEN ARRAY['filial', 'vendedor', 'prazo_pagamento', 'preco']
    WHEN 'cliente_endereco' THEN ARRAY['cliente']
  END::text[]
$$;
COMMENT ON FUNCTION cadastros.portal_carga_dependencias(text) IS
  'Interna (0040): depende_de de cada cadastro (espelho de CADASTROS_CARGA_PORTAL do SDK); NULL fora da lista. T-0058.';

-- Interna genérica (RD-1172): espelho de moduloLicenciado (packages/platform-sdk/src/acesso.ts) para qualquer módulo.
-- A integracao_fdv.portal_modulo_licenciado (0038) passa a usar esta numa migração futura.
CREATE OR REPLACE FUNCTION plataforma.modulo_licenciado(p_tenant uuid, p_modulo text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM plataforma.tenant_modulo m
                  WHERE m.tenant_id = p_tenant AND m.modulo = p_modulo AND m.ativo AND m.deleted_at IS NULL
                    AND (m.valido_ate IS NULL OR m.valido_ate > now()))
$$;
COMMENT ON FUNCTION plataforma.modulo_licenciado(uuid, text) IS
  'Interna (0040): o módulo está licenciado e ativo na empresa (linha não excluída de plataforma.tenant_modulo, ativo, valido_ate nulo ou futuro; o moduloLicenciado do SDK). Sem EXECUTE para ninguém: só funções SECURITY DEFINER a chamam, como donas. T-0058.';

-- Ativos do cadastro no tenant (filtro explícito de tenant: roda como dona, fora da RLS). Este CASE é o único
-- mapeamento cadastro -> tabela do banco (a forma de pagamento e o estoque não têm tabela própria).
CREATE OR REPLACE FUNCTION cadastros.portal_carga_ativos(p_tenant uuid, p_cadastro text) RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RETURN CASE p_cadastro
    WHEN 'filial' THEN (SELECT count(*) FROM cadastros.filial x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'vendedor' THEN (SELECT count(*) FROM cadastros.vendedor x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'forma_pagamento' THEN (SELECT count(DISTINCT x.forma_external_id) FROM cadastros.condicao_pagamento x
                                  WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'prazo_pagamento' THEN (SELECT count(*) FROM cadastros.condicao_pagamento x
                                  WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'produto' THEN (SELECT count(*) FROM cadastros.produto x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'produto_unidade' THEN (SELECT count(*) FROM cadastros.produto_unidade x
                                  WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'preco' THEN (SELECT count(*) FROM cadastros.tabela_preco_item x
                        WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'estoque' THEN (SELECT count(*) FROM cadastros.estoque_saldo x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'cliente' THEN (SELECT count(*) FROM cadastros.cliente x WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
    WHEN 'cliente_endereco' THEN (SELECT count(*) FROM cadastros.cliente_endereco x
                                   WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL)
  END::integer;
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_ativos(uuid, text) IS
  'Interna (0040): registros ativos (deleted_at nulo) do cadastro no tenant; na forma de pagamento, as formas distintas (forma_external_id) das condições ativas; NULL fora da lista. T-0058.';

-- A última execução concluída do cadastro (o chip "N com erro" e a "última carga").
CREATE OR REPLACE FUNCTION cadastros.portal_carga_ultima(p_tenant uuid, p_cadastro text) RETURNS cadastros.carga_portal
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT x.* FROM cadastros.carga_portal x
   WHERE x.tenant_id = p_tenant AND x.cadastro = p_cadastro AND x.resultado = 'concluida' AND x.deleted_at IS NULL
   ORDER BY x.concluida_em DESC, x.id DESC LIMIT 1
$$;
COMMENT ON FUNCTION cadastros.portal_carga_ultima(uuid, text) IS
  'Interna (0040): a última execução com resultado concluida do cadastro no tenant (ou nula). T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Portal /config (EXECUTE só do macuxierp_config).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cadastros.portal_carga_iniciar(p_tenant uuid, p_cadastro text, p_modo text, p_request_id text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  v_dep text;
  v_id uuid;
BEGIN
  -- trava a empresa: serializa os iniciares concorrentes da mesma empresa (FOR NO KEY UPDATE, ver o cabeçalho)
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
  -- dependência nao_carregado (sem ativo e sem erro na última carga concluída), como o dependenciaPendente do SDK
  SELECT d INTO v_dep FROM unnest(cadastros.portal_carga_dependencias(p_cadastro)) d
   WHERE cadastros.portal_carga_ativos(t.id, d) = 0
     AND coalesce((cadastros.portal_carga_ultima(t.id, d)).com_erro, 0) = 0
   LIMIT 1;
  IF v_dep IS NOT NULL THEN
    RAISE EXCEPTION 'dependência do cadastro não carregada' USING ERRCODE = 'MXC03', DETAIL = 'dependencia_pendente';
  END IF;
  INSERT INTO cadastros.carga_portal (tenant_id, cadastro, modo, superadmin_id, request_id)
    VALUES (t.id, p_cadastro, p_modo, v_sa, p_request_id) RETURNING id INTO v_id;
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'cadastros.carga.iniciar', 'carga_portal', v_id, NULL,
    jsonb_build_object('cadastro', p_cadastro, 'modo', p_modo), p_request_id);
  RETURN v_id;
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_iniciar(uuid, text, text, text) IS
  'Portal /config (0040): tx1 do Gravar da carga. Trava a empresa (P0002 se não visível); MXC04 (DETAIL empresa_inativa | modulo_desligado); cadastro ou modo fora do contrato = check_violation; MXC01 (DETAIL carga_em_andamento) com execução aberta há menos de 15 min (a mais antiga vira abandonada); MXC03 (DETAIL dependencia_pendente) com dependência nao_carregado; abre a execução, audita cadastros.carga.iniciar e devolve o id. Só macuxierp_config. T-0058.';

CREATE OR REPLACE FUNCTION cadastros.portal_carga_concluir(p_tenant uuid, p_execucao_id uuid, p_resultado text,
  p_gravadas integer, p_com_erro integer, p_inativadas integer, p_request_id text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  e cadastros.carga_portal;
BEGIN
  SELECT * INTO e FROM cadastros.carga_portal x
   WHERE x.id = p_execucao_id AND x.tenant_id = p_tenant AND x.resultado IS NULL AND x.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execução inexistente, de outra empresa ou já fechada' USING ERRCODE = 'check_violation',
      DETAIL = 'execucao_invalida';
  END IF;
  IF p_resultado IS NULL OR p_resultado NOT IN ('concluida', 'falhou') THEN
    RAISE EXCEPTION 'resultado fora do contrato' USING ERRCODE = 'check_violation', DETAIL = 'execucao_invalida';
  END IF;
  IF p_gravadas IS NULL OR p_gravadas < 0 OR p_com_erro IS NULL OR p_com_erro < 0 OR p_inativadas < 0 THEN
    RAISE EXCEPTION 'contagens inválidas' USING ERRCODE = 'check_violation', DETAIL = 'execucao_invalida';
  END IF;
  IF (e.modo = 'adicionar' AND p_inativadas IS NOT NULL)
     OR (e.modo = 'substituir_tudo' AND p_resultado = 'concluida' AND p_inativadas IS NULL) THEN
    RAISE EXCEPTION 'inativadas só, e sempre, no Substituir tudo concluído' USING ERRCODE = 'check_violation',
      DETAIL = 'execucao_invalida';
  END IF;
  UPDATE cadastros.carga_portal
     SET resultado = p_resultado, concluida_em = now(), gravadas = p_gravadas, com_erro = p_com_erro,
         inativadas = p_inativadas
   WHERE tenant_id = e.tenant_id AND id = e.id;
  PERFORM plataforma.auditar_superadmin(e.tenant_id, v_sa, 'cadastros.carga.concluir', 'carga_portal', e.id, NULL,
    jsonb_build_object('cadastro', e.cadastro, 'modo', e.modo, 'resultado', p_resultado, 'gravadas', p_gravadas,
      'com_erro', p_com_erro, 'inativadas', p_inativadas), p_request_id);
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text) IS
  'Portal /config (0040): tx3 do Gravar. Fecha a execução aberta da empresa (senão check_violation, DETAIL execucao_invalida) com resultado concluida|falhou e as contagens (>= 0; inativadas nula fora do Substituir tudo e obrigatória no Substituir tudo concluído) e audita cadastros.carga.concluir. Só macuxierp_config. T-0058.';

CREATE OR REPLACE FUNCTION cadastros.portal_carga_situacao(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
BEGIN
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_tenant AND plataforma.empresa_visivel(x);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'empresa_id', t.id,
    'modulo_licenciado', plataforma.modulo_licenciado(t.id, 'cadastros'),
    'cadastros', (
      SELECT jsonb_agg(jsonb_build_object(
               'cadastro', c.cadastro,
               'ativos', cadastros.portal_carga_ativos(t.id, c.cadastro),
               'erros', coalesce(u.com_erro, 0),
               'ultima_carga', CASE WHEN u.id IS NULL THEN NULL
                                    ELSE jsonb_build_object('em', plataforma.instante_iso(u.concluida_em),
                                                            'quantidade', u.gravadas) END)
             ORDER BY c.n)
        FROM unnest(cadastros.portal_carga_cadastros()) WITH ORDINALITY AS c (cadastro, n)
        LEFT JOIN LATERAL cadastros.portal_carga_ultima(t.id, c.cadastro) u ON true));
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_situacao(uuid) IS
  'Portal /config (0040): a aba Cargas, crua: {empresa_id, modulo_licenciado, cadastros: [10 na ordem de CADASTROS_CARGA_PORTAL: {cadastro, ativos, erros (com_erro da última concluída), ultima_carga {em, quantidade} | null}]}. Empresa não visível = P0002. Sem auditoria. Só macuxierp_config. T-0058.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; internas sem EXECUTE; portal só do config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION cadastros.portal_carga_cadastros(), cadastros.portal_carga_dependencias(text),
  plataforma.modulo_licenciado(uuid, text), cadastros.portal_carga_ativos(uuid, text),
  cadastros.portal_carga_ultima(uuid, text),
  cadastros.portal_carga_iniciar(uuid, text, text, text),
  cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text),
  cadastros.portal_carga_situacao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.portal_carga_iniciar(uuid, text, text, text),
  cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text),
  cadastros.portal_carga_situacao(uuid) TO macuxierp_config;
