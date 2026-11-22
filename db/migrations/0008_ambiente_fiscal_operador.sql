-- 0008 — T-0030 (ADR 0006): macuxierp_app só grava homologação em core.ambiente_fiscal; produção só pelo dono. Aditiva e reexecutável.
DROP POLICY IF EXISTS app_so_homologacao_ins ON core.ambiente_fiscal;
CREATE POLICY app_so_homologacao_ins ON core.ambiente_fiscal AS RESTRICTIVE FOR INSERT TO macuxierp_app
  WITH CHECK (ambiente = 'homologacao');

DROP POLICY IF EXISTS app_so_homologacao_upd ON core.ambiente_fiscal;
CREATE POLICY app_so_homologacao_upd ON core.ambiente_fiscal AS RESTRICTIVE FOR UPDATE TO macuxierp_app
  USING (true) WITH CHECK (ambiente = 'homologacao');

-- Corrige o comentário da 0003 (a migração antiga não se edita).
COMMENT ON TABLE core.ambiente_fiscal IS
  'Ambiente fiscal por filial emissora (regra 7): sem linha = homologação. A API (macuxierp_app) só grava homologação '
  '(políticas app_so_homologacao_*, 0008). Produção só pelo script do operador, como dono da tabela, com o recado '
  '"aprovo produção fiscal <empresa>" do Alexandre (RN-CORE-08, ADR 0006); o CHECK ambiente_producao_aprovada exige '
  'o id do recado.';
