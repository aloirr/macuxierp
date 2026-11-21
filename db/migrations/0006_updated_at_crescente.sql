-- 0006 — updated_at estritamente crescente por linha (T-0032; achado da revisão do PR #18). Aditiva e reexecutável.
-- O core usa date_trunc('milliseconds', updated_at) como token de concorrência otimista. Com now() (início da
-- transação), duas gravações de transações iniciadas no mesmo ms deixavam o mesmo token (quem tinha o token antigo
-- sobrescrevia sem 409) e uma transação longa podia fazer updated_at voltar no tempo.
-- Agora: no UPDATE, greatest(clock_timestamp(), OLD.updated_at + 1 ms): a hora real da gravação e, no mínimo, 1 ms
-- depois do valor anterior, então o token (truncado em ms) muda a cada gravação, mesmo na mesma transação.
-- Decisão sobre o INSERT: a trigger continua só BEFORE UPDATE (controle.preparar_tabela não muda). O INSERT segue com o
-- DEFAULT now() da coluna: a garantia de crescimento vem do ramo do UPDATE, que compara com OLD.updated_at qualquer que
-- seja o valor inserido, e ligar a trigger no INSERT sobrescreveria o updated_at explícito de carga e importação. O
-- ramo do INSERT (clock_timestamp()) fica pronto na função para quem a ligar no INSERT no futuro.
-- RLS, papéis, grants e as triggers já criadas não mudam (a trigger chama a função pelo nome).
CREATE OR REPLACE FUNCTION plataforma.tocar_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 millisecond');
  ELSE
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
