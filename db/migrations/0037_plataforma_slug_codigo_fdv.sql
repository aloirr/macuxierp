-- 0037 — Código da empresa = código da licença do FDV (T-0053, v0.3.3; ADR 0012). Aditiva e reexecutável.
--
-- Decisão do Alexandre (23/11/2026, via gerente-projetos, aprovada às 11h15 de Manaus): o código (slug) da empresa no
-- ERP passa a ser o mesmo da licença do Macuxi FDV, no formato UF + 4 dígitos (ex.: am2808). A troca da empresa
-- 'thathyany' para 'am2808' entra pelo deploy, nesta migração, sem passo manual. Assinatura de empresa_criar decidida
-- pelo engenheiro-software (T-0053).
--
-- O que entra, nesta ordem:
-- (a) troca única thathyany -> am2808 (origem: código da licença do FDV): só se 'thathyany' existe e 'am2808' ainda
--     não; grava plataforma.auditoria (acao 'plataforma.empresa.codigo_fdv', antes/depois só com o slug, sem usuário
--     nem superadmin: o autor é a migração, request_id 'migracao-0037'). 'am2808' já em outro tenant = só NOTICE.
--     Reexecutar não faz nada (já não há 'thathyany'). A migração roda como a dona das tabelas, e a RLS da 0002 não é
--     forçada (sem FORCE RLS), então não precisa de app.tenant_id;
-- (b) plataforma.sortear_slug(p_uf): interna (sem EXECUTE para ninguém), sorteia lower(UF) + 4 dígitos, pulando
--     slug que já existe (inclusive empresa excluída: o UNIQUE de plataforma.tenant.slug vale para todas); até 20
--     tentativas, esgotou = unique_violation. UF fora das 27 siglas = check_violation;
-- (c) plataforma.empresa_criar(p_slug, p_nome, p_fuso, p_request_id, p_uf DEFAULT NULL): a de 4 argumentos da 0033 sai
--     (DROP) e entra a de 5; a chamada posicional de 4 argumentos continua valendo pelo DEFAULT. Com p_slug: igual à
--     0033 (lower(btrim()), reservados, repetido = unique_violation natural) e, se p_uf vier, ela tem de ser o prefixo
--     do slug ('uf difere do codigo'). Sem p_slug: o slug vem de sortear_slug, que recusa p_uf NULL, vazia ou fora
--     das 27 ('uf invalida'). JSON e auditoria 'plataforma.empresa.criar' iguais aos da 0033 (slug final, sem o nome). REVOKE de
--     PUBLIC, GRANT EXECUTE só ao macuxierp_config e COMMENT refeitos aqui.
--
-- Reexecutar a 0033 depois desta recria a de 4 argumentos (CREATE OR REPLACE); reaplicar a 0037 a remove de novo, e
-- fica uma só empresa_criar.

SET LOCAL lock_timeout = '5s';

-- (a) Troca única thathyany -> am2808. ----------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT t.id INTO v_id FROM plataforma.tenant t WHERE t.slug = 'thathyany';
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM plataforma.tenant t WHERE t.slug = 'am2808') THEN
    RAISE NOTICE '0037: código am2808 já existe em outra empresa; troca de thathyany não aplicada';
    RETURN;
  END IF;
  UPDATE plataforma.tenant SET slug = 'am2808' WHERE id = v_id;
  INSERT INTO plataforma.auditoria (tenant_id, usuario_id, superadmin_id, acao, entidade, entidade_id, antes, depois,
    request_id)
  VALUES (v_id, NULL, NULL, 'plataforma.empresa.codigo_fdv', 'tenant', v_id, jsonb_build_object('slug', 'thathyany'),
    jsonb_build_object('slug', 'am2808'), 'migracao-0037');
END $$;

-- (b) Sorteio do código: UF + 4 dígitos. ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.sortear_slug(p_uf text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_uf text := upper(btrim(p_uf));
  v_slug text;
BEGIN
  IF v_uf IS NULL OR v_uf NOT IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO') THEN
    RAISE EXCEPTION 'uf invalida' USING ERRCODE = 'check_violation';
  END IF;
  FOR i IN 1..20 LOOP
    -- Um random() por tentativa (o teste reproduz a sequência com setseed).
    v_slug := lower(v_uf) || lpad((floor(random() * 10000))::int::text, 4, '0');
    IF NOT EXISTS (SELECT 1 FROM plataforma.tenant t WHERE t.slug = v_slug) THEN
      RETURN v_slug;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'sem código livre para a UF' USING ERRCODE = 'unique_violation';
END $$;
COMMENT ON FUNCTION plataforma.sortear_slug(text) IS
  'Interna (0037): sorteia o código da empresa no formato da licença do FDV, lower(UF) + 4 dígitos, pulando código existente (inclusive de empresa excluída); até 20 tentativas (esgotou = unique_violation); UF fora das 27 = check_violation. Sem EXECUTE para ninguém. T-0053.';
REVOKE ALL ON FUNCTION plataforma.sortear_slug(text) FROM PUBLIC;

-- (c) empresa_criar com slug informado ou sorteado pela UF. --------------------------------------------------------
DROP FUNCTION IF EXISTS plataforma.empresa_criar(text, text, text, text);
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
