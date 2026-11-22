-- 0006 — updated_at estritamente crescente por linha (T-0032; achado da revisão do PR #18). Aditiva e reexecutável.
-- Por quê: o core usa updated_at truncado em ms como token de concorrência otimista; com now() (início da transação) duas gravações repetiam o token.
-- Contrato (trigger só BEFORE UPDATE; o INSERT fica com o DEFAULT now()) em docs/banco/README.md.
-- RLS, papéis, grants e as triggers já criadas não mudam (a trigger chama a função pelo nome).
CREATE OR REPLACE FUNCTION plataforma.tocar_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 millisecond');
  RETURN NEW;
END $$;
