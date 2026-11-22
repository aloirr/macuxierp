-- 0027 — Recuo do status por nota cancelada (T-0015, lote 4b; RN-PED-02).
-- Regras e motivo em docs/banco/README.md (0027). Aditiva e reexecutável.

SET LOCAL lock_timeout = '5s';

-- Outro status: false. Lê só pedido_item do mesmo pedido (RLS do chamador vale: SECURITY INVOKER).
CREATE OR REPLACE FUNCTION pedido.recuo_coerente(p pedido.pedido) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE p.status::text
    WHEN 'aprovado' THEN p.valor_faturado_centavos = 0
      AND NOT EXISTS (SELECT 1 FROM pedido.pedido_item i
        WHERE i.tenant_id = p.tenant_id AND i.pedido_id = p.id AND i.deleted_at IS NULL AND i.quantidade_faturada <> 0)
    WHEN 'faturado_parcial' THEN
      EXISTS (SELECT 1 FROM pedido.pedido_item i
        WHERE i.tenant_id = p.tenant_id AND i.pedido_id = p.id AND i.deleted_at IS NULL AND i.quantidade_faturada > 0)
      AND EXISTS (SELECT 1 FROM pedido.pedido_item i
        WHERE i.tenant_id = p.tenant_id AND i.pedido_id = p.id AND i.deleted_at IS NULL
          AND i.quantidade_faturada < i.quantidade)
    ELSE false
  END
$$;
COMMENT ON FUNCTION pedido.recuo_coerente(pedido.pedido) IS
  'RN-PED-02 (0027): o status de recuo por nota cancelada bate com o faturado da linha e dos itens não excluídos.';

-- A 0012 com o recuo antes do RAISE MXP02. transicoes_possiveis e o DETAIL possiveis= não mudam.
CREATE OR REPLACE FUNCTION pedido.validar_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  possiveis text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'recebido' THEN
      RAISE EXCEPTION 'RN-PED-02: o pedido nasce recebido (criação com status % recusada)', NEW.status
        USING ERRCODE = 'MXP02', DETAIL = 'possiveis=recebido';
    END IF;
    NEW.status_alterado_em := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  possiveis := pedido.transicoes_possiveis(OLD.status);
  IF NOT (NEW.status = ANY (possiveis)) THEN
    -- Recuo por nota cancelada (0027): só o worker, com a intenção marcada, e com o status novo coerente.
    IF coalesce(current_setting('macuxierp.recuo_nota', true), '') = 'on'
      AND current_user = 'macuxierp_worker'
      AND (OLD.status::text, NEW.status::text) IN (('faturado', 'faturado_parcial'), ('faturado', 'aprovado'),
        ('faturado_parcial', 'aprovado'))
      AND pedido.recuo_coerente(NEW) THEN
      NEW.status_alterado_em := clock_timestamp();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'RN-PED-02: transição de % para % recusada; possíveis a partir de %: %', OLD.status, NEW.status,
      OLD.status, coalesce(nullif(array_to_string(possiveis, ', '), ''), 'nenhuma (status final)')
      USING ERRCODE = 'MXP02', DETAIL = 'possiveis=' || array_to_string(possiveis, ',');
  END IF;
  NEW.status_alterado_em := clock_timestamp();
  RETURN NEW;
END $$;
