-- 0066 — Sai a integracao_fdv.expurgar_pre_cadastro_recusado da 0057 (T-0104, RD-1810 e RD-1813 do #622).
-- Reexecutável. O porquê: docs/banco/README.md, seção da 0066.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS integracao_fdv.expurgar_pre_cadastro_recusado(timestamptz);

COMMENT ON FUNCTION integracao_fdv.expurgar_pre_cadastro(timestamptz) IS
  'RN-INF-06 (LGPD), rotina diária do worker no tenant da sessão (sem app.tenant_id = 42501). p_corte nulo ou depois de agora − 180 dias = check_violation. Anula payload, razao_social e documento_mascarado e marca payload_expurgado_em: no recusado, quando nenhuma revisão do mesmo pré-cadastro (cliente_uuid) tem recusa em p_corte ou depois; no recebido e no reenviado, quando recebido_em e chegou_em são anteriores a p_corte. Ficam os códigos, os erros e as contagens. Audita integracao-fdv.pre-cadastro.expurgar só com as contagens (quando há o que expurgar). Devolve {recusado: {revisoes, pre_cadastros}, sem_decisao: {revisoes, pre_cadastros}}. Só macuxierp_worker. T-0098, T-0104.';
