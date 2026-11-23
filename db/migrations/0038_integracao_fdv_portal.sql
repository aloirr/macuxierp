-- 0038 — Integração FDV gravada pelo portal /config (T-0056, v0.3.4; ADR 0013; decisão do PO de 23/11/2026, 12h43 de
-- Manaus). Aditiva e reexecutável: só CREATE OR REPLACE, REVOKE, GRANT e COMMENT. A migração não muda nenhuma linha de
-- dado: só cria funções e privilégios.
--
-- O que entra (lista fechada da ADR 0013, seção 2; schema integracao_fdv, SECURITY DEFINER, search_path fixo, EXECUTE
-- só do macuxierp_config):
-- - portal_ler(uuid): os insumos crus da tela /config e do domain (credencial ativa SEM a chave, entidades habilitadas,
--   limite, modulo_licenciado, sinal e os 10 cadastros da F2 na ordem de carga com pausa, lote em voo, último lote e
--   erros abertos). A falha { motivo, acao } NÃO sai daqui: o módulo a monta com falhaEnvioFdv do SDK (decisão do
--   engenheiro-software, 23/11, que corrige a linha da ADR);
-- - portal_credencial_definir(...): o PUT /credencial de modules/integracao-fdv/api/rotas.ts (a API cifra a chave com
--   cifrarCampo e manda só o cifrado e o prefixo; a chave mestra fica no secret do servidor, nunca no banco);
-- - portal_configurar(...): o PUT /configuracao;
-- - portal_testar(...): o POST /credencial/testar (antecipa o sinal);
-- - portal_carga_completa(...) e portal_retomar(...): o EFEITO dos POST /entidades/:e/carga-completa e /retomar depois
--   do decidirCargaCompleta / decidirRetomar do domain (a API decide antes com portal_ler; a função reconfere);
-- - internas (sem EXECUTE para ninguém): portal_entidades_f2(), portal_modulo_licenciado(uuid), portal_empresa(uuid,
--   boolean), portal_conferir_config(text[], integer), portal_antecipar(uuid, text[]), portal_credencial_ativa(uuid,
--   boolean, boolean), portal_resumo(integracao_fdv.credencial), portal_lote_em_voo(uuid, integracao_fdv.entidade_hub)
--   e portal_estado(uuid).
--
-- Regras copiadas das rotas de hoje:
-- - ordem dos bloqueios sinal -> credencial -> cursor_entidade; a empresa entra antes, com FOR KEY SHARE (não briga com
--   as FKs dos INSERTs do app e do worker, ao contrário do FOR UPDATE de plataforma.empresa_alvo; a empresa não muda de
--   situação nem some no meio da escrita);
-- - a agenda só ADIANTA (least para now()); nada é apagado; a troca da credencial só marca substituida_em na anterior (a
--   chave dela é anulada depois pelo worker, como hoje; o gatilho credencial_chave_so_anula da 0007 segue valendo);
-- - auditoria pela interna plataforma.auditar_superadmin (usuario_id NULL, superadmin_id do autor, tenant_id = empresa
--   alvo), com os nomes canônicos do módulo (integracao-fdv.credencial.criar|trocar|liberar_pausa|testar,
--   integracao-fdv.configuracao.alterar, integracao-fdv.entidade.carga_completa|retomar). Nunca a chave, o prefixo nem
--   o cifrado na auditoria; o retorno leva só o prefixo de exibição e as datas, nunca o cifrado.
-- - SQLSTATE próprios: MXI01 "cadastre a credencial do FDV antes" (sem credencial ativa), MXI02 "a credencial mudou;
--   recarregue" (p_anterior_id diferente da ativa, inclusive não nulo sem ativa), MXI03 "o estado mudou; recarregue"
--   (a pré-condição do domain deixou de valer entre a leitura e a escrita; o DETAIL traz o código do domain). A API
--   traduz em 409.
-- - as cinco escritas exigem a empresa 'ativo' e o módulo integracao-fdv licenciado e ativo (senão check_violation);
--   empresa de referência, excluída ou inexistente = no_data_found (P0002). A leitura vale para qualquer empresa visível.
--
-- Premissas (banco-dados, T-0056):
-- - os padrões da primeira credencial (DEFAULT de p_entidades e p_limite) são espelho de ENTIDADES_HUB_F2 /
--   ENTIDADES_ENVIO_FDV e LIMITE_REGISTROS_LOTE / LIMITE_REGISTROS_LOTE_FDV dos contracts (ADR 0013, que desfaz o RD-1135);
-- - criada_por fica NULL (o superadmin não é usuário do tenant; a autoria está na auditoria);
-- - o evento de carga inicial vai à outbox com o envelope do OutboxPg ({ator, request_id, payload}), ator 'sistema'
--   (o superadmin não é usuário do tenant), versão 1 (agregado = credencial nova).

GRANT USAGE ON SCHEMA integracao_fdv TO macuxierp_config;

-- ---------------------------------------------------------------------------------------------------------------
-- Internas (sem EXECUTE para ninguém): só as funções do portal as chamam, como donas.
-- ---------------------------------------------------------------------------------------------------------------

-- Espelho de ENTIDADES_ENVIO_FDV (packages/platform-sdk/src/portal-integracao.ts), na ordem de carga.
CREATE OR REPLACE FUNCTION integracao_fdv.portal_entidades_f2() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco',
                     'estoque', 'cliente', 'cliente_endereco']::text[] $$;
COMMENT ON FUNCTION integracao_fdv.portal_entidades_f2() IS
  'Interna (0038): os 10 cadastros da F2 na ordem de carga (espelho de ENTIDADES_ENVIO_FDV do SDK; o teste da 0038 trava a lista e o DEFAULT do portal_credencial_definir). T-0056.';

-- Espelho de moduloLicenciado (packages/platform-sdk/src/acesso.ts) para o integracao-fdv.
CREATE OR REPLACE FUNCTION integracao_fdv.portal_modulo_licenciado(p_tenant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM plataforma.tenant_modulo m
                  WHERE m.tenant_id = p_tenant AND m.modulo = 'integracao-fdv' AND m.ativo AND m.deleted_at IS NULL
                    AND (m.valido_ate IS NULL OR m.valido_ate > now()))
$$;
COMMENT ON FUNCTION integracao_fdv.portal_modulo_licenciado(uuid) IS
  'Interna (0038): o módulo integracao-fdv está licenciado e ativo na empresa (linha não excluída de plataforma.tenant_modulo, ativo, valido_ate nulo ou futuro; o moduloLicenciado do SDK). T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_empresa(p_tenant uuid, p_escrita boolean) RETURNS uuid
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
  IF p_escrita AND t.situacao <> 'ativo' THEN
    RAISE EXCEPTION 'empresa fora de ativo' USING ERRCODE = 'check_violation';
  END IF;
  IF p_escrita AND NOT integracao_fdv.portal_modulo_licenciado(t.id) THEN
    RAISE EXCEPTION 'módulo integracao-fdv desligado na empresa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN t.id;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_empresa(uuid, boolean) IS
  'Interna (0038): confere a empresa alvo do portal com FOR KEY SHARE (visível: não é a de referência nem excluída; senão no_data_found); para escrita, ativa e com o módulo integracao-fdv licenciado e ativo (senão check_violation). ADR 0013. T-0056.';

-- Espelho de ConfigurarIntegracaoPlataformaEntrada do SDK (cadastros da F2 sem repetição; limite de 1 a 5.000).
CREATE OR REPLACE FUNCTION integracao_fdv.portal_conferir_config(p_entidades text[], p_limite integer) RETURNS void
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_entidades IS NULL OR array_position(p_entidades, NULL) IS NOT NULL
     OR NOT (p_entidades <@ integracao_fdv.portal_entidades_f2())
     OR cardinality(p_entidades) <> (SELECT count(DISTINCT e) FROM unnest(p_entidades) e) THEN
    RAISE EXCEPTION 'entidades habilitadas fora da F2 ou repetidas' USING ERRCODE = 'check_violation';
  END IF;
  IF p_limite IS NULL OR p_limite NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'limite de registros por lote fora de 1 a 5000' USING ERRCODE = 'check_violation';
  END IF;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_conferir_config(text[], integer) IS
  'Interna (0038): entidades habilitadas só da F2 (portal_entidades_f2), sem nulo nem repetição, e limite de 1 a 5.000; senão check_violation. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_antecipar(p_tenant uuid, p_entidades text[]) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em)
  SELECT p_tenant, e::integracao_fdv.entidade_hub, now() FROM unnest(coalesce(p_entidades, '{}'::text[])) AS e
  ON CONFLICT (tenant_id, entidade) DO UPDATE
    SET proximo_em = least(integracao_fdv.cursor_entidade.proximo_em, EXCLUDED.proximo_em)
$$;
COMMENT ON FUNCTION integracao_fdv.portal_antecipar(uuid, text[]) IS
  'Interna (0038): o anteciparEntidades de api/conector-comum.ts (upsert do cursor com proximo_em = least(atual, now())). T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_credencial_ativa(p_tenant uuid, p_travar boolean, p_exigir boolean)
  RETURNS integracao_fdv.credencial
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  c integracao_fdv.credencial;
BEGIN
  IF p_travar THEN
    SELECT * INTO c FROM integracao_fdv.credencial x
     WHERE x.tenant_id = p_tenant AND x.substituida_em IS NULL AND x.deleted_at IS NULL
     FOR UPDATE;
  ELSE
    SELECT * INTO c FROM integracao_fdv.credencial x
     WHERE x.tenant_id = p_tenant AND x.substituida_em IS NULL AND x.deleted_at IS NULL;
  END IF;
  IF c.id IS NULL AND p_exigir THEN
    RAISE EXCEPTION 'cadastre a credencial do FDV antes' USING ERRCODE = 'MXI01';
  END IF;
  RETURN c;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_credencial_ativa(uuid, boolean, boolean) IS
  'Interna (0038): a credencial ativa do tenant (linha toda de NULL se não houver), com FOR UPDATE quando p_travar; sem ela e com p_exigir = MXI01. Nunca sai do banco com a chave: quem devolve à API usa portal_resumo. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_resumo(c integracao_fdv.credencial) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'conector_id', c.conector_id,
    'ambiente', c.ambiente, 'chave_prefixo', c.chave_prefixo,
    'criada_em', plataforma.instante_iso(c.created_at), 'ultimo_uso_em', plataforma.instante_iso(c.ultimo_uso_em))
  END
$$;
COMMENT ON FUNCTION integracao_fdv.portal_resumo(integracao_fdv.credencial) IS
  'Interna (0038): o resumo da credencial sem a chave, o cifrado nem a versão da chave mestra (o CredencialResumo de api/monitor.ts, com criada_em; ADR 0013 §3); NULL se não houver credencial. T-0056.';

-- Espelho de ESTADOS_EM_VOO de modules/integracao-fdv/api/conector-comum.ts:15 (RN-INF-03): a lista fica só aqui.
CREATE OR REPLACE FUNCTION integracao_fdv.portal_lote_em_voo(p_tenant uuid, p_entidade integracao_fdv.entidade_hub)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (SELECT 1 FROM integracao_fdv.lote_envio l
                  WHERE l.tenant_id = p_tenant AND l.entidade = p_entidade
                    AND l.estado IN ('montado', 'enviando', 'aceito') AND l.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION integracao_fdv.portal_lote_em_voo(uuid, integracao_fdv.entidade_hub) IS
  'Interna (0038): há lote da entidade em voo (estados de ESTADOS_EM_VOO de api/conector-comum.ts: montado, enviando, aceito)? T-0056.';

-- O jsonb do portal_ler e das escritas que devolvem o estado (sem conferir sessão nem empresa: quem chama já conferiu).
CREATE OR REPLACE FUNCTION integracao_fdv.portal_estado(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_c integracao_fdv.credencial := integracao_fdv.portal_credencial_ativa(p_tenant, false, false);
BEGIN
  RETURN jsonb_build_object(
    'empresa_id', p_tenant,
    'modulo_licenciado', integracao_fdv.portal_modulo_licenciado(p_tenant),
    'credencial', integracao_fdv.portal_resumo(v_c),
    'entidades_habilitadas', coalesce(to_jsonb(v_c.entidades_habilitadas::text[]), '[]'::jsonb),
    'limite_registros_lote', v_c.limite_registros_lote,
    -- nunca politica_versao (ADR 0013)
    'sinal', (
      SELECT jsonb_build_object('ultimo_envio_em', plataforma.instante_iso(s.ultimo_envio_em),
        'ultimo_aceito_em', plataforma.instante_iso(s.ultimo_aceito_em), 'ultimo_http', s.ultimo_http,
        'parado_por_versao', s.parado_por_versao)
      FROM integracao_fdv.sinal s WHERE s.tenant_id = p_tenant AND s.deleted_at IS NULL),
    -- os 10 da F2 na ordem de carga; só o estado (nunca o lote, a linha nem o external_id)
    'cadastros', (
      SELECT jsonb_agg(jsonb_build_object(
          'entidade', f.e,
          'habilitada', coalesce(f.e::integracao_fdv.entidade_hub = ANY (v_c.entidades_habilitadas), false),
          'ligada', v_c.id IS NOT NULL AND coalesce(f.e::integracao_fdv.entidade_hub = ANY (v_c.entidades_habilitadas), false),
          'pausada_motivo', k.pausada_motivo,
          'lote_em_voo', integracao_fdv.portal_lote_em_voo(p_tenant, f.e::integracao_fdv.entidade_hub),
          'ultimo_envio_em', (
            SELECT plataforma.instante_iso(max(l.enviado_em)) FROM integracao_fdv.lote_envio l
             WHERE l.tenant_id = p_tenant AND l.entidade = f.e::integracao_fdv.entidade_hub AND l.deleted_at IS NULL),
          'ultimo_lote', (
            SELECT jsonb_build_object('estado', l.estado, 'erro_codigo', l.ultimo_erro_codigo,
              'em', plataforma.instante_iso(coalesce(l.concluido_em, l.enviado_em, l.created_at)))
            FROM integracao_fdv.lote_envio l
            WHERE l.tenant_id = p_tenant AND l.entidade = f.e::integracao_fdv.entidade_hub AND l.deleted_at IS NULL
            ORDER BY l.created_at DESC, l.id DESC LIMIT 1),
          'erros_abertos', (
            SELECT count(*)::integer FROM integracao_fdv.lote_erro x
             WHERE x.tenant_id = p_tenant AND x.entidade = f.e::integracao_fdv.entidade_hub
               AND x.resolvido_em IS NULL AND x.deleted_at IS NULL))
        ORDER BY f.o)
      FROM unnest(integracao_fdv.portal_entidades_f2()) WITH ORDINALITY AS f(e, o)
      LEFT JOIN integracao_fdv.cursor_entidade k
        ON k.tenant_id = p_tenant AND k.entidade = f.e::integracao_fdv.entidade_hub AND k.deleted_at IS NULL));
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_estado(uuid) IS
  'Interna (0038): o jsonb do portal (empresa_id, modulo_licenciado, credencial sem a chave, entidades_habilitadas, limite_registros_lote, sinal sem politica_versao e os 10 cadastros da F2 com habilitada, ligada, pausada_motivo, lote_em_voo, ultimo_envio_em, ultimo_lote {estado, erro_codigo, em} e erros_abertos). T-0056.';

-- ---------------------------------------------------------------------------------------------------------------
-- Funções do portal (EXECUTE só do macuxierp_config).
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION integracao_fdv.portal_ler(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
BEGIN
  RETURN integracao_fdv.portal_estado(v_t);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_ler(uuid) IS
  'Portal /config (0038): os insumos crus da Integração FDV da empresa visível (portal_estado), sem trava nem auditoria; a falha { motivo, acao } é montada no módulo pelo falhaEnvioFdv do SDK. Só macuxierp_config. ADR 0013. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_credencial_definir(p_tenant uuid, p_anterior_id uuid, p_conector_id text,
  p_ambiente text, p_chave_cifrada bytea, p_chave_prefixo text, p_chave_mestra_versao integer, p_zerar_espelho boolean,
  p_evento_carga_inicial jsonb, p_request_id text,
  -- espelho de ENTIDADES_HUB_F2 / LIMITE_REGISTROS_LOTE dos contracts (ENTIDADES_ENVIO_FDV / LIMITE_REGISTROS_LOTE_FDV)
  p_entidades text[] DEFAULT ARRAY['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto',
    'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco']::text[],
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
  PERFORM integracao_fdv.portal_conferir_config(p_entidades, p_limite);
  IF p_evento_carga_inicial IS NOT NULL AND (jsonb_typeof(p_evento_carga_inicial) <> 'object'
     OR jsonb_typeof(p_evento_carga_inicial -> 'entidades') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_evento_carga_inicial -> 'entidades') = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_evento_carga_inicial -> 'entidades') x
                WHERE jsonb_typeof(x.value) <> 'string')) THEN
    RAISE EXCEPTION 'evento de carga inicial fora do formato {entidades: [texto, ...]}' USING ERRCODE = 'check_violation';
  END IF;

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

  -- (c) a ativa sai antes da nova entrar (uma ativa por tenant); a chave dela é anulada depois, pelo worker
  IF v_ant.id IS NOT NULL THEN
    UPDATE integracao_fdv.credencial SET substituida_em = now() WHERE tenant_id = v_t AND id = v_ant.id;
  END IF;

  -- (d) a nova, com a configuração do envio copiada (ou p_entidades e p_limite na primeira)
  INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo,
    chave_mestra_versao, criada_por, entidades_habilitadas, limite_registros_lote)
  VALUES (v_t, p_conector_id, p_ambiente, p_chave_cifrada, p_chave_prefixo, coalesce(p_chave_mestra_versao, 1), NULL,
    CASE WHEN v_ant.id IS NULL THEN p_entidades::integracao_fdv.entidade_hub[] ELSE v_ant.entidades_habilitadas END,
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
  'Portal /config (0038): o PUT /credencial (sinal -> credencial -> cursor): confere p_anterior_id contra a ativa (MXI02), substitui a anterior, grava a nova com a chave já cifrada pela API (configuração copiada ou, na primeira, p_entidades/p_limite, com DEFAULT espelho dos contracts), zera o espelho se pedido (sem apagar), libera a pausa de credencial, grava integracao-fdv.carga_inicial.solicitada@1 na outbox se pedida, audita sem chave, prefixo nem cifrado e devolve o jsonb do portal_ler. Só macuxierp_config. ADR 0013. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_configurar(p_tenant uuid, p_entidades text[], p_limite integer,
  p_request_id text) RETURNS jsonb
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
  v_c := integracao_fdv.portal_credencial_ativa(v_t, true, true);
  v_antes := v_c.entidades_habilitadas::text[];
  UPDATE integracao_fdv.credencial
     SET entidades_habilitadas = p_entidades::integracao_fdv.entidade_hub[], limite_registros_lote = p_limite
   WHERE tenant_id = v_t AND id = v_c.id;
  SELECT coalesce(array_agg(e ORDER BY o), '{}') INTO v_novas
    FROM unnest(p_entidades) WITH ORDINALITY AS x(e, o) WHERE NOT (e = ANY (v_antes));
  PERFORM integracao_fdv.portal_antecipar(v_t, v_novas);
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.configuracao.alterar', 'credencial', v_c.id,
    jsonb_build_object('entidades_habilitadas', to_jsonb(v_antes), 'limite_registros_lote', v_c.limite_registros_lote),
    jsonb_build_object('entidades_habilitadas', to_jsonb(p_entidades), 'limite_registros_lote', p_limite),
    p_request_id);
  RETURN integracao_fdv.portal_estado(v_t);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_configurar(uuid, text[], integer, text) IS
  'Portal /config (0038): o PUT /configuracao na credencial ativa travada (MXI01 sem ela): entidades só da F2 sem repetição e limite de 1 a 5.000 (senão check_violation), antecipa as que ligaram, audita integracao-fdv.configuracao.alterar e devolve o jsonb do portal_ler. Só macuxierp_config. ADR 0013. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_testar(p_tenant uuid, p_request_id text) RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, true);
  v_c integracao_fdv.credencial;
BEGIN
  -- só lê a credencial (quem a trava é o definir); o único bloqueio é o da linha de sinal
  v_c := integracao_fdv.portal_credencial_ativa(v_t, false, true);
  UPDATE integracao_fdv.sinal SET proximo_sinal_em = least(proximo_sinal_em, now())
   WHERE tenant_id = v_t AND deleted_at IS NULL;
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.credencial.testar', 'credencial', v_c.id, NULL,
    jsonb_build_object('conector_id', v_c.conector_id, 'ambiente', v_c.ambiente), p_request_id);
  RETURN now();
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_testar(uuid, text) IS
  'Portal /config (0038): o POST /credencial/testar (MXI01 sem credencial ativa): antecipa sinal.proximo_sinal_em para agora, audita integracao-fdv.credencial.testar e devolve pedido_em. Só macuxierp_config. ADR 0013. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_carga_completa(p_tenant uuid, p_entidade text, p_request_id text)
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
BEGIN
  v_c := integracao_fdv.portal_credencial_ativa(v_t, true, true);
  IF p_entidade IS NULL OR NOT (p_entidade = ANY (integracao_fdv.portal_entidades_f2())) THEN
    RAISE EXCEPTION 'cadastro fora da F2' USING ERRCODE = 'check_violation';
  END IF;
  v_e := p_entidade::integracao_fdv.entidade_hub;
  -- o upsert trava o cursor antes de conferir o lote em voo (o montarLoteNoBanco também o trava); sessão aberta continua
  INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, sessao_aberta_id) VALUES (v_t, v_e, gen_random_uuid())
  ON CONFLICT (tenant_id, entidade) DO UPDATE
    SET cursor_alterado_em = CASE WHEN integracao_fdv.cursor_entidade.sessao_aberta_id IS NULL THEN NULL
                                  ELSE integracao_fdv.cursor_entidade.cursor_alterado_em END,
        cursor_external_id = CASE WHEN integracao_fdv.cursor_entidade.sessao_aberta_id IS NULL THEN NULL
                                  ELSE integracao_fdv.cursor_entidade.cursor_external_id END,
        sessao_aberta_id = coalesce(integracao_fdv.cursor_entidade.sessao_aberta_id, EXCLUDED.sessao_aberta_id)
  RETURNING id INTO v_cursor;
  -- a pré-condição do decidirCargaCompleta: habilitada e sem lote em voo (o erro desfaz o upsert)
  IF NOT coalesce(v_e = ANY (v_c.entidades_habilitadas), false) THEN
    RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'entidade_desabilitada';
  END IF;
  IF integracao_fdv.portal_lote_em_voo(v_t, v_e) THEN
    RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'lote_em_voo';
  END IF;
  PERFORM integracao_fdv.portal_antecipar(v_t, ARRAY[p_entidade]);
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.entidade.carga_completa', 'cursor_entidade', v_cursor,
    NULL, jsonb_build_object('entidade', p_entidade), p_request_id);
  RETURN jsonb_build_object('aceito', true);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_carga_completa(uuid, text, text) IS
  'Portal /config (0038): o efeito do POST /entidades/:e/carga-completa (MXI01 sem credencial; cadastro fora da F2 = check_violation): upsert do cursor (sem sessão aberta: zera o cursor e abre sessão nova), reconfere habilitada e sem lote em voo (senão MXI03, DETAIL com o código do domain), antecipa, audita integracao-fdv.entidade.carga_completa e devolve {"aceito": true}. Só macuxierp_config. ADR 0013. T-0056.';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_retomar(p_tenant uuid, p_entidade text, p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, true);
  v_k record;
BEGIN
  IF p_entidade IS NULL OR NOT (p_entidade = ANY (integracao_fdv.portal_entidades_f2())) THEN
    RAISE EXCEPTION 'cadastro fora da F2' USING ERRCODE = 'check_violation';
  END IF;
  SELECT k.id, k.pausada_motivo INTO v_k
    FROM integracao_fdv.cursor_entidade k
   WHERE k.tenant_id = v_t AND k.entidade = p_entidade::integracao_fdv.entidade_hub AND k.deleted_at IS NULL
   FOR UPDATE;
  -- a pré-condição do decidirRetomar: estar pausada (a API só chama quando portal_ler mostrou a pausa); sem auditoria
  IF v_k.id IS NULL OR v_k.pausada_motivo IS NULL THEN
    RAISE EXCEPTION 'o estado mudou; recarregue' USING ERRCODE = 'MXI03', DETAIL = 'sem_pausa';
  END IF;
  UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = NULL, pausada_em = NULL WHERE tenant_id = v_t AND id = v_k.id;
  PERFORM integracao_fdv.portal_antecipar(v_t, ARRAY[p_entidade]);
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'integracao-fdv.entidade.retomar', 'cursor_entidade', v_k.id,
    jsonb_build_object('entidade', p_entidade, 'pausada_motivo', v_k.pausada_motivo),
    jsonb_build_object('entidade', p_entidade, 'pausada_motivo', NULL), p_request_id);
  RETURN jsonb_build_object('retomada', true);
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_retomar(uuid, text, text) IS
  'Portal /config (0038): o efeito do POST /entidades/:e/retomar (não exige o cadastro habilitado): trava o cursor, limpa a pausa e antecipa; sem linha ou sem pausa (o estado mudou desde o portal_ler) = MXI03, sem auditoria. Audita integracao-fdv.entidade.retomar. Só macuxierp_config. ADR 0013. T-0056.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; as internas sem EXECUTE; as do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION integracao_fdv.portal_entidades_f2(), integracao_fdv.portal_modulo_licenciado(uuid),
  integracao_fdv.portal_empresa(uuid, boolean), integracao_fdv.portal_conferir_config(text[], integer),
  integracao_fdv.portal_antecipar(uuid, text[]),
  integracao_fdv.portal_credencial_ativa(uuid, boolean, boolean), integracao_fdv.portal_resumo(integracao_fdv.credencial),
  integracao_fdv.portal_lote_em_voo(uuid, integracao_fdv.entidade_hub), integracao_fdv.portal_estado(uuid),
  integracao_fdv.portal_ler(uuid),
  integracao_fdv.portal_credencial_definir(uuid, uuid, text, text, bytea, text, integer, boolean, jsonb, text, text[],
    integer),
  integracao_fdv.portal_configurar(uuid, text[], integer, text), integracao_fdv.portal_testar(uuid, text),
  integracao_fdv.portal_carga_completa(uuid, text, text), integracao_fdv.portal_retomar(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.portal_ler(uuid),
  integracao_fdv.portal_credencial_definir(uuid, uuid, text, text, bytea, text, integer, boolean, jsonb, text, text[],
    integer),
  integracao_fdv.portal_configurar(uuid, text[], integer, text), integracao_fdv.portal_testar(uuid, text),
  integracao_fdv.portal_carga_completa(uuid, text, text), integracao_fdv.portal_retomar(uuid, text, text)
  TO macuxierp_config;
