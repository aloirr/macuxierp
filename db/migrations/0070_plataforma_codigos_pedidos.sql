-- 0070 — T-0106 (RD-2132 a 2134): interna plataforma.codigos_pedidos para as leituras da ficha; não muda dado. O porquê: docs/banco/README.md, seção da 0070.

SET LOCAL lock_timeout = '5s';

-- 7 dígitos: CHECK das 0005 e 0066.
CREATE OR REPLACE FUNCTION plataforma.codigos_pedidos(p_codigos text[]) RETURNS TABLE (codigo text, ordem bigint)
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF cardinality(p_codigos) > 1000 THEN
    RAISE EXCEPTION 'lista acima de 1000 códigos' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (d.c) d.c, d.o
      FROM (SELECT plataforma.receita_digitos(i.valor, '^[0-9]{7}$') AS c, i.ordem AS o
              FROM unnest(p_codigos) WITH ORDINALITY i (valor, ordem)) d
     WHERE d.c IS NOT NULL
     ORDER BY d.c, d.o;
END $$;
COMMENT ON FUNCTION plataforma.codigos_pedidos(text[]) IS
  'Interna (T-0106, 0070): códigos de 7 dígitos da lista (só os dígitos de cada item), um por código, com a posição da primeira ocorrência; o resto sai; NULL ou vazio = nenhuma linha; mais de 1000 itens = 22023. Base de cnae_descricoes e municipio_nomes (ordem recebida; desconhecido sai).';

CREATE OR REPLACE FUNCTION plataforma.cnae_descricoes(p_codigos text[]) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descricao', c.descricao) ORDER BY e.ordem),
                    '[]'::jsonb)
    FROM plataforma.codigos_pedidos(p_codigos) e
    CROSS JOIN LATERAL (
      SELECT x.codigo, x.descricao FROM cadastros.cnae x
       WHERE x.tenant_id = plataforma.tenant_referencia() AND x.codigo = e.codigo AND x.deleted_at IS NULL
       ORDER BY x.vigencia_fim IS NULL DESC, x.vigencia_inicio DESC
       LIMIT 1) c);
END $$;
COMMENT ON FUNCTION plataforma.cnae_descricoes(text[]) IS
  'Ficha da empresa (0066, 0070): [{codigo, descricao}] das subclasses CNAE 2.3 pedidas; lista como em plataforma.codigos_pedidos. T-0106.';

CREATE OR REPLACE FUNCTION plataforma.municipio_nomes(p_codigos text[]) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', m.codigo, 'nome', m.nome, 'uf', m.uf) ORDER BY e.ordem),
                    '[]'::jsonb)
    FROM plataforma.codigos_pedidos(p_codigos) e
    CROSS JOIN LATERAL (
      SELECT x.codigo, x.nome, x.uf FROM cadastros.municipio x
       WHERE x.tenant_id = plataforma.tenant_referencia() AND x.codigo = e.codigo AND x.deleted_at IS NULL
       ORDER BY x.vigencia_fim IS NULL DESC, x.vigencia_inicio DESC
       LIMIT 1) m);
END $$;
COMMENT ON FUNCTION plataforma.municipio_nomes(text[]) IS
  'Ficha da empresa (0066, 0070): [{codigo, nome, uf}] dos municípios do IBGE pedidos; lista como em plataforma.codigos_pedidos. T-0106.';

REVOKE ALL ON FUNCTION plataforma.codigos_pedidos(text[]) FROM PUBLIC;
