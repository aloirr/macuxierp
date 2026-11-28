-- 0088 — integracao_fdv.portal_ligacoes(uuid): a ligação ERP → Macuxi FDV no /config (v0.3.32, T-0131, RN-INF-13).
-- Aditiva e reexecutável: só CREATE OR REPLACE, REVOKE, GRANT e COMMENT. Não muda linha, tabela, política de RLS nem
-- grant de tabela. Motivo em docs/banco/README.md (0088).
--
-- O que entra (schema integracao_fdv, SECURITY DEFINER, search_path fixo, EXECUTE só do macuxierp_config, no molde das
-- portal_* da 0038 e da 0055; ADR 0012 e ADR 0013): a MESMA leitura do lerLigacoes de modules/integracao-fdv/api/ligacoes.ts
-- (GET /v1/integracao-fdv/ligacoes, #978), com a regra contarLigacao do domain (modules/integracao-fdv/domain/ligacao.ts)
-- refeita em SQL:
-- - contadores: só os lotes nos estados mandados ao Hub (ESTADOS_ENVIADOS_AO_HUB: enviando, aceito, concluido,
--   concluido_com_erros) e sem o repetido. Por estado, Enviados += max(0, soma de registros) e Aceitos += min(max(0, soma
--   de aceitos), max(0, soma de registros)); o aceito do lote = max(0, hub.recebidas - hub.com_erro). Só número jsonb entra
--   na soma (o mesmo jsonb_typeof da rota);
-- - envios: os 50 mais novos (LIMITE_ENVIOS_LIGACAO) desses lotes, por (created_at, id) decrescente, com o loteResumo:
--   registros = contagens.registros se número, senão 0; aceitos = nulo sem hub.recebidas numérico, senão
--   max(0, recebidas - com_erro); com_erro = hub.com_erro se número, senão nulo; envios_cortados se houver mais de 50;
-- - contato: os insumos do montarContatoSaida (credencial_ativa, conector_id, ambiente, chave_prefixo com até 8
--   caracteres pelo CHECK da 0007, habilitadas e ultimo_contato_em = sinal.ultimo_aceito_em). A situação fica com quem
--   chama, pela regra do SDK (situacaoConectorFdv), porque depende do relógio da API.
-- Nunca a chave, o cifrado, o corpo do lote, external_id, payload nem dado pessoal. Só leitura, sem trava nem auditoria.
-- Barreiras da 0055: sem sessão de superadmin MXS01 (exigir_superadmin); empresa inexistente P0002 (portal_empresa, que
-- vale para qualquer empresa visível na leitura, como o portal_monitor).

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION integracao_fdv.portal_ligacoes(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := integracao_fdv.portal_empresa(p_tenant, false);
  v_c integracao_fdv.credencial := integracao_fdv.portal_credencial_ativa(v_t, false, false);
  v_estados text[] := ARRAY['enviando', 'aceito', 'concluido', 'concluido_com_erros'];
  v_limite integer := 50;
BEGIN
  RETURN jsonb_build_object(
    'contato', jsonb_build_object(
      'credencial_ativa', v_c.id IS NOT NULL,
      'conector_id', v_c.conector_id,
      'ambiente', v_c.ambiente,
      'chave_prefixo', v_c.chave_prefixo,
      'habilitadas', coalesce(cardinality(v_c.entidades_habilitadas), 0),
      'ultimo_contato_em', (
        SELECT plataforma.instante_iso(s.ultimo_aceito_em) FROM integracao_fdv.sinal s
         WHERE s.tenant_id = v_t AND s.deleted_at IS NULL)),
    'contadores', (
      SELECT jsonb_build_object(
        'enviados', coalesce(sum(greatest(0, g.registros)), 0),
        'aceitos', coalesce(sum(least(greatest(0, g.aceitos), greatest(0, g.registros))), 0))
      FROM (
        SELECT coalesce(sum(CASE WHEN jsonb_typeof(l.contagens -> 'registros') = 'number'
                   THEN (l.contagens ->> 'registros')::numeric END), 0) AS registros,
               coalesce(sum(CASE WHEN jsonb_typeof(l.contagens -> 'hub' -> 'recebidas') = 'number'
                   THEN greatest(0, (l.contagens -> 'hub' ->> 'recebidas')::numeric
                     - CASE WHEN jsonb_typeof(l.contagens -> 'hub' -> 'com_erro') = 'number'
                         THEN (l.contagens -> 'hub' ->> 'com_erro')::numeric ELSE 0 END) END), 0) AS aceitos
          FROM integracao_fdv.lote_envio l
         WHERE l.tenant_id = v_t AND l.deleted_at IS NULL AND NOT l.repetido AND l.estado = ANY (v_estados)
         GROUP BY l.estado) g),
    'envios', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'entidade', x.entidade, 'estado', x.estado,
          'registros', x.registros, 'aceitos', x.aceitos, 'com_erro', x.com_erro,
          'enviado_em', plataforma.instante_iso(x.enviado_em), 'concluido_em', plataforma.instante_iso(x.concluido_em))
        ORDER BY x.created_at DESC, x.id DESC) FILTER (WHERE x.pos <= v_limite), '[]'::jsonb)
      FROM (
        SELECT l.id, l.entidade::text AS entidade, l.estado, l.created_at, l.enviado_em, l.concluido_em,
               CASE WHEN jsonb_typeof(l.contagens -> 'registros') = 'number' THEN (l.contagens ->> 'registros')::numeric
                    ELSE 0 END AS registros,
               CASE WHEN jsonb_typeof(l.contagens -> 'hub' -> 'recebidas') = 'number'
                    THEN greatest(0, (l.contagens -> 'hub' ->> 'recebidas')::numeric
                      - CASE WHEN jsonb_typeof(l.contagens -> 'hub' -> 'com_erro') = 'number'
                          THEN (l.contagens -> 'hub' ->> 'com_erro')::numeric ELSE 0 END) END AS aceitos,
               CASE WHEN jsonb_typeof(l.contagens -> 'hub' -> 'com_erro') = 'number'
                    THEN (l.contagens -> 'hub' ->> 'com_erro')::numeric END AS com_erro,
               row_number() OVER (ORDER BY l.created_at DESC, l.id DESC) AS pos
          FROM integracao_fdv.lote_envio l
         WHERE l.tenant_id = v_t AND l.deleted_at IS NULL AND NOT l.repetido AND l.estado = ANY (v_estados)
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT v_limite + 1) x),
    'envios_cortados', (
      SELECT count(*) > v_limite FROM (
        SELECT 1 FROM integracao_fdv.lote_envio l
         WHERE l.tenant_id = v_t AND l.deleted_at IS NULL AND NOT l.repetido AND l.estado = ANY (v_estados)
         LIMIT v_limite + 1) y));
END $$;

REVOKE ALL ON FUNCTION integracao_fdv.portal_ligacoes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.portal_ligacoes(uuid) TO macuxierp_config;

COMMENT ON FUNCTION integracao_fdv.portal_ligacoes(uuid) IS
  'Portal /config (0088): a ligação ERP → Macuxi FDV da empresa visível, os mesmos números do lerLigacoes (GET /v1/integracao-fdv/ligacoes, RN-INF-13): {contato {credencial_ativa, conector_id, ambiente, chave_prefixo, habilitadas, ultimo_contato_em}, contadores {enviados, aceitos}, envios [até 50 {id, entidade, estado, registros, aceitos, com_erro, enviado_em, concluido_em}], envios_cortados}. A situação do Contato fica com quem chama (situacaoConectorFdv do SDK). Sem a chave nem dado pessoal; sem trava nem auditoria. Só macuxierp_config. ADR 0012, ADR 0013. T-0131.';
