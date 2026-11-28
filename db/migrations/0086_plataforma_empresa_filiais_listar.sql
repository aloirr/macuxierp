-- 0086 — Portal /config: filiais da empresa para o campo "Filiais" do cadastro de usuário (v0.3.32, T-0130).
-- Aditiva e reexecutável (só CREATE OR REPLACE de função nova; sem tabela, coluna nem índice). A versão anterior da API
-- roda sobre ela: ninguém a chama antes da rota GET /v1/plataforma/empresas/:id/filiais (FilialConfig do core).
-- O porquê: docs/banco/README.md, seção "Filiais da empresa no /config (0086)".

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- empresa_filiais_listar: o array de FilialConfig ({id, nome, padrao}, modules/core/contracts/usuarios-config.ts) das
-- filiais não excluídas da empresa, a padrão primeiro, depois por nome e id. nome = nome fantasia ou, sem ele, a razão
-- social da filial. Nunca o CNPJ, a IE, o endereço nem a configuração da NF-e. Como a empresa_json (0033, 0035,
-- 0080): SECURITY DEFINER, search_path fixo e só leitura de cadastros.filial, a segunda exceção da emenda da ADR 0012
-- §4. Exige a sessão de superadmin (MXS01 sem ela); empresa inexistente, excluída ou de referência = no_data_found,
-- como a empresa_usuarios_listar (0078). A leitura usa o índice da filial por tenant (filial_cnpj_uq, 0004).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plataforma.empresa_filiais_listar(p_id uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  t plataforma.tenant;
BEGIN
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_id AND plataforma.empresa_visivel(x);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'nome', f.nome, 'padrao', f.padrao)
                     ORDER BY f.padrao DESC, f.nome, f.id)
    FROM (SELECT cf.id, coalesce(nullif(btrim(cf.nome_fantasia), ''), cf.razao_social) AS nome, cf.padrao
          FROM cadastros.filial cf
          WHERE cf.tenant_id = t.id AND cf.deleted_at IS NULL) f), '[]'::jsonb);
END $$;
COMMENT ON FUNCTION plataforma.empresa_filiais_listar(uuid) IS
  'Portal /config (0086): filiais não excluídas da empresa como array de FilialConfig {id, nome, padrao} (nome fantasia ou razão social da filial), a padrão primeiro; sem CNPJ, IE, endereço nem NF-e. Lê só cadastros.filial (exceção da emenda da ADR 0012 §4, como a empresa_json). Exige sessão de superadmin; empresa inexistente, excluída ou de referência = no_data_found. Só macuxierp_config. T-0130.';

REVOKE ALL ON FUNCTION plataforma.empresa_filiais_listar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.empresa_filiais_listar(uuid) TO macuxierp_config;
