-- 0024 — faturamento.nota_evento guarda dh_evento, id_lote e fuso_minutos antes de transmitir (T-0018 §8: a
-- retentativa só sai idêntica se o pedido for guardado antes; sem isso o retry assina outro evento e cai na rejeição
-- 573). Pedido do modulo-faturamento (T-0021). A inutilização fica de fora: o leiaute dela (PedidoInutilizacaoEmissor)
-- não tem dhEvento, idLote nem fuso. Aditiva e reexecutável. Detalhes em docs/banco/README.md (0024).

SET LOCAL lock_timeout = '5s';

-- Anuláveis: as linhas de antes da 0024 não têm os valores. Gravadas no INSERT (ou uma vez, de nulo para valor, na
-- linha pendente antiga) e imutáveis depois, salvo no reenvio (gatilho nota_evento_antes abaixo). timestamptz sem (3),
-- como as datas do schema.
ALTER TABLE faturamento.nota_evento ADD COLUMN IF NOT EXISTS dh_evento timestamptz;
ALTER TABLE faturamento.nota_evento ADD COLUMN IF NOT EXISTS id_lote bigint;
ALTER TABLE faturamento.nota_evento ADD COLUMN IF NOT EXISTS fuso_minutos smallint;

-- As três juntas; idLote da SEFAZ com 1 a 15 dígitos; fuso de UTC−12 a UTC+14, em minutos.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'faturamento.nota_evento'::regclass
                 AND conname = 'nota_evento_dh_lote_fuso_juntos_ck') THEN
    ALTER TABLE faturamento.nota_evento ADD CONSTRAINT nota_evento_dh_lote_fuso_juntos_ck
      CHECK (num_nulls(dh_evento, id_lote, fuso_minutos) IN (0, 3));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota_evento'::regclass AND conname = 'nota_evento_id_lote_ck') THEN
    ALTER TABLE faturamento.nota_evento ADD CONSTRAINT nota_evento_id_lote_ck
      CHECK (id_lote BETWEEN 1 AND 999999999999999);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota_evento'::regclass AND conname = 'nota_evento_fuso_minutos_ck') THEN
    ALTER TABLE faturamento.nota_evento ADD CONSTRAINT nota_evento_fuso_minutos_ck
      CHECK (fuso_minutos BETWEEN -720 AND 840);
  END IF;
END $$;

-- Trava das três colunas no UPDATE: de nulo para valor passa (a linha pendente de antes da 0024, uma vez; o CHECK
-- obriga as três juntas); com valor gravado, nenhuma muda nem volta a nulo, salvo no reenvio (p_reenvio: o mesmo
-- UPDATE leva o status de 'rejeitado' a 'pendente'), que pode trocar as três por outras três, nunca por nulo. Motivo:
-- a 573 só acontece com o evento já registrado, e depois de uma rejeição pela própria data (577, 578, 579) um dhEvento
-- novo é o único jeito de sair. Vale para todos, dono incluso.
CREATE OR REPLACE FUNCTION faturamento.conferir_dh_lote_fuso(p_reenvio boolean,
  p_velho_dh timestamptz, p_velho_lote bigint, p_velho_fuso smallint,
  p_novo_dh timestamptz, p_novo_lote bigint, p_novo_fuso smallint) RETURNS void
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF num_nonnulls(p_velho_dh, p_velho_lote, p_velho_fuso) > 0
     AND (p_velho_dh, p_velho_lote, p_velho_fuso) IS DISTINCT FROM (p_novo_dh, p_novo_lote, p_novo_fuso)
     AND (NOT p_reenvio OR num_nonnulls(p_novo_dh, p_novo_lote, p_novo_fuso) < 3) THEN
    RAISE EXCEPTION 'T-0018 §8: dh_evento, id_lote e fuso_minutos do evento não mudam (só as três, no reenvio)'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- BEFORE INSERT/UPDATE da nota_evento da 0013, com a trava acima no começo do UPDATE e as três colunas na lista do
-- que pode mudar (a trava já decide); o resto não muda.
CREATE OR REPLACE FUNCTION faturamento.nota_evento_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  s text;
  proxima smallint;
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT n.status INTO s FROM faturamento.nota n WHERE n.tenant_id = NEW.tenant_id AND n.id = NEW.nota_id;
    -- autorizada já implica o XML guardado (nota_antes_alterar).
    IF s IS DISTINCT FROM 'autorizada' THEN
      RAISE EXCEPTION 'RN-FAT-03: evento só em nota autorizada com o XML guardado (status %)', coalesce(s, 'inexistente')
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'pendente' THEN
      RAISE EXCEPTION 'RN-FAT-02: o evento nasce pendente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tipo = 'cce' THEN
      SELECT coalesce(max(e.n_seq_evento), 0) + 1 INTO proxima FROM faturamento.nota_evento e
      WHERE e.nota_id = NEW.nota_id AND e.tipo = 'cce';
      IF NEW.n_seq_evento <> proxima THEN
        RAISE EXCEPTION 'RN-FAT-02: a CC-e desta nota é a sequência %', proxima USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  PERFORM faturamento.conferir_dh_lote_fuso(OLD.status = 'rejeitado' AND NEW.status = 'pendente',
    OLD.dh_evento, OLD.id_lote, OLD.fuso_minutos, NEW.dh_evento, NEW.id_lote, NEW.fuso_minutos);
  IF OLD.status = 'registrado' THEN
    RAISE EXCEPTION 'RN-FAT-02: evento registrado não muda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW),
    ARRAY['status', 'protocolo', 'c_stat', 'x_motivo', 'registrado_em', 'texto', 'updated_at',
      'dh_evento', 'id_lote', 'fuso_minutos']);
  IF k IS NOT NULL THEN
    RAISE EXCEPTION 'RN-FAT-02: % do evento não muda', k USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'pendente' AND NEW.status IN ('registrado', 'rejeitado'))
         OR (OLD.status = 'rejeitado' AND NEW.status = 'pendente')) THEN
      RAISE EXCEPTION 'RN-FAT-02: transição do evento de % para % recusada', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'registrado' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_xml x
        WHERE x.tenant_id = NEW.tenant_id AND x.evento_id = NEW.id) THEN
      RAISE EXCEPTION 'RN-FAT-03: o evento só fica registrado com o XML guardado' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON COLUMN faturamento.nota_evento.dh_evento IS
  'dhEvento assinado (T-0018 §8): gravado antes de transmitir, com id_lote e fuso_minutos; muda só no reenvio '
  '(rejeitado para pendente); nulo só em linha antiga.';
COMMENT ON COLUMN faturamento.nota_evento.id_lote IS 'idLote do envEvento (1 a 15 dígitos), gravado antes de transmitir.';
COMMENT ON COLUMN faturamento.nota_evento.fuso_minutos IS 'Fuso do dhEvento em minutos (−720 a 840), gravado antes de transmitir.';
