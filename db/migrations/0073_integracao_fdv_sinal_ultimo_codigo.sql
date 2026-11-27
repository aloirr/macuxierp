-- 0073 — integracao_fdv.sinal.ultimo_codigo e pausada_em no portal_ler (v0.3.18). O worker já tem UPDATE (0007); a RLS não muda. Aditiva e reexecutável. Motivo em docs/banco/README.md (0073).

SET LOCAL lock_timeout = '5s';

ALTER TABLE integracao_fdv.sinal ADD COLUMN IF NOT EXISTS ultimo_codigo text CONSTRAINT sinal_ultimo_codigo_check CHECK (ultimo_codigo ~ '^[a-z][a-z0-9_]{0,59}$');

COMMENT ON COLUMN integracao_fdv.sinal.ultimo_codigo IS
  'Código do Hub ou http_<status> da última falha do sinal (0073, v0.3.18); nulo sem falha registrada.';

-- O portal_ler (/config) devolve o jsonb do portal_estado (0038): cada item de cadastros[] ganha pausada_em (o do cursor),
-- para a A2 calcular a proxima_tentativa_em. Mesma assinatura, SECURITY DEFINER e search_path; CREATE OR REPLACE mantém o
-- ACL (REVOKE de PUBLIC da 0038). As escritas do portal que devolvem o estado também trazem a chave nova.
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
          'pausada_em', plataforma.instante_iso(k.pausada_em),
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
REVOKE ALL ON FUNCTION integracao_fdv.portal_estado(uuid) FROM PUBLIC;
COMMENT ON FUNCTION integracao_fdv.portal_estado(uuid) IS
  'Interna (0038, 0073): o jsonb do portal (empresa_id, modulo_licenciado, credencial sem a chave, entidades_habilitadas, limite_registros_lote, sinal sem politica_versao e os 10 cadastros da F2 com habilitada, ligada, pausada_motivo, pausada_em, lote_em_voo, ultimo_envio_em, ultimo_lote {estado, erro_codigo, em} e erros_abertos). T-0056.';
