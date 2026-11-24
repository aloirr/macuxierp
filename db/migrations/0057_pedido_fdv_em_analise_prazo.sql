-- 0057 — Pedido do FDV em análise com pendência de prazo (T-0085, v0.3.12; RN-PED-07 emendada no doc 03; decisão do
-- Alexandre de 24/11, 18h14 em Manaus, R-20261124-181410). Troca os dois CHECKs da D-A (0016) para aceitar o pedido do
-- FDV em em_analise SÓ com as pendências bloqueantes prazo_incompleto e/ou prazo_acima_do_cliente. Os nomes ficam os
-- mesmos (a 0016 reexecutada não recria a regra antiga). Aditiva (só afrouxa) e reexecutável. Motivos em
-- docs/banco/README.md (0057).

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

-- "Só prazo" (P): array não vazio em que todo elemento é objeto com codigo prazo_incompleto ou prazo_acima_do_cliente e
-- bloqueante = true. O CASE fixa a ordem (jsonb_array_length cai fora de array; o CHECK pedido_pendencias_array da 0012
-- é quem recusa o não-array). Elemento com codigo de outro tipo, sem bloqueante ou fora de objeto não entra no filtro e
-- a contagem não bate.
DO $$
DECLARE
  so_prazo constant text := $sql$CASE
      WHEN jsonb_typeof(pendencias) IS DISTINCT FROM 'array' THEN false
      WHEN pendencias = '[]'::jsonb THEN false
      ELSE jsonb_array_length(jsonb_path_query_array(pendencias,
             '$[*] ? ((@.codigo == "prazo_incompleto" || @.codigo == "prazo_acima_do_cliente") && @.bloqueante == true)'))
           = jsonb_array_length(pendencias)
    END$sql$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_analise'
                   AND pg_get_constraintdef(oid) LIKE '%prazo_acima_do_cliente%') THEN
    ALTER TABLE pedido.pedido DROP CONSTRAINT IF EXISTS pedido_fdv_sem_analise;
    -- Recusado segue fora para o FDV; em_analise só com P.
    EXECUTE format(
      'ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_analise CHECK ('
      'origem <> ''fdv'' OR status NOT IN (''em_analise'', ''recusado'') OR (status = ''em_analise'' AND (%s)))',
      so_prazo);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'pedido.pedido'::regclass AND conname = 'pedido_fdv_sem_pendencia'
                   AND pg_get_constraintdef(oid) LIKE '%prazo_acima_do_cliente%') THEN
    ALTER TABLE pedido.pedido DROP CONSTRAINT IF EXISTS pedido_fdv_sem_pendencia;
    -- Pendência no FDV só em em_analise e só P; nos outros status, '[]' como na 0016.
    EXECUTE format(
      'ALTER TABLE pedido.pedido ADD CONSTRAINT pedido_fdv_sem_pendencia CHECK ('
      'origem <> ''fdv'' OR pendencias = ''[]''::jsonb OR (status = ''em_analise'' AND (%s)))',
      so_prazo);
  END IF;
END $$;

COMMENT ON CONSTRAINT pedido_fdv_sem_analise ON pedido.pedido IS
  'D-A (0016) emendada pela RN-PED-07 (0057): o pedido do FDV não vai a recusado; em_analise só com as pendências '
  'bloqueantes prazo_incompleto e/ou prazo_acima_do_cliente (T-0085)';
COMMENT ON CONSTRAINT pedido_fdv_sem_pendencia ON pedido.pedido IS
  'D-A (0016) emendada pela RN-PED-07 (0057): o pedido do FDV tem pendencias = [] fora de em_analise; em em_analise, só '
  'prazo_incompleto e/ou prazo_acima_do_cliente, bloqueantes (T-0085)';
