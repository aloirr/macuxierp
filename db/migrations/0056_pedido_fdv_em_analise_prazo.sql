-- 0056 — Pedido do FDV em análise, recusado e aprovado com pendência de prazo (T-0085, v0.3.12; RN-PED-07 emendada no
-- doc 03; decisão do Alexandre de 24/11, 18h14 em Manaus, R-20261124-181410; opção (a) do gerente para o recusado e o
-- aprovado). Troca os dois CHECKs da D-A (0016): o pedido do FDV aceita em_analise SÓ com as pendências bloqueantes de
-- prazo, recusado SÓ com pendências de prazo (o que vem de em_analise) e aprovado com pendência de prazo NÃO bloqueante
-- (aceita na aprovação). Os nomes ficam os mesmos (a 0016 reexecutada não recria a regra antiga). Aditiva (só afrouxa)
-- e reexecutável. Motivos em docs/banco/README.md (0056).

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

-- Formato da pendência (modules/pedido/contracts, `Pendencia`): {codigo, bloqueante, sequencia, produto_id}. "Só prazo"
-- = array não vazio em que todo elemento é objeto com codigo prazo_incompleto ou prazo_acima_do_cliente e o filtro de
-- bloqueante dado. O CASE fixa a ordem (jsonb_array_length cai fora de array; o CHECK pedido_pendencias_array da 0012 é
-- quem recusa o não-array). Elemento com codigo de outro tipo, sem bloqueante ou fora de objeto não entra no filtro e a
-- contagem não bate.
--   PB (em_analise): bloqueante = true (como o receberFdv grava).
--   P  (recusado):   bloqueante true ou false (o recusar guarda as pendências de em_analise; o motivo fica na aprovação).
--   PA (aprovado):   bloqueante = false (a pendência de prazo aceita; a aceitação fica em pedido.aprovacao).
DO $$
DECLARE
  modelo constant text := $sql$CASE
      WHEN jsonb_typeof(pendencias) IS DISTINCT FROM 'array' THEN false
      WHEN pendencias = '[]'::jsonb THEN false
      ELSE jsonb_array_length(jsonb_path_query_array(pendencias,
             '$[*] ? ((@.codigo == "prazo_incompleto" || @.codigo == "prazo_acima_do_cliente") && (%s))'))
           = jsonb_array_length(pendencias)
    END$sql$;
  pb constant text := format(modelo, '@.bloqueante == true');
  p  constant text := format(modelo, '@.bloqueante == true || @.bloqueante == false');
  pa constant text := format(modelo, '@.bloqueante == false');
BEGIN
  -- Marca da definição desta migração: o filtro "bloqueante == false" (a 0016 e a versão só com em_analise não o têm).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_analise'
                   AND pg_get_constraintdef(oid) LIKE '%"bloqueante" == false%') THEN
    ALTER TABLE pedido.pedido DROP CONSTRAINT IF EXISTS pedido_fdv_sem_analise;
    EXECUTE format(
      'ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_analise CHECK ('
      'origem <> ''fdv'' OR status NOT IN (''em_analise'', ''recusado'') '
      'OR (status = ''em_analise'' AND (%s)) OR (status = ''recusado'' AND (%s)))',
      pb, p);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_pendencia'
                   AND pg_get_constraintdef(oid) LIKE '%"bloqueante" == false%') THEN
    ALTER TABLE pedido.pedido DROP CONSTRAINT IF EXISTS pedido_fdv_sem_pendencia;
    -- Nos outros status, '[]' como na 0016.
    EXECUTE format(
      'ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_pendencia CHECK ('
      'origem <> ''fdv'' OR pendencias = ''[]''::jsonb '
      'OR (status = ''em_analise'' AND (%s)) OR (status = ''recusado'' AND (%s)) OR (status = ''aprovado'' AND (%s)))',
      pb, p, pa);
  END IF;
END $$;

COMMENT ON CONSTRAINT pedido_fdv_sem_analise ON pedido.pedido IS
  'D-A (0016) emendada pela RN-PED-07 (0056): o pedido do FDV vai a em_analise só com as pendências bloqueantes '
  'prazo_incompleto e/ou prazo_acima_do_cliente, e a recusado só com pendências de prazo (T-0085)';
COMMENT ON CONSTRAINT pedido_fdv_sem_pendencia ON pedido.pedido IS
  'D-A (0016) emendada pela RN-PED-07 (0056): o pedido do FDV tem pendencias = [] salvo em em_analise (só prazo, '
  'bloqueante), recusado (só prazo) e aprovado (só prazo não bloqueante, aceita) (T-0085)';
