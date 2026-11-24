-- 0057 — Pré-cadastro de cliente recebido do Macuxi FDV (T-0059, desenho docs/desenho/T-0059.md §3; RN-INF-06).
-- - integracao_fdv.cliente_recebido: uma linha por pré-cadastro (cliente_uuid do FDV) e revisão. O reenvio do FDV volta no
--   mesmo cliente_uuid com revisão nova (ADR 0069 do FDV): vira a linha (cliente_uuid, revisão nova) com a situação
--   reenviado, e as revisões anteriores ficam como histórico; a seção do BKO mostra uma linha por cliente_uuid, a da
--   revisão mais recente. A mesma revisão entregue de novo (o FDV não viu o retorno) cai na mesma linha (UNIQUE) e só
--   soma tentativas_fdv.
-- - integracao_fdv.cliente_retorno: o retorno ao Hub (molde do retorno_enviado da 0007).
-- - integracao_fdv.registro_publicado.aguarda_vinculo: o espelho retém o cliente aceito até o 200 do vinculado (§5.4).
-- - integracao_fdv.sinal: agenda da busca e do retorno de clientes (§3.4).
-- - integracao_fdv.conflito_chave: código novo vinculo_divergente (422 external_id_divergente, §5.3).
-- - integracao_fdv.expurgar_pre_cadastro_recusado(p_corte): a limpeza diária da RN-INF-06 (LGPD), do worker.
-- Aditiva e reexecutável: tabelas, colunas anuláveis ou com padrão, índices, CHECK ampliado, função, grants e COMMENT.
-- Regras e o porquê de cada coluna: docs/banco/README.md, seção da 0057.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. integracao_fdv.cliente_recebido
-- ---------------------------------------------------------------------------------------------------------------
-- Dado pessoal: só no payload (o ClienteParaErpFdv inteiro, para validar e criar o cliente), na razao_social e no
-- documento_mascarado (a tela). O documento nunca fica inteiro fora do payload. O payload é anulado no aceito (o
-- cliente já está no cadastros) e, no recusado, 180 dias depois da última recusa do pré-cadastro, junto com a razão
-- social e o documento mascarado (RN-INF-06): ficam só os códigos (external_id, cliente_uuid, revisão, codigo_fdv,
-- vendedor_external_id, hash), os códigos de erro e as contagens.
CREATE TABLE IF NOT EXISTS integracao_fdv.cliente_recebido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  cliente_uuid uuid NOT NULL,
  revisao integer NOT NULL DEFAULT 1 CONSTRAINT cliente_recebido_revisao CHECK (revisao >= 1),
  hash plataforma.sha256_hex NOT NULL,
  codigo_fdv text CONSTRAINT cliente_recebido_codigo_fdv CHECK (codigo_fdv ~ '^[0-9]{5,200}$'),
  razao_social text CONSTRAINT cliente_recebido_razao_social CHECK (length(razao_social) BETWEEN 1 AND 200),
  documento_mascarado text CONSTRAINT cliente_recebido_documento_mascarado CHECK (
    documento_mascarado ~ '^(\*\*\*\.[0-9]{3}\.[0-9]{3}-\*\*|[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}/\*{4}-\*\*)$'),
  vendedor_external_id text CONSTRAINT cliente_recebido_vendedor CHECK (length(vendedor_external_id) BETWEEN 1 AND 200),
  payload jsonb CONSTRAINT cliente_recebido_payload_objeto CHECK (jsonb_typeof(payload) = 'object'),
  recebido_em timestamptz(3) NOT NULL,
  chegou_em timestamptz(3) NOT NULL DEFAULT now(),
  tentativas_fdv integer NOT NULL DEFAULT 1 CONSTRAINT cliente_recebido_tentativas CHECK (tentativas_fdv >= 1),
  situacao text NOT NULL DEFAULT 'recebido'
    CONSTRAINT cliente_recebido_situacao CHECK (situacao IN ('recebido', 'aceito', 'recusado', 'reenviado')),
  motivo text CONSTRAINT cliente_recebido_motivo CHECK (length(motivo) BETWEEN 1 AND 300),
  erros jsonb CONSTRAINT cliente_recebido_erros CHECK (jsonb_typeof(erros) = 'array'
    AND jsonb_array_length(erros) BETWEEN 1 AND 50),
  cliente_id uuid,
  decidido_em timestamptz(3),
  ultima_recusa_em timestamptz(3),
  payload_expurgado_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT cliente_recebido_revisao_uq UNIQUE (tenant_id, cliente_uuid, revisao),
  -- reenviado = revisão nova depois de uma recusa (a primeira revisão nunca é reenvio)
  CONSTRAINT cliente_recebido_reenviado CHECK (situacao <> 'reenviado' OR revisao > 1),
  CONSTRAINT cliente_recebido_aceito CHECK ((situacao = 'aceito') = (cliente_id IS NOT NULL)),
  CONSTRAINT cliente_recebido_recusado CHECK ((situacao = 'recusado') = (motivo IS NOT NULL)),
  CONSTRAINT cliente_recebido_erros_recusado CHECK (erros IS NULL OR situacao = 'recusado'),
  CONSTRAINT cliente_recebido_decidido CHECK ((situacao IN ('aceito', 'recusado')) = (decidido_em IS NOT NULL)),
  CONSTRAINT cliente_recebido_ultima_recusa CHECK (situacao <> 'recusado' OR ultima_recusa_em IS NOT NULL),
  -- payload: obrigatório na validação (recebido, reenviado); nulo no aceito; no recusado, até o expurgo
  CONSTRAINT cliente_recebido_payload CHECK (CASE situacao
    WHEN 'aceito' THEN payload IS NULL AND payload_expurgado_em IS NULL
    WHEN 'recusado' THEN (payload IS NULL) = (payload_expurgado_em IS NOT NULL)
    ELSE payload IS NOT NULL AND payload_expurgado_em IS NULL END),
  -- expurgado (RN-INF-06): sem razão social nem documento; antes dele, a razão social é obrigatória
  CONSTRAINT cliente_recebido_expurgo CHECK (CASE WHEN payload_expurgado_em IS NULL THEN razao_social IS NOT NULL
    ELSE razao_social IS NULL AND documento_mascarado IS NULL AND ultima_recusa_em IS NOT NULL END)
);
SELECT controle.preparar_tabela('integracao_fdv.cliente_recebido');
-- seção do BKO, os mais recentes primeiro; "a revisão mais recente" usa o UNIQUE (tenant_id, cliente_uuid, revisao),
-- lido de trás para frente (um índice DESC igual seria redundante)
CREATE INDEX IF NOT EXISTS cliente_recebido_chegada_idx ON integracao_fdv.cliente_recebido (tenant_id, chegou_em DESC);
-- rotina diária da RN-INF-06: só os recusados que ainda guardam o payload
CREATE INDEX IF NOT EXISTS cliente_recebido_expurgo_idx ON integracao_fdv.cliente_recebido (tenant_id, ultima_recusa_em)
  WHERE situacao = 'recusado' AND payload IS NOT NULL;

COMMENT ON TABLE integracao_fdv.cliente_recebido IS
  'Pré-cadastro de cliente recebido do Macuxi FDV (GET /integracao/v1/clientes/pendentes), uma linha por (cliente_uuid, revisao). Reenvio = revisão nova (situacao reenviado); a mesma revisão de novo só soma tentativas_fdv. Payload nulo no aceito e expurgado 180 dias depois da última recusa (RN-INF-06). T-0059.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.hash IS
  'O hash do Hub (ADR 0069 do FDV) ou, quando o Hub não manda (antes da v1.0.30), o do ERP sobre o payload canônico. T-0059.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.documento_mascarado IS
  'Gravado já mascarado (mascararDocumentoFdv do SDK): CPF ***.456.789-** e CNPJ 12.345.678/****-**; nulo quando o documento não tem 11 nem 14 posições. Anulado no expurgo. T-0059.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.vendedor_external_id IS
  'Código do vendedor no ERP, aditivo do FDV v1.0.34; nulo quando o FDV não manda ou o vendedor não tem código (a tela mostra "—"). T-0059.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.payload IS
  'O ClienteParaErpFdv recebido (com dado pessoal). Obrigatório em recebido e reenviado; nulo no aceito; no recusado, até o expurgo da RN-INF-06. Nunca sai na rota do BKO nem no log. T-0059.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.ultima_recusa_em IS
  'Quando o ERP recusou esta revisão (RN-INF-06): o prazo de 180 dias conta da última recusa do pré-cadastro (a maior entre as revisões do cliente_uuid). T-0059.';
COMMENT ON COLUMN integracao_fdv.cliente_recebido.payload_expurgado_em IS
  'Quando a expurgar_pre_cadastro_recusado anulou payload, razao_social e documento_mascarado (RN-INF-06). Só a função grava. T-0059.';

-- ---------------------------------------------------------------------------------------------------------------
-- 2. integracao_fdv.cliente_retorno (molde do retorno_enviado da 0007)
-- ---------------------------------------------------------------------------------------------------------------
-- O corpo enviado ao Hub (montarRetornoClienteFdv do SDK: códigos, motivo e erros do catálogo, sem dado pessoal) e o
-- hash dele sem ocorrido_em: a mesma decisão nunca vira dois retornos. falhou é terminal (fora da fila).
CREATE TABLE IF NOT EXISTS integracao_fdv.cliente_retorno (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  cliente_uuid uuid NOT NULL,
  revisao integer NOT NULL CONSTRAINT cliente_retorno_revisao CHECK (revisao >= 1),
  status text NOT NULL CONSTRAINT cliente_retorno_status CHECK (status IN ('vinculado', 'rejeitado_erp')),
  corpo jsonb NOT NULL CONSTRAINT cliente_retorno_corpo CHECK (jsonb_typeof(corpo) = 'object'),
  hash plataforma.sha256_hex NOT NULL,
  estado text NOT NULL DEFAULT 'pendente'
    CONSTRAINT cliente_retorno_estado CHECK (estado IN ('pendente', 'enviado', 'falhou')),
  tentativas integer NOT NULL DEFAULT 0 CONSTRAINT cliente_retorno_tentativas CHECK (tentativas >= 0),
  resposta_http integer CONSTRAINT cliente_retorno_resposta_http CHECK (resposta_http BETWEEN 100 AND 599),
  codigo_recusa integracao_fdv.codigo,
  enviado_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT cliente_retorno_uq UNIQUE (tenant_id, cliente_uuid, revisao, status, hash),
  CONSTRAINT cliente_retorno_enviado CHECK (estado <> 'enviado' OR enviado_em IS NOT NULL),
  CONSTRAINT cliente_retorno_codigo_recusa CHECK (codigo_recusa IS NULL OR estado = 'falhou'),
  CONSTRAINT cliente_retorno_recebido_fk FOREIGN KEY (tenant_id, cliente_uuid, revisao)
    REFERENCES integracao_fdv.cliente_recebido (tenant_id, cliente_uuid, revisao)
);
SELECT controle.preparar_tabela('integracao_fdv.cliente_retorno');
CREATE INDEX IF NOT EXISTS cliente_retorno_fila_idx ON integracao_fdv.cliente_retorno (tenant_id, created_at)
  WHERE estado = 'pendente';
COMMENT ON TABLE integracao_fdv.cliente_retorno IS
  'Retorno do pré-cadastro ao Hub (POST /integracao/v1/clientes/{cliente_uuid}/retorno): vinculado ou rejeitado_erp, com o corpo e o hash dele sem ocorrido_em (UNIQUE: a mesma decisão nunca vira dois retornos). codigo_recusa = o código do 422 (só em falhou). T-0059.';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Espelho: aguarda_vinculo (o cliente aceito fica fora do lote até o 200 do vinculado, §5.4)
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE integracao_fdv.registro_publicado ADD COLUMN IF NOT EXISTS aguarda_vinculo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN integracao_fdv.registro_publicado.aguarda_vinculo IS
  'true = cliente (e endereços) aceito de um pré-cadastro do FDV cujo retorno vinculado ainda não teve 200: o montador do lote o ignora. O 200 limpa na mesma transação. T-0059 §5.4.';
-- A fila do lote passa a filtrar NOT aguarda_vinculo. O registro_publicado_fila_idx (WHERE pendente) fica para a versão
-- anterior do worker e sai numa migração seguinte, quando nenhuma versão o usar.
CREATE INDEX IF NOT EXISTS registro_publicado_fila_livre_idx ON integracao_fdv.registro_publicado
  (tenant_id, entidade, alterado_em, registro_external_id COLLATE "C") WHERE pendente AND NOT aguarda_vinculo;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Agenda (§3.4), no molde das colunas dos pedidos: nulas até o worker ligar a busca de clientes
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE integracao_fdv.sinal ADD COLUMN IF NOT EXISTS proxima_busca_clientes_em timestamptz(3),
  ADD COLUMN IF NOT EXISTS proximo_retorno_clientes_em timestamptz(3);
CREATE INDEX IF NOT EXISTS sinal_proxima_busca_clientes_idx ON integracao_fdv.sinal (proxima_busca_clientes_em)
  WHERE proxima_busca_clientes_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS sinal_proximo_retorno_clientes_idx ON integracao_fdv.sinal (proximo_retorno_clientes_em)
  WHERE proximo_retorno_clientes_em IS NOT NULL;
COMMENT ON COLUMN integracao_fdv.sinal.proxima_busca_clientes_em IS
  'Agenda da busca de pré-cadastros (integracao-fdv.busca-clientes, 60 s); nula até ligar. T-0059 §3.4.';
COMMENT ON COLUMN integracao_fdv.sinal.proximo_retorno_clientes_em IS
  'Agenda do retorno dos pré-cadastros (integracao-fdv.retorno-clientes); nula até ligar. T-0059 §3.4.';

-- ---------------------------------------------------------------------------------------------------------------
-- 5. conflito_chave: vinculo_divergente (422 external_id_divergente do retorno vinculado, §5.3)
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE integracao_fdv.conflito_chave DROP CONSTRAINT IF EXISTS conflito_chave_codigo,
  ADD CONSTRAINT conflito_chave_codigo CHECK (codigo IN ('chave_alterada', 'chave_duplicada', 'vinculo_divergente'));

-- ---------------------------------------------------------------------------------------------------------------
-- 6. RN-INF-06: expurgo do pré-cadastro recusado (rotina diária do worker, no tenant da sessão)
-- ---------------------------------------------------------------------------------------------------------------
-- p_corte = agora − 180 dias (o worker calcula; mais novo que isso = check_violation, nada sai antes do prazo). Anula
-- payload, razao_social e documento_mascarado das revisões recusadas cujo pré-cadastro (cliente_uuid) não tem recusa
-- em p_corte ou depois. Não toca aceito, recebido, reenviado nem outro tenant. Audita só as contagens.
CREATE OR REPLACE FUNCTION integracao_fdv.expurgar_pre_cadastro_recusado(p_corte timestamptz) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_t uuid := plataforma.tenant_atual();
  v_revisoes integer;
  v_pre integer;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'sem tenant na sessão (app.tenant_id)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_corte IS NULL OR p_corte > now() - interval '180 days' THEN
    RAISE EXCEPTION 'corte antes do prazo de 180 dias da RN-INF-06' USING ERRCODE = 'check_violation';
  END IF;
  WITH alvo AS (
    SELECT r.id FROM integracao_fdv.cliente_recebido r
     WHERE r.tenant_id = v_t AND r.situacao = 'recusado' AND r.payload IS NOT NULL AND r.ultima_recusa_em < p_corte
       AND NOT EXISTS (SELECT 1 FROM integracao_fdv.cliente_recebido o
                        WHERE o.tenant_id = v_t AND o.cliente_uuid = r.cliente_uuid AND o.ultima_recusa_em >= p_corte)
     ORDER BY r.id FOR UPDATE),
  u AS (
    UPDATE integracao_fdv.cliente_recebido r
       SET payload = NULL, razao_social = NULL, documento_mascarado = NULL, payload_expurgado_em = now()
      FROM alvo WHERE r.id = alvo.id
    RETURNING r.cliente_uuid)
  SELECT count(*)::int, count(DISTINCT u.cliente_uuid)::int INTO v_revisoes, v_pre FROM u;
  IF v_revisoes > 0 THEN
    INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, entidade_id, antes, depois)
    VALUES (v_t, NULL, 'integracao-fdv.pre-cadastro.expurgar', 'cliente_recebido', NULL, NULL,
      jsonb_build_object('regra', 'RN-INF-06', 'revisoes', v_revisoes, 'pre_cadastros', v_pre));
  END IF;
  RETURN jsonb_build_object('revisoes', v_revisoes, 'pre_cadastros', v_pre);
END $$;
COMMENT ON FUNCTION integracao_fdv.expurgar_pre_cadastro_recusado(timestamptz) IS
  'RN-INF-06 (LGPD), rotina diária do worker no tenant da sessão (app.tenant_id; sem ele = 42501): anula payload, razao_social e documento_mascarado das revisões recusadas cujo pré-cadastro não tem recusa em p_corte ou depois, e marca payload_expurgado_em. p_corte nulo ou depois de agora − 180 dias = check_violation. Ficam os códigos, os erros e as contagens. Audita integracao-fdv.pre-cadastro.expurgar só com as contagens (quando há o que expurgar). Devolve {revisoes, pre_cadastros}. Só macuxierp_worker. T-0059.';
REVOKE ALL ON FUNCTION integracao_fdv.expurgar_pre_cadastro_recusado(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integracao_fdv.expurgar_pre_cadastro_recusado(timestamptz) TO macuxierp_worker;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Privilégios (matriz da 0007; sem DELETE para ninguém)
-- ---------------------------------------------------------------------------------------------------------------
-- cliente_recebido: o worker grava e decide; não muda os códigos (cliente_uuid, revisao, hash, recebido_em) nem as
-- colunas do expurgo (só a função). O app (rota do BKO) e a leitura leem tudo menos o payload.
GRANT SELECT, INSERT ON integracao_fdv.cliente_recebido TO macuxierp_worker;
GRANT UPDATE (tentativas_fdv, situacao, motivo, erros, cliente_id, decidido_em, ultima_recusa_em, payload,
  vendedor_external_id, codigo_fdv, deleted_at) ON integracao_fdv.cliente_recebido TO macuxierp_worker;
GRANT SELECT (id, tenant_id, cliente_uuid, revisao, hash, codigo_fdv, razao_social, documento_mascarado,
  vendedor_external_id, recebido_em, chegou_em, tentativas_fdv, situacao, motivo, erros, cliente_id, decidido_em,
  ultima_recusa_em, payload_expurgado_em, created_at, updated_at, deleted_at, external_id)
  ON integracao_fdv.cliente_recebido TO macuxierp_app, macuxierp_leitura;
-- cliente_retorno: como o retorno_enviado (worker SIU; app e leitura leem)
GRANT SELECT, INSERT, UPDATE ON integracao_fdv.cliente_retorno TO macuxierp_worker;
GRANT SELECT ON integracao_fdv.cliente_retorno TO macuxierp_app, macuxierp_leitura;
