-- 0047 — Origem do certificado A1 e trava da produção fiscal com A1 de teste (T-0080, v0.3.10; RN-CORE-06, RN-CORE-08,
-- ADR 0005, ADR 0006).
--
-- core.certificado ganha origem text NOT NULL DEFAULT 'upload' (certificado_origem_ck: 'upload' ou 'teste'). As linhas
-- existentes ficam 'upload' pelo DEFAULT (sem reescrita da tabela). 'teste' = A1 gerado para homologação, que não é de
-- nenhum titular real.
--
-- Não há função do banco que leve a filial para produção: quem o faz é o operador (script do operador ou portal
-- /config), como dono da tabela, com o recado de aprovação (0008; o macuxierp_app só grava homologação). A trava vai
-- no gatilho core.ambiente_fiscal_a1_real (BEFORE INSERT OR UPDATE OF ambiente, deleted_at, tenant_id, filial_id), que
-- vale para todos os papéis e para o dono: a linha que fica em 'producao' (sem deleted_at) é recusada quando o A1
-- vigente da filial (ativo e sem deleted_at; no máximo um, certificado_um_ativo_por_filial) tem origem 'teste'.
-- SQLSTATE MXA01, DETAIL a1_de_teste, mensagem "certificado A1 de teste não pode ir para produção; envie o certificado
-- real" (sem dado pessoal). Filial sem A1 vigente passa (a emissão já para por falta de certificado). A volta para
-- homologação nunca é barrada. A mesma função, no gatilho core.certificado.certificado_a1_real (BEFORE INSERT OR
-- UPDATE OF origem, ativo, deleted_at, tenant_id, filial_id), fecha o outro lado: o A1 de teste que fica vigente numa
-- filial cujo core.ambiente_fiscal vigente (sem deleted_at) está em producao é recusado com MXA01, DETAIL
-- a1_de_teste_em_producao, mensagem "certificado A1 de teste não pode ser usado em filial em produção; envie o
-- certificado real".
--
-- Aditiva: a API atual não grava origem (fica 'upload') e segue igual. Reexecutável: ADD COLUMN IF NOT EXISTS, CHECK
-- por pg_constraint, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, COMMENT e GRANT. Não muda nenhuma linha de dado.
SET LOCAL lock_timeout = '5s';

ALTER TABLE core.certificado ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'upload';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'core.certificado'::regclass AND conname = 'certificado_origem_ck') THEN
    ALTER TABLE core.certificado
      ADD CONSTRAINT certificado_origem_ck CHECK (origem IN ('upload', 'teste'));
  END IF;
END $$;
COMMENT ON COLUMN core.certificado.origem IS
  'T-0080 (0047): de onde veio o A1. upload = enviado pelo cliente (padrão; as linhas anteriores à 0047 ficam assim); '
  'teste = A1 de teste, só para homologação: com ele vigente a filial não vai para produção '
  '(gatilho ambiente_fiscal_a1_real, MXA01). Não muda depois de gravado (nenhum papel da aplicação tem UPDATE nela).';

-- O app lê o resumo do certificado por coluna (0003): origem entra no resumo; .pfx e senha continuam fora.
GRANT SELECT (origem) ON core.certificado TO macuxierp_app;

-- Uma função para os dois gatilhos (a regra é uma só: a filial do tenant não fica, ao mesmo tempo, em producao vigente
-- e com A1 de teste vigente). Pelo lado de core.ambiente_fiscal (TG_TABLE_NAME) ela recusa a ida para produção; pelo
-- lado de core.certificado, o A1 de teste que fica vigente numa filial já em produção. A trava consultiva por tenant e
-- filial (pg_advisory_xact_lock, só quando a linha nova é de risco) serializa as duas gravações concorrentes; como cada
-- comando da função lê com um retrato novo (READ COMMITTED), a segunda enxerga a primeira já confirmada.
CREATE OR REPLACE FUNCTION core.ambiente_fiscal_a1_real() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_do_ambiente boolean := TG_TABLE_NAME = 'ambiente_fiscal';
BEGIN
  IF v_do_ambiente THEN
    IF NOT (NEW.ambiente = 'producao' AND NEW.deleted_at IS NULL) THEN RETURN NEW; END IF;
  ELSIF NOT (NEW.origem = 'teste' AND NEW.ativo AND NEW.deleted_at IS NULL) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('core.ambiente_fiscal_a1_real'),
                                hashtext(NEW.tenant_id::text || NEW.filial_id::text));
  IF v_do_ambiente AND EXISTS (
    SELECT 1 FROM core.certificado c
    WHERE c.tenant_id = NEW.tenant_id AND c.filial_id = NEW.filial_id
      AND c.ativo AND c.deleted_at IS NULL AND c.origem = 'teste') THEN
    RAISE EXCEPTION 'certificado A1 de teste não pode ir para produção; envie o certificado real'
      USING ERRCODE = 'MXA01', DETAIL = 'a1_de_teste',
        HINT = 'Envie o certificado A1 real da filial antes de levar a filial para produção.';
  ELSIF NOT v_do_ambiente AND EXISTS (
    SELECT 1 FROM core.ambiente_fiscal a
    WHERE a.tenant_id = NEW.tenant_id AND a.filial_id = NEW.filial_id
      AND a.ambiente = 'producao' AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'certificado A1 de teste não pode ser usado em filial em produção; envie o certificado real'
      USING ERRCODE = 'MXA01', DETAIL = 'a1_de_teste_em_producao',
        HINT = 'A filial já está em produção: envie o certificado A1 real.';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION core.ambiente_fiscal_a1_real() IS
  'T-0080 (0047; RN-CORE-08, ADR 0006): gatilho de core.ambiente_fiscal (ambiente_fiscal_a1_real) e de core.certificado '
  '(certificado_a1_real). A filial do tenant não fica em producao (sem deleted_at) com A1 vigente (ativo, sem '
  'deleted_at) de origem teste: a ida para produção é recusada com MXA01, DETAIL a1_de_teste; o A1 de teste que fica '
  'vigente numa filial em produção, com MXA01, DETAIL a1_de_teste_em_producao. Vale para todos os papéis e para o dono. '
  'SECURITY DEFINER só para ler a outra tabela pelo tenant e filial da linha, sem depender da RLS e dos grants de quem '
  'grava; não devolve nada do certificado.';
REVOKE ALL ON FUNCTION core.ambiente_fiscal_a1_real() FROM PUBLIC;

DROP TRIGGER IF EXISTS ambiente_fiscal_a1_real ON core.ambiente_fiscal;
CREATE TRIGGER ambiente_fiscal_a1_real BEFORE INSERT OR UPDATE OF ambiente, deleted_at, tenant_id, filial_id
  ON core.ambiente_fiscal FOR EACH ROW EXECUTE FUNCTION core.ambiente_fiscal_a1_real();

DROP TRIGGER IF EXISTS certificado_a1_real ON core.certificado;
CREATE TRIGGER certificado_a1_real BEFORE INSERT OR UPDATE OF origem, ativo, deleted_at, tenant_id, filial_id
  ON core.certificado FOR EACH ROW EXECUTE FUNCTION core.ambiente_fiscal_a1_real();
