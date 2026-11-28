-- 0085 — Empresas do /config: a busca casa também a razão social (v0.3.32).
-- Aditiva e reexecutável (só CREATE OR REPLACE da empresas_listar, mesma assinatura, mesmos privilégios; sem coluna,
-- índice nem tabela nova). A versão anterior da API roda sobre ela: a resposta não muda de formato, só a lista casa mais.
-- O porquê: docs/banco/README.md, seção "Empresas do /config: busca pela razão social (0085)".

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- empresas_listar (0033, 0080): a busca (minúsculas, sem espaço nas pontas) casa como trecho do slug, do nome
-- (lower(t.nome)) ou da razão social. A razão social vem da plataforma.empresa_json (chave razao_social), que continua
-- a única função de plataforma a ler schema de módulo (emenda da ADR 0012 §4, travada no teste da 0033): esta função
-- não cita core.empresa. strpos é literal: % e _ da busca não são curinga. Sem acento a mais: "sao" não casa "São".
-- O json só é montado para a empresa que não casou pelo slug nem pelo nome (o CASE garante a ordem); são poucas
-- linhas por instalação (uma por tenant), e o core.empresa é lido pelo tenant_id, então não há índice a criar.
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
         OR CASE WHEN strpos(t.slug, v_busca) > 0 OR strpos(lower(t.nome), v_busca) > 0 THEN true
                 ELSE coalesce(strpos(lower(plataforma.empresa_json(t.id) ->> 'razao_social'), v_busca) > 0, false)
            END)
    AND (p_cursor IS NULL OR t.id > p_cursor)
  ORDER BY t.id
  LIMIT greatest(1, least(coalesce(p_limite, 201), 201));
END $$;
COMMENT ON FUNCTION plataforma.empresas_listar(text, uuid, integer) IS
  'Portal /config (0033, busca ampliada na 0080 e na 0085): empresas (sem a de referência e sem excluídas) por id, com busca (trecho, sem diferença de maiúsculas) no slug, no nome ou na razão social (esta pela empresa_json, a única que lê core.empresa, emenda da ADR 0012 §4) e cursor por id (contrato de listas.ts); limite 1..201 (a API pede limite + 1, LIMITE_MAXIMO 200 + 1). Só macuxierp_config. T-0050, T-0134, v0.3.32.';

-- Privilégios iguais aos da 0033 e da 0080 (o CREATE OR REPLACE os mantém; repetidos para a reexecução isolada).
REVOKE ALL ON FUNCTION plataforma.empresas_listar(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresas_listar(text, uuid, integer) TO macuxierp_config;
