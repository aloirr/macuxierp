-- Diagnóstico de produção do Macuxi ERP (v0.3.27), só contagens, chamado pelo diagnostico.sh. Ver ADR 0003, item 2 e T-0120.
-- O teste scripts/deploy/diagnostico.test.mjs trava a forma deste arquivo.
BEGIN READ ONLY;

-- 1. C de hoje
\echo '== 1a. integracao_fdv.registro_publicado por tenant e entidade'
SELECT tenant_id, entidade, count(*) AS registros, count(*) FILTER (WHERE pendente) AS pendentes, count(*) FILTER (WHERE hash_confirmado IS NOT NULL) AS confirmados FROM integracao_fdv.registro_publicado WHERE deleted_at IS NULL GROUP BY 1,2 ORDER BY 1,2;
\echo '== 1b. integracao_fdv.lote_erro abertos por tenant, entidade e código'
SELECT tenant_id, entidade, codigo, count(*) AS erros_abertos FROM integracao_fdv.lote_erro WHERE resolvido_em IS NULL AND deleted_at IS NULL GROUP BY 1,2,3 ORDER BY 1,2,4 DESC;

-- 2. invariante da entrada (no lugar dos 12 ids da T-0057): lotes concluídos com corpo não nulo
\echo '== 2. cadastros.entrada_lote: concluídos, concluídos com corpo e outros estados'
SELECT count(*) FILTER (WHERE estado IN ('concluido','concluido_com_erros')) AS concluidos, count(*) FILTER (WHERE estado IN ('concluido','concluido_com_erros') AND corpo IS NOT NULL) AS concluidos_com_corpo, count(*) FILTER (WHERE estado NOT IN ('concluido','concluido_com_erros')) AS outros_estados FROM cadastros.entrada_lote;

-- 3. reentrega do cnpj_alterado
\echo '== 3a. core.empresa.cnpj_alterado@1: eventos, carga 0077, consumo cadastros.cnpj-empresa, pendentes e falhas'
SELECT count(*) AS eventos, count(*) FILTER (WHERE e.payload ->> 'request_id' LIKE 'migracao-0077:%') AS da_carga_0077, count(c.evento_id) AS com_consumo_cadastros, count(*) - count(c.evento_id) AS sem_consumo, count(*) FILTER (WHERE e.publicado_em IS NULL) AS nao_publicados, count(*) FILTER (WHERE e.erro LIKE 'falhou:%') AS falha_terminal FROM plataforma.evento e LEFT JOIN plataforma.evento_consumido c ON c.evento_id = e.id AND c.consumidor = 'cadastros.cnpj-empresa' WHERE e.nome = 'core.empresa.cnpj_alterado@1';
\echo '== 3b. filial padrão dos tenants ativos: CNPJ igual ou diferente do da empresa'
SELECT count(*) AS filiais_padrao, count(*) FILTER (WHERE f.cnpj = e.cnpj) AS cnpj_igual, count(*) FILTER (WHERE f.cnpj <> e.cnpj) AS cnpj_diferente, count(*) FILTER (WHERE e.id IS NULL) AS sem_empresa FROM cadastros.filial f JOIN plataforma.tenant t ON t.id = f.tenant_id AND t.situacao = 'ativo' AND t.id <> plataforma.tenant_referencia() LEFT JOIN core.empresa e ON e.tenant_id = f.tenant_id AND e.deleted_at IS NULL WHERE f.padrao AND f.deleted_at IS NULL;

-- 4. ficha salva à mão (0077); manual_sem_data deve ser sempre 0
\echo '== 4a. core.empresa: tenants com ficha manual (fora o de referência)'
SELECT e.tenant_id, t.situacao, count(*) FILTER (WHERE e.receita_fonte = 'manual') AS manual, count(*) AS empresas_vivas FROM core.empresa e JOIN plataforma.tenant t ON t.id = e.tenant_id WHERE e.deleted_at IS NULL AND t.id <> plataforma.tenant_referencia() GROUP BY e.tenant_id, t.situacao HAVING count(*) FILTER (WHERE e.receita_fonte = 'manual') > 0 ORDER BY e.tenant_id;
\echo '== 4b. core.empresa: total manual e manual sem receita_consultada_em (esperado 0)'
SELECT count(*) FILTER (WHERE receita_fonte = 'manual') AS total_manual, count(*) FILTER (WHERE receita_fonte = 'manual' AND receita_consultada_em IS NULL) AS manual_sem_data FROM core.empresa WHERE deleted_at IS NULL;

-- 5. regras tributárias vigentes por tenant e UF de origem (C-5: o cálculo não pode cair em REGRA_NAO_ENCONTRADA)
\echo '== 5. regras tributárias vigentes por tenant e UF de origem (uf_origem nula: regras_vivas = 0 é tenant sem regra; > 0 são regras para todas as UFs — RN-FIS-01 e 0013)'
-- vigência comparada com current_date do servidor do banco (UTC)
SELECT t.id AS tenant_id, t.situacao, r.uf_origem, count(r.id) FILTER (WHERE r.deleted_at IS NULL) AS regras_vivas, count(r.id) FILTER (WHERE r.deleted_at IS NULL AND r.vigencia_inicio <= current_date AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= current_date)) AS regras_vigentes, count(r.id) FILTER (WHERE r.deleted_at IS NULL AND r.vigencia_inicio <= current_date AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= current_date) AND r.tributo = 'icms') AS vigentes_icms FROM plataforma.tenant t LEFT JOIN fiscal.regra_tributaria r ON r.tenant_id = t.id WHERE t.situacao = 'ativo' AND t.id <> plataforma.tenant_referencia() GROUP BY t.id, t.situacao, r.uf_origem ORDER BY t.id, r.uf_origem NULLS FIRST;

ROLLBACK;
