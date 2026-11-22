-- 0028 — faturamento.titulo_geracao (contador persistente das tentativas de gerar os títulos de uma nota, para a
-- varredura do worker, RN-FAT-03), alterado_em do histórico da configuração da filial pelo relógio do banco (🟡 da 0026)
-- e CHECK de conta_como_real só em homologação no título (🟡 do lote 5). T-0021. Aditiva e reexecutável.
-- Detalhes em docs/banco/README.md (0028).

SET LOCAL lock_timeout = '5s';

-- ============================================================================================================
-- faturamento.titulo_geracao
-- Uma linha por nota: UNIQUE (tenant_id, nota_id) total, FK composta para a nota, sem exclusão (lógica ou física).
-- O id uuid é a PK (regra 5); a chave de negócio é (tenant_id, nota_id), alvo do upsert do worker.
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS faturamento.titulo_geracao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nota_id uuid NOT NULL,
  tentativas smallint NOT NULL DEFAULT 0,
  ultima_tentativa_em timestamptz,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT titulo_geracao_nota_uq UNIQUE (tenant_id, nota_id),
  CONSTRAINT titulo_geracao_tentativas_ck CHECK (tentativas >= 0),
  CONSTRAINT titulo_geracao_motivo_ck CHECK (length(motivo) <= 255),
  CONSTRAINT titulo_geracao_sem_exclusao_logica CHECK (deleted_at IS NULL),
  CONSTRAINT titulo_geracao_nota_fk FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota (tenant_id, id)
);
SELECT controle.preparar_tabela('faturamento.titulo_geracao');
DROP TRIGGER IF EXISTS titulo_geracao_sem_exclusao ON faturamento.titulo_geracao;
CREATE TRIGGER titulo_geracao_sem_exclusao BEFORE DELETE ON faturamento.titulo_geracao
  FOR EACH ROW EXECUTE FUNCTION faturamento.proibir_exclusao();

COMMENT ON TABLE faturamento.titulo_geracao IS
  'Tentativas de gerar os títulos de uma nota (T-0021, RN-FAT-03): contador persistente da varredura do worker, que '
  'sobrevive ao reinício (a nota autorizada não aceita gravação, 0013). Uma linha por tenant e nota (upsert ON '
  'CONFLICT (tenant_id, nota_id)). Sem DELETE e sem exclusão lógica.';
COMMENT ON COLUMN faturamento.titulo_geracao.motivo IS
  'Motivo da última falha: só código ou texto do catálogo (até 255, o corte do faturamento), nunca dado pessoal (LGPD).';

-- ============================================================================================================
-- 🟡 da 0026: o alterado_em do histórico vem do relógio do banco (clock_timestamp()), e não do NEW.updated_at, que o
-- app escolhe no INSERT. Só isso muda: SECURITY DEFINER, search_path, TG_RELID e o REVOKE continuam. O CREATE OR
-- REPLACE preserva dono e ACL; o REVOKE é repetido por garantia (idempotente).
-- ============================================================================================================
CREATE OR REPLACE FUNCTION faturamento.configuracao_filial_depois() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_RELID <> 'faturamento.configuracao_filial'::regclass OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW' THEN
    RAISE EXCEPTION 'T-0021: configuracao_filial_depois só roda na faturamento.configuracao_filial'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO faturamento.configuracao_filial_historico (tenant_id, configuracao_id, filial_id, valor_anterior,
    valor_novo, alterado_por, alterado_em)
  VALUES (NEW.tenant_id, NEW.id, NEW.filial_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.faturamento_real_nfe_simulada END,
    NEW.faturamento_real_nfe_simulada, NEW.alterado_por, clock_timestamp());
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION faturamento.configuracao_filial_depois() FROM PUBLIC;

-- ============================================================================================================
-- 🟡 do lote 5: conta_como_real só em homologação (em produção o faturamento já é real; RN-FAT-04). Direto, validado:
-- o migrar roda cada migração numa transação só, então NOT VALID + VALIDATE manteria a trava ACCESS EXCLUSIVE do ADD
-- até o COMMIT e não ganharia nada; a tabela é pequena e o lock_timeout de 5 s limita a espera. Linha que viole cai
-- em 23514 e a migração inteira volta (nada fica pela metade).
-- ============================================================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.titulo'::regclass AND conname = 'titulo_real_so_homologacao_ck') THEN
    ALTER TABLE faturamento.titulo ADD CONSTRAINT titulo_real_so_homologacao_ck
      CHECK (ambiente = 'homologacao' OR NOT conta_como_real);
  END IF;
END $$;

-- ============================================================================================================
-- Privilégios: quem gera título na varredura é o worker (criarVarreduraTitulos, modules/faturamento/api/titulos.ts);
-- grava por upsert. Leitura só lê. O app não acessa. Ninguém tem DELETE.
-- ============================================================================================================
GRANT SELECT, INSERT ON faturamento.titulo_geracao TO macuxierp_worker;
GRANT UPDATE (tentativas, ultima_tentativa_em, motivo) ON faturamento.titulo_geracao TO macuxierp_worker;
GRANT SELECT ON faturamento.titulo_geracao TO macuxierp_leitura;
