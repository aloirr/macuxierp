-- 0080 — Empresas do /config: busca também pelo nome; tem_fdv na empresa (v0.3.31, T-0134).
-- Aditiva e reexecutável (só CREATE OR REPLACE, mesmas assinaturas; sem coluna nova). A versão anterior da API roda
-- sobre ela: o JSON só ganha a chave tem_fdv, e o z.object do SDK (EmpresaPlataforma) ignora a chave que não conhece.
-- O porquê: docs/banco/README.md, seção "Empresas do /config: busca e tem_fdv (0080)".

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- empresa_json (0033, ampliada na 0035): + tem_fdv, o integracao-fdv licenciado e ativo (plataforma.modulo_licenciado,
-- 0040: linha não excluída, ativo, valido_ate nulo ou futuro), o mesmo critério do moduloLicenciado do SDK.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.empresa_json(p_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'nome', t.nome, 'fuso', t.fuso, 'situacao', t.situacao,
    'razao_social', e.razao_social, 'cnpj', e.cnpj::text,
    'cidade', f.cidade, 'uf', f.uf,
    'modulos', plataforma.licencas_json(t.id),
    'tem_fdv', plataforma.modulo_licenciado(t.id, 'integracao-fdv'),
    'primeiro_admin', (SELECT jsonb_build_object('id', u.id, 'ativo', u.ativo,
                         'bloqueado', coalesce(u.bloqueado_ate > now(), false),
                         'email_mascarado', plataforma.mascarar_email(u.email))
                       FROM plataforma.usuario u WHERE u.id = plataforma.primeiro_admin(t.id)),
    'created_at', plataforma.instante_iso(t.created_at),
    'updated_at', plataforma.instante_iso(t.updated_at))
  FROM plataforma.tenant t
  LEFT JOIN LATERAL (
    SELECT ce.razao_social, ce.cnpj FROM core.empresa ce
    WHERE ce.tenant_id = t.id AND ce.deleted_at IS NULL
    ORDER BY ce.created_at, ce.id LIMIT 1
  ) e ON true
  LEFT JOIN LATERAL (
    SELECT cf.uf,
      (SELECT m.nome FROM cadastros.municipio m
       WHERE m.tenant_id = plataforma.tenant_referencia() AND m.codigo = cf.municipio_ibge AND m.deleted_at IS NULL
         AND m.vigencia_inicio <= current_date AND (m.vigencia_fim IS NULL OR m.vigencia_fim >= current_date)
       ORDER BY m.vigencia_inicio DESC LIMIT 1) AS cidade
    FROM cadastros.filial cf
    WHERE cf.tenant_id = t.id AND cf.padrao AND cf.deleted_at IS NULL
    ORDER BY cf.created_at, cf.id LIMIT 1
  ) f ON true
  WHERE t.id = p_id
$$;
COMMENT ON FUNCTION plataforma.empresa_json(uuid) IS
  'Interna (0033, ampliada na 0035 e na 0080): a empresa no formato EmpresaPlataforma do SDK (portal-config.ts), com razao_social e cnpj (core.empresa), cidade e uf da filial padrão (null se não houver), tem_fdv (integracao-fdv licenciado e ativo, plataforma.modulo_licenciado; sempre booleano) e primeiro_admin.email_mascarado; nunca o e-mail completo nem o nome do admin. Única função de plataforma que lê schema de módulo, só para exibição (emenda da ADR 0012 §4). T-0050, T-0134.';

-- ---------------------------------------------------------------------------------------------------------------
-- empresas_listar (0033): a busca (minúsculas, sem espaço nas pontas) casa como trecho do slug ou do nome
-- (lower(t.nome)). A razão social fica fora: está no core.empresa, e só a empresa_json pode ler schema de módulo
-- (emenda da ADR 0012 §4, travada no teste da 0033). strpos é literal: % e _ da busca não são curinga. Sem acento a
-- mais: "sao" não casa "São".
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.empresas_listar(p_busca text, p_cursor uuid, p_limite integer)
  RETURNS SETOF jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_busca text := nullif(lower(btrim(p_busca)), '');
BEGIN
  -- Paginação por id, como o contrato (ConsultaPaginada, paginaDe e paginar de packages/platform-sdk/src/listas.ts).
  -- O limite fica em 1..201: a API pede limite + 1 (LIMITE_MAXIMO 200 + 1) para saber se há próxima página.
  RETURN QUERY
  SELECT plataforma.empresa_json(t.id)
  FROM plataforma.tenant t
  WHERE plataforma.empresa_visivel(t)
    AND (v_busca IS NULL
         OR strpos(t.slug, v_busca) > 0
         OR strpos(lower(t.nome), v_busca) > 0)
    AND (p_cursor IS NULL OR t.id > p_cursor)
  ORDER BY t.id
  LIMIT greatest(1, least(coalesce(p_limite, 201), 201));
END $$;
COMMENT ON FUNCTION plataforma.empresas_listar(text, uuid, integer) IS
  'Portal /config (0033, busca ampliada na 0080): empresas (sem a de referência e sem excluídas) por id, com busca (trecho, sem diferença de maiúsculas) no slug ou no nome e cursor por id (contrato de listas.ts); limite 1..201 (a API pede limite + 1, LIMITE_MAXIMO 200 + 1). Só macuxierp_config. T-0050, T-0134.';

-- Privilégios iguais aos da 0033 e da 0035 (o CREATE OR REPLACE os mantém; repetidos para a reexecução isolada).
REVOKE ALL ON FUNCTION plataforma.empresa_json(uuid), plataforma.empresas_listar(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresas_listar(text, uuid, integer) TO macuxierp_config;
