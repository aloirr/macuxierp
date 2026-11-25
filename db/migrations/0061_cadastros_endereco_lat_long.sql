-- 0061 — latitude e longitude no endereço do cliente (T-0096, v0.3.13). Aditiva e reexecutável; sem NOT NULL e sem
-- backfill. Por que e o que não muda: docs/banco/README.md (0061).

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

ALTER TABLE cadastros.cliente_endereco ADD COLUMN IF NOT EXISTS latitude numeric(9, 6);
ALTER TABLE cadastros.cliente_endereco ADD COLUMN IF NOT EXISTS longitude numeric(9, 6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.cliente_endereco'::regclass AND conname = 'cliente_endereco_latitude_ck') THEN
    ALTER TABLE cadastros.cliente_endereco
      ADD CONSTRAINT cliente_endereco_latitude_ck CHECK (latitude BETWEEN -90 AND 90);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'cadastros.cliente_endereco'::regclass AND conname = 'cliente_endereco_longitude_ck') THEN
    ALTER TABLE cadastros.cliente_endereco
      ADD CONSTRAINT cliente_endereco_longitude_ck CHECK (longitude BETWEEN -180 AND 180);
  END IF;
END $$;

COMMENT ON COLUMN cadastros.cliente_endereco.latitude IS
  'Latitude em graus decimais (WGS 84), -90 a 90, 6 casas; nula quando não informada (o pré-cadastro do FDV preenche quando traz). T-0096.';
COMMENT ON COLUMN cadastros.cliente_endereco.longitude IS
  'Longitude em graus decimais (WGS 84), -180 a 180, 6 casas; nula quando não informada (o pré-cadastro do FDV preenche quando traz). T-0096.';
