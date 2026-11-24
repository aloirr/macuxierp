-- 0049 — Código de empresa "MACUXI" reservado ao login do superadmin (T-0076, v0.3.10). Aditiva e reexecutável.
--
-- Demanda "Login único com Empresa sempre visível": o superadmin entra no login único com a empresa "MACUXI" e cai no
-- /config. Por isso nenhuma empresa pode ter o código (slug) 'macuxi', em nenhuma grafia: o login compara
-- lower(btrim()) (plataforma.tenant_por_slug, 0002), então 'MACUXI', 'macuxi' e ' Macuxi ' são o mesmo código.
-- Códigos que só começam por macuxi ('macuxi2', 'macuxifdv') continuam livres.
--
-- O que entra, nesta ordem:
-- (a) conferência: alguma linha de plataforma.tenant com o código, inclusive excluída (deleted_at preenchido), aborta
--     a migração (RAISE EXCEPTION, só com o id da empresa). A migração roda como a dona da tabela, sem FORCE RLS, então
--     vê todas as linhas;
-- (b) CHECK tenant_slug_macuxi_reservado em plataforma.tenant, validado (a conferência garante que nenhuma linha
--     viola): INSERT ou UPDATE direto com o código = check_violation (23514);
-- (c) plataforma.empresa_criar: mesma assinatura e corpo da 0037 (CREATE OR REPLACE), com a recusa antes do INSERT:
--     'slug reservado', check_violation, DETAIL 'codigo_reservado_superadmin'. SECURITY DEFINER, search_path, COMMENT e
--     REVOKE/GRANT refeitos iguais aos da 0037.
--
-- Pendência fora do banco: SLUGS_RESERVADOS (packages/platform-sdk/src/portal-config.ts, engenheiro-software) ganha
-- 'macuxi' por recado; até lá a API recebe o 23514 do banco.

SET LOCAL lock_timeout = '5s';

-- (a) Conferência: nenhuma empresa, nem excluída, com o código reservado. -----------------------------------------
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT t.id INTO v_id FROM plataforma.tenant t WHERE lower(btrim(t.slug)) = 'macuxi' LIMIT 1;
  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION '0049: o código macuxi é reservado ao login do superadmin e está na empresa %', v_id
      USING ERRCODE = 'check_violation', DETAIL = 'codigo_reservado_em_uso',
            HINT = 'troque o código dessa empresa antes de aplicar a 0049';
  END IF;
END $$;

-- (b) CHECK na tabela. ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'plataforma.tenant'::regclass AND conname = 'tenant_slug_macuxi_reservado') THEN
    ALTER TABLE plataforma.tenant
      ADD CONSTRAINT tenant_slug_macuxi_reservado CHECK (lower(btrim(slug)) <> 'macuxi');
  END IF;
END $$;

-- (c) empresa_criar com a recusa do código reservado. --------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.empresa_criar(p_slug text, p_nome text, p_fuso text, p_request_id text,
  p_uf text DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_slug text := lower(btrim(p_slug));
  v_uf text := lower(btrim(p_uf));
  v_fuso text := coalesce(nullif(btrim(p_fuso), ''), 'America/Manaus');
  v_id uuid := gen_random_uuid();
BEGIN
  -- Espelho de SLUGS_RESERVADOS (packages/platform-sdk/src/portal-config.ts): mudou lá, muda aqui (migração nova).
  IF v_slug IN ('referencia', 'config', 'plataforma') THEN
    RAISE EXCEPTION 'slug reservado' USING ERRCODE = 'check_violation';
  END IF;
  -- T-0076 (0049): 'macuxi' é a empresa do login do superadmin; o CHECK tenant_slug_macuxi_reservado também barra.
  IF v_slug = 'macuxi' THEN
    RAISE EXCEPTION 'slug reservado' USING ERRCODE = 'check_violation', DETAIL = 'codigo_reservado_superadmin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_fuso) THEN
    RAISE EXCEPTION 'fuso desconhecido' USING ERRCODE = 'check_violation';
  END IF;
  IF v_slug IS NOT NULL THEN
    IF v_uf IS NOT NULL AND (v_uf = '' OR left(v_slug, length(v_uf)) <> v_uf) THEN
      RAISE EXCEPTION 'uf difere do codigo' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_slug := plataforma.sortear_slug(v_uf);
  END IF;
  -- Slug repetido cai no unique_violation natural de plataforma.tenant.slug.
  INSERT INTO plataforma.tenant (id, tenant_id, slug, nome, fuso, situacao)
  VALUES (v_id, v_id, v_slug, btrim(p_nome), v_fuso, 'ativo');
  INSERT INTO plataforma.tenant_modulo (tenant_id, modulo, ativo) VALUES (v_id, 'core', true);
  PERFORM plataforma.auditar_superadmin(v_id, v_sa, 'plataforma.empresa.criar', 'tenant', v_id, NULL,
    jsonb_build_object('slug', v_slug, 'situacao', 'ativo', 'modulos', jsonb_build_array('core')), p_request_id);
  RETURN plataforma.empresa_json(v_id);
END $$;
COMMENT ON FUNCTION plataforma.empresa_criar(text, text, text, text, text) IS
  'Portal /config (0037; antes 0033, de 4 argumentos): cria a empresa (ativa, com a licença do core) e audita sem o nome. Com p_slug: slug informado (reservado = check_violation; repetido = unique_violation) e p_uf, se vier, tem de ser o prefixo dele (senão check_violation). Sem p_slug: p_uf entre as 27 (senão check_violation) e código sorteado no formato da licença do FDV (sortear_slug; sem código livre = unique_violation). Fuso desconhecido = check_violation. Só macuxierp_config. T-0053.';
REVOKE ALL ON FUNCTION plataforma.empresa_criar(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_criar(text, text, text, text, text) TO macuxierp_config;
