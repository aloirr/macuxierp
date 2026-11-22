-- 0018 — integracao_fdv.referencia.dados aceita a chave `chave` (T-0011; ADR 0010, RD-0318). Aditiva e reexecutável.

-- motivo em docs/banco/README.md (T-0011)
SET LOCAL lock_timeout = '5s';

-- motivo em docs/banco/README.md (T-0011). Nenhuma linha tem `chave` antes desta migração, então o CHECK novo nasce validado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'integracao_fdv.referencia'::regclass AND conname = 'referencia_dados_check') THEN
    ALTER TABLE integracao_fdv.referencia DROP CONSTRAINT referencia_dados_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'integracao_fdv.referencia'::regclass AND conname = 'referencia_dados_ck') THEN
    ALTER TABLE integracao_fdv.referencia ADD CONSTRAINT referencia_dados_ck CHECK (
      jsonb_typeof(dados) = 'object'
      AND dados - ARRAY['nome', 'vigencia_inicio', 'vigencia_fim', 'inativo', 'filial_id', 'chave'] = '{}'::jsonb
      AND (NOT dados ? 'chave'
           OR (jsonb_typeof(dados -> 'chave') = 'string' AND length(dados ->> 'chave') BETWEEN 1 AND 200)));
  END IF;
END $$;

COMMENT ON CONSTRAINT referencia_dados_ck ON integracao_fdv.referencia IS
  'dados só com nome, vigencia_inicio, vigencia_fim, inativo, filial_id e chave; chave = chave do Hub da tabela de '
  'preço (external_id ?? id), string de 1 a 200; sem dado pessoal (ADR 0010, RD-0318).';
