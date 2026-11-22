-- 0011 — Ajustes do aviso do A1 e índice da versão por agregado em plataforma.evento (T-0043; RN-CORE-06, RF-CORE-04;
-- T-0034). Reexecutável.

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

-- motivo em docs/banco/README.md (T-0043)
CREATE INDEX IF NOT EXISTS evento_agregado_versao_idx ON plataforma.evento (tenant_id, agregado_id, versao);

-- motivo em docs/banco/README.md (T-0043)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'core.certificado'::regclass AND conname = 'certificado_tenant_id_filial_uq') THEN
    ALTER TABLE core.certificado
      ADD CONSTRAINT certificado_tenant_id_filial_uq UNIQUE (tenant_id, id, filial_id);
  END IF;
END $$;

-- motivo em docs/banco/README.md (T-0043)
UPDATE core.aviso_a1 a SET filial_id = c.filial_id
  FROM core.certificado c
  WHERE c.tenant_id = a.tenant_id AND c.id = a.certificado_id AND c.filial_id <> a.filial_id;

-- motivo em docs/banco/README.md (T-0043)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'core.aviso_a1'::regclass AND conname = 'aviso_a1_certificado_filial_fk') THEN
    ALTER TABLE core.aviso_a1
      ADD CONSTRAINT aviso_a1_certificado_filial_fk FOREIGN KEY (tenant_id, certificado_id, filial_id)
      REFERENCES core.certificado (tenant_id, id, filial_id);
  END IF;
END $$;
ALTER TABLE core.aviso_a1 DROP CONSTRAINT IF EXISTS aviso_a1_certificado_fk;

-- motivo em docs/banco/README.md (T-0043)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'core.aviso_a1'::regclass AND conname = 'aviso_a1_dias_janela') THEN
    ALTER TABLE core.aviso_a1 ADD CONSTRAINT aviso_a1_dias_janela CHECK (dias <= 30);
  END IF;
END $$;
