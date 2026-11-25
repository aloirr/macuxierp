-- 0067 — Sai a integracao_fdv.expurgar_pre_cadastro_recusado da 0057 (T-0104, RD-1810 e RD-1813 do #622).
-- Reexecutável. O porquê: docs/banco/README.md, seção da 0067.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS integracao_fdv.expurgar_pre_cadastro_recusado(timestamptz);

COMMENT ON FUNCTION integracao_fdv.expurgar_pre_cadastro(timestamptz) IS
  'RN-INF-06 (LGPD), expurgo diário do pré-cadastro no tenant da sessão. p_corte nulo ou depois de agora − 180 dias = 23514; sem app.tenant_id = 42501. Devolve {recusado: {revisoes, pre_cadastros}, sem_decisao: {revisoes, pre_cadastros}}. Regras: docs/banco/README.md.';
