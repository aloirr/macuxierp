-- 0059 — Backfill da core.empresa a partir da filial padrão (T-0100, v0.3.13; RN-CORE-14). Só dado: sem DDL, sem
-- função nova. Reexecutável: tenant que já tem a linha (mesmo excluída) não muda e a segunda execução não cria nada.
-- O porquê e as premissas: docs/banco/README.md, seção da 0059.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_criadas integer;
  v_existentes integer;
  v_sem_filial integer;
  v_sem_dados integer;
BEGIN
  -- A migração roda como a dona das tabelas e a RLS não é forçada (sem FORCE RLS), como na 0037.
  WITH c AS (
    SELECT t.id, t.fuso, f.filial_id, f.razao_social, f.nome_fantasia, f.cnpj, f.ie,
           EXISTS (SELECT 1 FROM core.empresa e WHERE e.tenant_id = t.id) AS tem_empresa,
           -- RN-CORE-14: só filial padrão viva com razão social e CNPJ preenchidos.
           (nullif(btrim(f.razao_social), '') IS NOT NULL AND f.cnpj IS NOT NULL) AS dados_minimos
      FROM plataforma.tenant t
      LEFT JOIN LATERAL (
        SELECT cf.id AS filial_id, cf.razao_social, cf.nome_fantasia, cf.cnpj, cf.ie FROM cadastros.filial cf
         WHERE cf.tenant_id = t.id AND cf.padrao AND cf.deleted_at IS NULL
         ORDER BY cf.created_at, cf.id LIMIT 1
      ) f ON true
     WHERE t.deleted_at IS NULL AND t.id <> plataforma.tenant_referencia()
  ), ins AS (
    INSERT INTO core.empresa (tenant_id, razao_social, nome_fantasia, cnpj, ie, fuso)
    SELECT c.id, c.razao_social, c.nome_fantasia, c.cnpj, c.ie, c.fuso
      FROM c WHERE NOT c.tem_empresa AND c.filial_id IS NOT NULL AND c.dados_minimos
    ON CONFLICT (tenant_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins),
         count(*) FILTER (WHERE c.tem_empresa),
         count(*) FILTER (WHERE NOT c.tem_empresa AND c.filial_id IS NULL),
         count(*) FILTER (WHERE NOT c.tem_empresa AND c.filial_id IS NOT NULL AND NOT c.dados_minimos)
    INTO v_criadas, v_existentes, v_sem_filial, v_sem_dados
    FROM c;

  -- Só contagens de tenants (LGPD, regra 8): nem CNPJ, nem razão social, nem id de tenant.
  RAISE NOTICE '0059: core.empresa criadas=%, ja_existentes=%, sem_filial_padrao=%, sem_dados_minimos=%', v_criadas,
    v_existentes, v_sem_filial, v_sem_dados;
END $$;
