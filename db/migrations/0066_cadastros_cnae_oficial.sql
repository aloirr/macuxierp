-- 0066 — Tabela oficial CNAE 2.3 (subclasses) e a leitura {codigo, descricao} e {codigo, nome, uf} para a ficha da
-- empresa (T-0106). Aditiva e reexecutável. A carga é a versionada da 0005 (db/tabelas-fiscais/fontes.json, carga
-- "cnae"). O porquê: docs/banco/README.md, seção "CNAE oficial e nomes para a ficha".

SET LOCAL lock_timeout = '5s';

-- Molde da 0005: colunas da regra 5, vigência e versão de origem; leitura geral no tenant de referência. external_id
-- até 200, como todo o cadastros desde a 0054.
CREATE TABLE IF NOT EXISTS cadastros.cnae (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{7}$'),
  descricao text NOT NULL CHECK (length(descricao) BETWEEN 1 AND 300),
  secao text NOT NULL CHECK (secao ~ '^[A-Z]$'),
  divisao text NOT NULL CHECK (divisao ~ '^[0-9]{2}$'),
  grupo text NOT NULL CHECK (grupo ~ '^[0-9]{3}$'),
  classe text NOT NULL CHECK (classe ~ '^[0-9]{5}$'),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  versao_id uuid NOT NULL REFERENCES cadastros.tabela_oficial_versao (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 200),
  UNIQUE (tenant_id, codigo, vigencia_inicio),
  CONSTRAINT cnae_hierarquia CHECK (
    left(codigo, 5) = classe AND left(classe, 3) = grupo AND left(grupo, 2) = divisao)
);
SELECT controle.preparar_tabela('cadastros.cnae', true);

GRANT SELECT ON cadastros.cnae TO macuxierp_app, macuxierp_worker, macuxierp_leitura;

-- ---------------------------------------------------------------------------------------------------------------
-- Leitura para a ficha (ADR 0012 §4): só tabela oficial, nenhum dado de tenant.
-- ---------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION plataforma.cnae_descricoes(p_codigos text[]) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF cardinality(p_codigos) > 1000 THEN
    RAISE EXCEPTION 'lista de CNAE acima de 1000 códigos' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descricao', c.descricao) ORDER BY e.ordem),
                    '[]'::jsonb)
    FROM (SELECT DISTINCT ON (d.codigo) d.codigo, d.ordem
            FROM (SELECT regexp_replace(i.valor, '[^0-9]', '', 'g') AS codigo, i.ordem
                    FROM unnest(p_codigos) WITH ORDINALITY i (valor, ordem)) d
           ORDER BY d.codigo, d.ordem) e
    CROSS JOIN LATERAL (
      SELECT x.codigo, x.descricao FROM cadastros.cnae x
       WHERE x.tenant_id = plataforma.tenant_referencia() AND x.codigo = e.codigo AND x.deleted_at IS NULL
       ORDER BY x.vigencia_fim IS NULL DESC, x.vigencia_inicio DESC
       LIMIT 1) c);
END $$;
COMMENT ON FUNCTION plataforma.cnae_descricoes(text[]) IS
  'Ficha da empresa (0066): [{codigo, descricao}] das subclasses CNAE pedidas, na ordem recebida, sem repetidos; código comparado só pelos dígitos; desconhecido sai da lista; NULL ou vazio = []; mais de 1000 = 22023. Só macuxierp_config. T-0106.';

CREATE OR REPLACE FUNCTION plataforma.municipio_nomes(p_codigos text[]) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF cardinality(p_codigos) > 1000 THEN
    RAISE EXCEPTION 'lista de municípios acima de 1000 códigos' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', m.codigo, 'nome', m.nome, 'uf', m.uf) ORDER BY e.ordem),
                    '[]'::jsonb)
    FROM (SELECT DISTINCT ON (d.codigo) d.codigo, d.ordem
            FROM (SELECT regexp_replace(i.valor, '[^0-9]', '', 'g') AS codigo, i.ordem
                    FROM unnest(p_codigos) WITH ORDINALITY i (valor, ordem)) d
           ORDER BY d.codigo, d.ordem) e
    CROSS JOIN LATERAL (
      SELECT x.codigo, x.nome, x.uf FROM cadastros.municipio x
       WHERE x.tenant_id = plataforma.tenant_referencia() AND x.codigo = e.codigo AND x.deleted_at IS NULL
       ORDER BY x.vigencia_fim IS NULL DESC, x.vigencia_inicio DESC
       LIMIT 1) m);
END $$;
COMMENT ON FUNCTION plataforma.municipio_nomes(text[]) IS
  'Ficha da empresa (0066): [{codigo, nome, uf}] dos municípios do IBGE pedidos, na ordem recebida, sem repetidos; código comparado só pelos dígitos; desconhecido sai da lista; NULL ou vazio = []; mais de 1000 = 22023. Só macuxierp_config. T-0106.';

-- Privilégios iguais aos da 0063: nada para PUBLIC; só macuxierp_config executa.
REVOKE ALL ON FUNCTION plataforma.cnae_descricoes(text[]), plataforma.municipio_nomes(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.cnae_descricoes(text[]), plataforma.municipio_nomes(text[]) TO macuxierp_config;
