-- 0039 — MXI04 nas escritas do portal da Integração FDV (T-0056, v0.3.4; pedido do modulo-integracao-fdv via gerente).
-- Aditiva e reexecutável: só CREATE OR REPLACE e COMMENT. Não muda nenhuma linha de dado nem privilégio (CREATE OR
-- REPLACE preserva dono, ACL e SECURITY DEFINER; o REVOKE da 0038 segue valendo: a interna não tem EXECUTE de ninguém).
--
-- Motivo: na 0038 a empresa fora de 'ativo' e o módulo integracao-fdv sem licença ativa e vigente saíam como
-- check_violation (23514) só com texto, e a API não os distinguia dos demais 23514 (entidade fora da F2, limite etc.).
-- Agora saem com SQLSTATE próprio MXI04 e o motivo no DETAIL, que a API traduz em 422 (RN-CORE-02):
-- - DETAIL 'empresa_inativa': empresa visível, mas suspensa ou encerrada (situacao <> 'ativo');
-- - DETAIL 'modulo_desligado': sem linha ativa, não excluída e vigente do integracao-fdv em plataforma.tenant_modulo.
-- A ordem não muda (empresa antes do módulo). Os demais 23514 e o P0002 (empresa de referência, excluída ou
-- inexistente) ficam como na 0038.
--
-- Só muda a interna integracao_fdv.portal_empresa(uuid, boolean), a única que confere empresa e licença; as cinco
-- escritas (portal_credencial_definir, portal_configurar, portal_testar, portal_carga_completa, portal_retomar) a chamam
-- com p_escrita = true. portal_modulo_licenciado(uuid) continua devolvendo boolean e não muda.

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
    RAISE EXCEPTION 'empresa fora de ativo' USING ERRCODE = 'MXI04', DETAIL = 'empresa_inativa';
  END IF;
  IF p_escrita AND NOT integracao_fdv.portal_modulo_licenciado(t.id) THEN
    RAISE EXCEPTION 'módulo integracao-fdv desligado na empresa' USING ERRCODE = 'MXI04', DETAIL = 'modulo_desligado';
  END IF;
  RETURN t.id;
END $$;
COMMENT ON FUNCTION integracao_fdv.portal_empresa(uuid, boolean) IS
  'Interna (0038, 0039): confere a empresa alvo do portal com FOR KEY SHARE (visível: não é a de referência nem excluída; senão no_data_found); para escrita, ativa (senão MXI04, DETAIL empresa_inativa) e com o módulo integracao-fdv licenciado e ativo (senão MXI04, DETAIL modulo_desligado); a API traduz MXI04 em 422 (RN-CORE-02). ADR 0013. T-0056.';
