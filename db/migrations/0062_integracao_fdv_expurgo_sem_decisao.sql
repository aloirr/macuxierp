-- 0062 — Expurgo do pré-cadastro sem decisão (T-0098, RN-INF-06; decisão do Alexandre R-20261124-214227, opção A).
-- Aditiva e reexecutável: dois CHECKs trocados por outros mais largos (a versão anterior grava o mesmo de sempre),
-- um índice, uma função nova e COMMENT. A expurgar_pre_cadastro_recusado da 0057 fica como está (o worker do main a
-- chama). O porquê: docs/banco/README.md, seção da 0062.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- 1. CHECKs mais largos
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE integracao_fdv.cliente_recebido DROP CONSTRAINT IF EXISTS cliente_recebido_payload,
  ADD CONSTRAINT cliente_recebido_payload CHECK (CASE situacao
    WHEN 'aceito' THEN payload IS NULL
    ELSE (payload IS NULL) = (payload_expurgado_em IS NOT NULL) END);
-- a recusa do recusado já está no cliente_recebido_ultima_recusa
ALTER TABLE integracao_fdv.cliente_recebido DROP CONSTRAINT IF EXISTS cliente_recebido_expurgo,
  ADD CONSTRAINT cliente_recebido_expurgo CHECK (CASE WHEN payload_expurgado_em IS NULL THEN razao_social IS NOT NULL
    ELSE razao_social IS NULL AND documento_mascarado IS NULL END);

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Índice da busca do sem-decisão que ainda guarda o payload
-- ---------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cliente_recebido_expurgo_sem_decisao_idx ON integracao_fdv.cliente_recebido
  (tenant_id, recebido_em) WHERE situacao IN ('recebido', 'reenviado') AND payload IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. integracao_fdv.expurgar_pre_cadastro(p_corte): recusado (regra da 0057) e sem decisão, numa passada só
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION integracao_fdv.expurgar_pre_cadastro(p_corte timestamptz) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_t uuid := plataforma.tenant_atual();
  v_r jsonb;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'sem tenant na sessão (app.tenant_id)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_corte IS NULL OR p_corte > now() - interval '180 days' THEN
    RAISE EXCEPTION 'corte antes do prazo de 180 dias da RN-INF-06' USING ERRCODE = 'check_violation';
  END IF;
  WITH alvo AS (
    SELECT r.id FROM integracao_fdv.cliente_recebido r
     WHERE r.tenant_id = v_t AND r.payload IS NOT NULL
       AND ((r.situacao = 'recusado' AND r.ultima_recusa_em < p_corte
             AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_recebido o
                              WHERE o.tenant_id = v_t AND o.cliente_uuid = r.cliente_uuid AND o.ultima_recusa_em >= p_corte))
         OR (r.situacao IN ('recebido', 'reenviado') AND r.recebido_em < p_corte AND r.chegou_em < p_corte))
     ORDER BY r.id FOR UPDATE),
  u AS (
    UPDATE integracao_fdv.cliente_recebido r
       SET payload = NULL, razao_social = NULL, documento_mascarado = NULL, payload_expurgado_em = now()
      FROM alvo WHERE r.id = alvo.id
    RETURNING CASE WHEN r.situacao = 'recusado' THEN 'recusado' ELSE 'sem_decisao' END AS s, r.cliente_uuid)
  SELECT jsonb_build_object(
      'recusado', jsonb_build_object('revisoes', count(*) FILTER (WHERE s = 'recusado'),
        'pre_cadastros', count(DISTINCT cliente_uuid) FILTER (WHERE s = 'recusado')),
      'sem_decisao', jsonb_build_object('revisoes', count(*) FILTER (WHERE s = 'sem_decisao'),
        'pre_cadastros', count(DISTINCT cliente_uuid) FILTER (WHERE s = 'sem_decisao')))
    INTO v_r FROM u;
  IF (v_r #>> '{recusado,revisoes}')::int + (v_r #>> '{sem_decisao,revisoes}')::int > 0 THEN
    INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois)
    VALUES (v_t, NULL, 'integracao-fdv.pre-cadastro.expurgar', 'cliente_recebido', NULL, NULL,
      jsonb_build_object('regra', 'RN-INF-06') || v_r);
  END IF;
  RETURN v_r;
END $$;
COMMENT ON FUNCTION integracao_fdv.expurgar_pre_cadastro(timestamptz) IS
  'RN-INF-06 (LGPD), rotina diária do worker no tenant da sessão (sem app.tenant_id = 42501). p_corte nulo ou depois de agora − 180 dias = check_violation. Anula payload, razao_social e documento_mascarado e marca payload_expurgado_em: no recusado, como a expurgar_pre_cadastro_recusado; no recebido e no reenviado, quando recebido_em e chegou_em são anteriores a p_corte. Audita integracao-fdv.pre-cadastro.expurgar só com as contagens (quando há o que expurgar). Devolve {recusado: {revisoes, pre_cadastros}, sem_decisao: {revisoes, pre_cadastros}}. Só macuxierp_worker. T-0098.';
REVOKE ALL ON FUNCTION integracao_fdv.expurgar_pre_cadastro(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.expurgar_pre_cadastro(timestamptz) TO macuxierp_worker;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. COMMENT ON da 0057 que falavam só do recusado
-- ---------------------------------------------------------------------------------------------------------------
COMMENT ON TABLE integracao_fdv.cliente_recebido IS
  'Pré-cadastro de cliente recebido do Macuxi FDV (GET /integracao/v1/clientes/pendentes), uma linha por (cliente_uuid, revisao). Reenvio = revisão nova (situacao reenviado); a mesma revisão de novo só soma tentativas_fdv. Payload nulo no aceito e expurgado 180 dias depois da última recusa ou, sem decisão, da chegada (RN-INF-06). T-0059, T-0098.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.payload IS
  'O ClienteParaErpFdv recebido (com dado pessoal). Nulo no aceito e depois do expurgo da RN-INF-06 (recusado, recebido e reenviado). Nunca sai na rota do BKO nem no log. T-0059, T-0098.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.payload_expurgado_em IS
  'Quando o expurgo da RN-INF-06 anulou payload, razao_social e documento_mascarado. Só as funções de expurgo gravam. T-0059, T-0098.';
