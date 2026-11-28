-- Seed fiscal de EXEMPLO (v0.3.32, T-0127): regras base e tributárias de desenvolvimento, e2e e homologação.
-- NUNCA em produção e NUNCA em migração: o migrar (db/src/migrar.ts, o único que o deploy roda) só lê db/migrations
-- e db/tabelas-fiscais, e a imagem da API (apps/api/Dockerfile) não copia db/seeds. A trava abaixo ainda recusa
-- qualquer banco que não seja efêmero de teste ou de desenvolvimento (macuxi_teste_*, macuxi_dev_*).
-- Valores fictícios, sem regra de cliente real e sem valor fiscal. O título é o da regra, em português claro; o exemplo
-- fica marcado só na fonte_referencia (e na descrição): "Exemplo para demonstração, sem valor fiscal", sem caminho de
-- arquivo nem nome de ambiente, porque o texto aparece na tela.
-- Sem ST interestadual (regra_base_sem_st_interestadual, T-0127): só ICMS interno do AM (00 e 20), IPI, PIS e COFINS.
-- Uso: db/seeds/fiscal-exemplo.ts (sqlSeedFiscalExemplo ou carregarSeedFiscalExemplo), que fixa o tenant de teste em
-- macuxierp.seed_tenant na mesma transação. Idempotente: ON CONFLICT DO NOTHING nos índices únicos
-- (regra_base_chave_uq, regra_tributaria_filtros_uq, regra_tributaria_regra_base_uq e external_id).
-- Escala: percentual em integer escala 4 (20% = 200000), como em fiscal.regra_tributaria (0013).

DO $$
DECLARE
  t text := current_setting('macuxierp.seed_tenant', true);
BEGIN
  IF current_database() !~ '^macuxi_(teste|dev)_' THEN
    RAISE EXCEPTION 'seed fiscal de exemplo recusado no banco %: só roda em banco de teste ou de desenvolvimento',
      current_database() USING ERRCODE = 'P0001';
  END IF;
  IF t IS NULL OR t !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'seed fiscal de exemplo: macuxierp.seed_tenant sem o UUID do tenant de teste' USING ERRCODE = 'P0001';
  END IF;
  IF t::uuid = plataforma.tenant_referencia()
     OR NOT EXISTS (SELECT 1 FROM plataforma.tenant WHERE id = t::uuid AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'seed fiscal de exemplo: tenant de teste % não existe ou é o de referência', t USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ============================================================================================================
-- 1. fiscal.regra_base (catálogo; tenant de referência pelo padrão da coluna)
-- ============================================================================================================
INSERT INTO fiscal.regra_base (chave, titulo, descricao, tributo, ncm_prefixo, uf_origem, uf_destino, crt, cfop, codigo,
  aliquota_icms, reducao_bc, cst_ipi, aliquota_ipi, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins,
  fonte_tipo, fonte_referencia, versao, vigencia_inicio, external_id)
VALUES
  ('exemplo.am.icms.interna.00', 'ICMS interno de AM, regime normal, tributado integralmente',
   'Exemplo para demonstração, sem valor fiscal.', 'icms', NULL, 'AM', 'AM', 3, '5102', '00',
   200000, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   'outro', 'Exemplo para demonstração, sem valor fiscal', 'exemplo-2026.1',
   '2026-01-01', 'seed-exemplo:exemplo.am.icms.interna.00'),
  ('exemplo.am.icms.interna.20', 'ICMS interno de AM, regime normal, com redução da base',
   'Exemplo para demonstração, sem valor fiscal.', 'icms', '8471', 'AM', 'AM', 3, '5102', '20',
   200000, 300000, NULL, NULL, NULL, NULL, NULL, NULL,
   'outro', 'Exemplo para demonstração, sem valor fiscal', 'exemplo-2026.1',
   '2026-01-01', 'seed-exemplo:exemplo.am.icms.interna.20'),
  ('exemplo.ipi.tributado.50', 'IPI tributado na saída',
   'Exemplo para demonstração, sem valor fiscal.', 'ipi', NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, '50', 50000, NULL, NULL, NULL, NULL,
   'outro', 'Exemplo para demonstração, sem valor fiscal', 'exemplo-2026.1',
   '2026-01-01', 'seed-exemplo:exemplo.ipi.tributado.50'),
  ('exemplo.ipi.nao-tributado.53', 'IPI não tributado na saída',
   'Exemplo para demonstração, sem valor fiscal.', 'ipi', '4901', NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, '53', NULL, NULL, NULL, NULL, NULL,
   'outro', 'Exemplo para demonstração, sem valor fiscal', 'exemplo-2026.1',
   '2026-01-01', 'seed-exemplo:exemplo.ipi.nao-tributado.53'),
  ('exemplo.pis.tributado.01', 'PIS tributado à alíquota básica',
   'Exemplo para demonstração, sem valor fiscal.', 'pis', NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, '01', 16500, NULL, NULL,
   'outro', 'Exemplo para demonstração, sem valor fiscal', 'exemplo-2026.1',
   '2026-01-01', 'seed-exemplo:exemplo.pis.tributado.01'),
  ('exemplo.cofins.tributado.01', 'COFINS tributada à alíquota básica',
   'Exemplo para demonstração, sem valor fiscal.', 'cofins', NULL, NULL, NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, '01', 76000,
   'outro', 'Exemplo para demonstração, sem valor fiscal', 'exemplo-2026.1',
   '2026-01-01', 'seed-exemplo:exemplo.cofins.tributado.01')
ON CONFLICT DO NOTHING;

-- ============================================================================================================
-- 2. fiscal.regra_tributaria no tenant de teste: as regras base aplicadas (cópia com regra_base_id, como faz o
--    administrador) e uma cadastrada à mão (sem regra_base_id). ajustar_mva explícito: false (nenhuma é de ST).
-- ============================================================================================================
INSERT INTO fiscal.regra_tributaria (tenant_id, regra_base_id, tributo, ncm_prefixo, uf_origem, uf_destino, crt, cfop,
  codigo, aliquota_icms, reducao_bc, ajustar_mva, cst_ipi, aliquota_ipi, cst_pis, aliquota_pis, cst_cofins,
  aliquota_cofins, fonte_tipo, fonte_referencia, versao, vigencia_inicio, external_id)
SELECT current_setting('macuxierp.seed_tenant')::uuid, b.id, b.tributo, b.ncm_prefixo, b.uf_origem, b.uf_destino,
  b.crt, b.cfop, b.codigo, b.aliquota_icms, b.reducao_bc, false, b.cst_ipi, b.aliquota_ipi, b.cst_pis,
  b.aliquota_pis, b.cst_cofins, b.aliquota_cofins, b.fonte_tipo, b.fonte_referencia, b.versao, b.vigencia_inicio,
  b.external_id
FROM fiscal.regra_base b
WHERE b.tenant_id = plataforma.tenant_referencia() AND b.deleted_at IS NULL AND b.external_id LIKE 'seed-exemplo:%'
ORDER BY b.chave
ON CONFLICT DO NOTHING;

INSERT INTO fiscal.regra_tributaria (tenant_id, tributo, ncm_prefixo, uf_origem, uf_destino, crt, cfop, codigo,
  aliquota_icms, ajustar_mva, fonte_tipo, fonte_referencia, versao, vigencia_inicio, external_id)
VALUES (current_setting('macuxierp.seed_tenant')::uuid, 'icms', '2202', 'AM', 'AM', 3, '5102', '00', 250000, false,
  'outro', 'Exemplo para demonstração, sem valor fiscal',
  'exemplo-2026.1', '2026-01-01', 'seed-exemplo:manual.am.icms.2202.00')
ON CONFLICT DO NOTHING;
