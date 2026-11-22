-- 0031 — plataforma.tenants_todos() para a purga de 400 dias do sefaz_simulador em todos os tenants (T-0045,
-- R-20261122-042557; LGPD, regra 8). Aditiva e reexecutável. Molde: plataforma.tenants_ativos() da 0009.
-- Sem filtro de situação nem de deleted_at: o tenant suspenso, encerrado ou excluído também precisa da purga.
-- SECURITY DEFINER porque roda sem tenant (dono da tabela, sem FORCE RLS), como a tenants_ativos; devolve só os ids.
CREATE OR REPLACE FUNCTION plataforma.tenants_todos() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT id FROM plataforma.tenant ORDER BY id
$$;
COMMENT ON FUNCTION plataforma.tenants_todos() IS
  'Ids de todos os tenants (qualquer situação, inclusive excluídos), sem tenant na sessão; só o macuxierp_worker executa. Uso: purga de 400 dias do sefaz_simulador (LGPD). T-0045, 0031.';
REVOKE ALL ON FUNCTION plataforma.tenants_todos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.tenants_todos() TO macuxierp_worker;
