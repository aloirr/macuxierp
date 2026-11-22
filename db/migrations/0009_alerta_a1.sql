-- 0009 — Alerta diário do certificado A1 (T-0035; RF-CORE-04, RN-CORE-06). Aditiva e reexecutável.
-- 0007 e 0008 ficam reservadas para a T-0010 e a T-0030 (a ordem de aplicação é a do nome; buraco no número não é erro).
-- Contrato dos adaptadores (FonteTenants, FonteCertificados, DestinoAvisos em apps/worker/src/alerta-a1.ts) em
-- docs/banco/README.md, seção "Alerta do A1".

-- Sem somente_insercao: o dono (migração, exclusão LGPD) ainda limpa.
CREATE TABLE IF NOT EXISTS core.aviso_a1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  certificado_id uuid NOT NULL,
  filial_id uuid NOT NULL,
  valido_ate timestamptz NOT NULL,
  dias integer NOT NULL,
  dia date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT aviso_a1_um_por_dia UNIQUE (tenant_id, certificado_id, dia),
  CONSTRAINT aviso_a1_certificado_fk FOREIGN KEY (tenant_id, certificado_id) REFERENCES core.certificado (tenant_id, id)
);
SELECT controle.preparar_tabela('core.aviso_a1');
-- Selo do BKO (GET /v1/auth/eu): o aviso mais recente de cada filial do tenant.
CREATE INDEX IF NOT EXISTS aviso_a1_filial_dia_idx ON core.aviso_a1 (tenant_id, filial_id, dia DESC)
  WHERE deleted_at IS NULL;

GRANT SELECT, INSERT ON core.aviso_a1 TO macuxierp_worker;
GRANT SELECT ON core.aviso_a1 TO macuxierp_app, macuxierp_leitura;

-- SECURITY DEFINER porque roda sem tenant (dono da tabela, sem FORCE RLS), como a tenant_por_slug.
CREATE OR REPLACE FUNCTION plataforma.tenants_ativos() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT id FROM plataforma.tenant WHERE situacao = 'ativo' AND deleted_at IS NULL ORDER BY id
$$;
REVOKE ALL ON FUNCTION plataforma.tenants_ativos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.tenants_ativos() TO macuxierp_worker;
