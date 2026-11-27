-- 0074 — Forma de pagamento do lote /entrada/v1 sem condição (T-0057). Volume baixo. Aditiva e reexecutável. Motivo em docs/banco/README.md (0074).

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cadastros.entrada_forma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  -- o último conector que enviou a forma (informativo; a chave é do tenant)
  conector_id cadastros.entrada_conector_id NOT NULL,
  -- id da forma no banco do cliente = forma_external_id da condição; limite do Hub (0054)
  external_id text NOT NULL CHECK (length(external_id) <= 200),
  -- mesmos limites do forma_codigo (0054) e do forma_nome (0010) da condição
  codigo text NOT NULL CONSTRAINT entrada_forma_codigo_check CHECK (length(codigo) BETWEEN 1 AND 30),
  nome text NOT NULL CONSTRAINT entrada_forma_nome_check CHECK (length(nome) BETWEEN 1 AND 60),
  -- tPag da NF-e (como o forma_tpag da condição, que é obrigatório): o prazo novo completa a condição com ele
  tpag text CONSTRAINT entrada_forma_tpag_check CHECK (tpag ~ '^[0-9]{2}$'),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
SELECT controle.preparar_tabela('cadastros.entrada_forma');

-- Único do upsert do worker: ON CONFLICT (tenant_id, external_id), sem predicado, valendo também para a linha apagada
-- (o reenvio revive a forma). Substitui o parcial que a preparar_tabela cria (external_id aqui é NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS entrada_forma_upsert_uq ON cadastros.entrada_forma (tenant_id, external_id);
DROP INDEX IF EXISTS cadastros.entrada_forma_external_id_uq;

-- App (carga) e worker (lote, pelo gravarLinhas) gravam; sem DELETE (exclusão = deleted_at, RN-CAD-08). Ids por
-- gen_random_uuid(): sem sequence. A leitura vê o próprio tenant.
GRANT SELECT, INSERT, UPDATE ON cadastros.entrada_forma TO macuxierp_app, macuxierp_worker;
GRANT SELECT ON cadastros.entrada_forma TO macuxierp_leitura;

COMMENT ON TABLE cadastros.entrada_forma IS
  'Forma de pagamento do lote /entrada/v1 ainda sem condição (0074, T-0057, RN-CAD-09); o prazo_pagamento lê por (tenant_id, external_id).';
