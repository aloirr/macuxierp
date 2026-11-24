-- 0046 — Auditoria da carga do portal /config com os endereços inativados pelo "Substituir tudo" do cliente
-- (T-0072, v0.3.8; RN-CAD-10).
--
-- cadastros.portal_carga_concluir (0040; a 0044 não a redefiniu) só recebia p_inativadas: os endereços que o
-- "Substituir tudo" do cliente inativa (o cliente_endereco entrou no cliente na 0044) não chegavam à auditoria.
-- Entra o último parâmetro p_enderecos_inativados integer DEFAULT NULL: não nulo, o `depois` da auditoria
-- cadastros.carga.concluir ganha a chave enderecos_inativados; nulo (ou omitido), o `depois` fica igual ao de antes.
-- Negativo = check_violation, DETAIL execucao_invalida (como as outras contagens). A coluna não vai para
-- cadastros.carga_portal: o dado é só de auditoria.
--
-- Acrescentar parâmetro muda a assinatura: DROP FUNCTION IF EXISTS da assinatura de 7 argumentos (senão ficariam duas
-- sobrecargas e a chamada de 7 argumentos seria ambígua) e CREATE OR REPLACE da de 8. Nenhuma view, função SQL ou
-- regra depende dela (a chamada é dinâmica, de PL/pgSQL e da API), então o DROP não precisa de CASCADE.
-- Aditiva: a API atual chama com 7 argumentos posicionais e segue igual (o 8º vem do DEFAULT). Reexecutável: DROP IF
-- EXISTS, CREATE OR REPLACE, COMMENT, REVOKE e GRANT. Não muda nenhuma linha de dado.

DROP FUNCTION IF EXISTS cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text);

CREATE OR REPLACE FUNCTION cadastros.portal_carga_concluir(p_tenant uuid, p_execucao_id uuid, p_resultado text,
  p_gravadas integer, p_com_erro integer, p_inativadas integer, p_request_id text,
  p_enderecos_inativados integer DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  e cadastros.carga_portal;
  v_depois jsonb;
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
  IF p_gravadas IS NULL OR p_gravadas < 0 OR p_com_erro IS NULL OR p_com_erro < 0 OR p_inativadas < 0
     OR p_enderecos_inativados < 0 THEN
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
  v_depois := jsonb_build_object('cadastro', e.cadastro, 'modo', e.modo, 'resultado', p_resultado,
    'gravadas', p_gravadas, 'com_erro', p_com_erro, 'inativadas', p_inativadas);
  IF p_enderecos_inativados IS NOT NULL THEN
    v_depois := v_depois || jsonb_build_object('enderecos_inativados', p_enderecos_inativados);
  END IF;
  PERFORM plataforma.auditar_superadmin(e.tenant_id, v_sa, 'cadastros.carga.concluir', 'carga_portal', e.id, NULL,
    v_depois, p_request_id);
END $$;
COMMENT ON FUNCTION cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text, integer) IS
  'Portal /config (0040; 0046, RN-CAD-10): tx3 do Gravar. Fecha a execução aberta da empresa (senão check_violation, DETAIL execucao_invalida) com resultado concluida|falhou e as contagens (>= 0; inativadas nula fora do Substituir tudo e obrigatória no Substituir tudo concluído) e audita cadastros.carga.concluir. p_enderecos_inativados (DEFAULT NULL, >= 0): os endereços inativados pelo Substituir tudo do cliente, só na auditoria (chave enderecos_inativados no depois, ausente quando nulo). Só macuxierp_config. T-0058, T-0072.';

-- Privilégios: os mesmos da 0040 (nada para PUBLIC; só macuxierp_config executa).
REVOKE ALL ON FUNCTION cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text, integer)
  TO macuxierp_config;
