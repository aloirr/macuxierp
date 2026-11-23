-- 0035 — Dados da empresa no portal /config (T-0050; ADR 0012, seção 4, com a emenda do engenheiro-software). Aditiva e
-- reexecutável: só CREATE OR REPLACE, REVOKE e GRANT.
--
-- O que entra:
-- - interna plataforma.mascarar_email(text): o e-mail mascarado da exibição ('douglas@gmail.com' → 'do****@gmail.com');
-- - plataforma.empresa_json(uuid) passa a devolver razao_social e cnpj (core.empresa), cidade e uf (filial padrão de
--   cadastros.filial, com o nome da cidade de cadastros.municipio) e primeiro_admin.email_mascarado; o resto fica igual;
-- - função nova da lista fechada plataforma.empresa_primeiro_admin_email(uuid, text): revela o e-mail completo do
--   1º administrador ao superadmin e audita a ação ('plataforma.admin.revelar_email') sem o e-mail.
--
-- Decisões do PO (23/11/2026, 09h17 de Manaus), aprovadas pelo Alexandre via gerente-projetos (09h19):
-- - cidade e UF da filial padrão aparecem só para leitura no portal (nada de escrita em schema de módulo);
-- - o e-mail do 1º administrador aparece mascarado; o completo só pela função de revelar;
-- - revelar é auditado, sem o e-mail na auditoria (LGPD, regra 8).
--
-- Premissas (banco-dados):
-- - a filial considerada é a padrao = true não excluída do tenant (índice único filial_uma_padrao da 0004); sem ela,
--   cidade e uf saem null; a uf vem da própria filial e a cidade do município oficial vigente (tenant de referência)
--   pelo municipio_ibge, null se o código não estiver na tabela oficial;
-- - core.empresa não excluída do tenant (uma por tenant, empresa_uma_por_tenant da 0003); sem ela, razao_social e
--   cnpj saem null;
-- - mascarar_email: valor sem '@' vira só '****' (não vaza nada); é SECURITY DEFINER com search_path fixo como as
--   outras internas da 0033 (o teste de privilégios confere o mesmo molde para todas).

-- ---------------------------------------------------------------------------------------------------------------
-- Funções internas (sem EXECUTE para ninguém).
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.mascarar_email(p_email text) RETURNS text
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE
    WHEN p_email IS NULL THEN NULL
    WHEN strpos(p_email, '@') = 0 THEN '****'
    ELSE CASE WHEN length(x.local) <= 2 THEN '*' ELSE left(x.local, 2) END || '****@' || x.dominio
  END
  FROM (SELECT substring(p_email FROM '^(.*)@[^@]*$') AS local, substring(p_email FROM '@([^@]*)$') AS dominio) x
$$;
COMMENT ON FUNCTION plataforma.mascarar_email(text) IS
  'Interna (0035): e-mail mascarado para exibição: 2 primeiros caracteres do local + "****@" + domínio inteiro; local de 1 ou 2 caracteres vira "*"; sem "@" = "****"; NULL = NULL. T-0050.';

-- Exceção da ADR 0012 §4: ver COMMENT abaixo.
CREATE OR REPLACE FUNCTION plataforma.empresa_json(p_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'nome', t.nome, 'fuso', t.fuso, 'situacao', t.situacao,
    'razao_social', e.razao_social, 'cnpj', e.cnpj::text,
    'cidade', f.cidade, 'uf', f.uf,
    'modulos', plataforma.licencas_json(t.id),
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
  'Interna (0033, ampliada na 0035): a empresa no formato EmpresaPlataforma do SDK (portal-config.ts), com razao_social e cnpj (core.empresa), cidade e uf da filial padrão (null se não houver) e primeiro_admin.email_mascarado; nunca o e-mail completo nem o nome do admin. Única função de plataforma que lê schema de módulo, só para exibição (emenda da ADR 0012 §4). T-0050.';

-- ---------------------------------------------------------------------------------------------------------------
-- Lista fechada (ADR 0012 §4): revelar o e-mail do 1º administrador.
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.empresa_primeiro_admin_email(p_id uuid, p_request_id text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
  v_usuario uuid;
  v_email text;
BEGIN
  t := plataforma.empresa_alvo(p_id, false);
  v_usuario := plataforma.primeiro_admin(t.id);
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'a empresa não tem administrador' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT u.email INTO v_email FROM plataforma.usuario u WHERE u.id = v_usuario;
  -- Auditoria sem o e-mail (LGPD, regra 8): só o fato e o campo revelado.
  PERFORM plataforma.auditar_superadmin(t.id, v_sa, 'plataforma.admin.revelar_email', 'usuario', v_usuario, NULL,
    jsonb_build_object('campo', 'email'), p_request_id);
  RETURN v_email;
END $$;
COMMENT ON FUNCTION plataforma.empresa_primeiro_admin_email(uuid, text) IS
  'Portal /config (0035): devolve o e-mail completo do 1º administrador da empresa (no_data_found se não houver) e audita plataforma.admin.revelar_email sem o e-mail. Só macuxierp_config. T-0050.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; a interna sem EXECUTE; a do portal só para macuxierp_config.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION plataforma.mascarar_email(text), plataforma.empresa_json(uuid),
  plataforma.empresa_primeiro_admin_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_primeiro_admin_email(uuid, text) TO macuxierp_config;
