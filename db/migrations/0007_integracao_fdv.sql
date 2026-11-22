-- 0007 — Schema integracao_fdv: estado do conector nativo do ERP no Hub /integracao/v1 do FDV (T-0010, F2). Fonte dos
-- nomes e colunas: docs/desenho/T-0009.md, seção 8 (e 3 a 6.1, 9); docs/produto/04 e 06; RF-INF-01/03/04/05,
-- RN-INF-01/03/04, RN-PED-01, RN-PED-05. Aditiva e reexecutável; não toca em outro schema.
-- O ERP nunca lê tabela do FDV (RN-INF-01) e este schema não lê os outros: o que vai ao Hub sai do espelho próprio
-- (registro_publicado e referencia, M1). UUIDs do ERP (fonte_refs, erp_id, pedido_id) são opacos, sem FK entre schemas.
-- A coluna external_id da regra 5 existe em todas (preparar_tabela), mas fica nula: a chave do Hub é
-- registro_external_id (o UUID do registro no ERP, M2). Datas de negócio em timestamptz(3) (a ordem do Hub é em ms);
-- created_at, updated_at e deleted_at seguem timestamptz como no resto do banco (o teste da regra 5 confere o tipo).
-- Sem função SECURITY DEFINER.

-- As 12 entidades do Hub que o ERP alimenta (seção 2, ORDEM_CARGA_ENTIDADES). Entidade nova = ALTER DOMAIN numa
-- migração nova (aditiva).
DO $$
BEGIN
  CREATE DOMAIN integracao_fdv.entidade_hub AS text CHECK (VALUE IN ('filial', 'vendedor', 'forma_pagamento',
    'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco', 'titulo', 'nota'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Código de erro ou de motivo (catálogo do ERP ou do Hub): só identificador, nunca texto livre nem valor de campo
-- (RN-INF-04; a mensagem sai do catálogo pelo código).
DO $$
BEGIN
  CREATE DOMAIN integracao_fdv.codigo AS text CHECK (VALUE ~ '^[a-z][a-z0-9_]{0,59}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Credencial do conector (RF-INF-05, seção 6): AES-256-GCM pela API como o A1 (ADR 0005), chave mestra
-- MACUXIERP_CHAVE_INTEGRACAO no secret do servidor (nunca no banco), tenant_id como dado associado. chave_cifrada =
-- nonce (12) + texto cifrado + tag (16). Só o prefixo fica em claro. Ativa = substituida_em e deleted_at nulos. Troca
-- (chave, conector ou ambiente) = linha nova; a substituída tem a chave anulada depois de 7 dias.
CREATE TABLE IF NOT EXISTS integracao_fdv.credencial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  conector_id text NOT NULL CHECK (conector_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  ambiente text NOT NULL CHECK (ambiente IN ('teste', 'producao')),
  chave_cifrada bytea CHECK (length(chave_cifrada) > 28),
  chave_prefixo text NOT NULL CHECK (length(chave_prefixo) BETWEEN 1 AND 8),
  chave_mestra_versao integer NOT NULL DEFAULT 1 CHECK (chave_mestra_versao >= 1),
  substituida_em timestamptz(3),
  criada_por uuid,
  ultimo_uso_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT credencial_chave_so_da_substituida CHECK (chave_cifrada IS NOT NULL OR substituida_em IS NOT NULL)
);
SELECT controle.preparar_tabela('integracao_fdv.credencial');
CREATE UNIQUE INDEX IF NOT EXISTS credencial_uma_ativa_por_tenant ON integracao_fdv.credencial (tenant_id)
  WHERE substituida_em IS NULL AND deleted_at IS NULL;

-- A chave gravada nunca é trocada nem regravada (troca = linha nova): o UPDATE só pode anulá-la. Vale para todos.
CREATE OR REPLACE FUNCTION integracao_fdv.credencial_chave_so_anula() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.chave_cifrada IS NOT NULL AND NEW.chave_cifrada IS DISTINCT FROM OLD.chave_cifrada THEN
    RAISE EXCEPTION 'integracao_fdv.credencial: a chave só pode ser anulada (troca = credencial nova)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS credencial_chave_so_anula ON integracao_fdv.credencial;
CREATE TRIGGER credencial_chave_so_anula BEFORE UPDATE OF chave_cifrada ON integracao_fdv.credencial
  FOR EACH ROW EXECUTE FUNCTION integracao_fdv.credencial_chave_so_anula();

-- Lote enviado ao Hub (seções 3, 4 e M6). O corpo fica congelado até o estado final (a retentativa reenvia o mesmo
-- corpo com a mesma chave) e é anulado 7 dias depois. chave_idempotencia = SHA-256 hex do conteúdo canônico + geracao.
-- Em voo: montado, enviando, aceito (no máximo um por entidade no tenant). Estado final (fora do voo, concluido_em
-- preenchido): concluido, concluido_com_erros, falhou (o Hub processou e falhou) e recusado (4xx sem retentativa; a
-- pausa fica no cursor_entidade). Sem data própria de retentativa: a agenda é cursor_entidade.proximo_em.
CREATE TABLE IF NOT EXISTS integracao_fdv.lote_envio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  entidade integracao_fdv.entidade_hub NOT NULL,
  credencial_id uuid NOT NULL,
  modo text NOT NULL CHECK (modo IN ('completo', 'delta')),
  sessao_id uuid,
  sessao_parte integer CHECK (sessao_parte >= 1),
  sessao_ultimo boolean,
  geracao integer NOT NULL DEFAULT 1 CHECK (geracao >= 1),
  chave_idempotencia plataforma.sha256_hex NOT NULL,
  corpo jsonb CHECK (jsonb_typeof(corpo) = 'object'),
  cursor_declarado jsonb CHECK (jsonb_typeof(cursor_declarado) = 'object'),
  hub_lote_id uuid,
  estado text NOT NULL DEFAULT 'montado' CHECK (estado IN ('montado', 'enviando', 'aceito', 'concluido',
    'concluido_com_erros', 'falhou', 'recusado')),
  repetido boolean NOT NULL DEFAULT false,
  contagens jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(contagens) = 'object'),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultimo_erro_codigo integracao_fdv.codigo,
  enviado_em timestamptz(3),
  concluido_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT lote_envio_sessao CHECK (
    (modo = 'completo' AND sessao_id IS NOT NULL AND sessao_parte IS NOT NULL AND sessao_ultimo IS NOT NULL)
    OR (modo = 'delta' AND sessao_id IS NULL AND sessao_parte IS NULL AND sessao_ultimo IS NULL)),
  CONSTRAINT lote_envio_corpo_em_voo CHECK (estado NOT IN ('montado', 'enviando', 'aceito') OR corpo IS NOT NULL),
  CONSTRAINT lote_envio_aceito CHECK (estado NOT IN ('aceito', 'concluido', 'concluido_com_erros') OR hub_lote_id IS NOT NULL),
  CONSTRAINT lote_envio_final CHECK (estado IN ('montado', 'enviando', 'aceito') OR concluido_em IS NOT NULL),
  CONSTRAINT lote_envio_final_com_erro CHECK (estado NOT IN ('falhou', 'recusado') OR ultimo_erro_codigo IS NOT NULL),
  FOREIGN KEY (tenant_id, credencial_id) REFERENCES integracao_fdv.credencial (tenant_id, id)
);
SELECT controle.preparar_tabela('integracao_fdv.lote_envio');
CREATE UNIQUE INDEX IF NOT EXISTS lote_envio_chave_idempotencia_uq ON integracao_fdv.lote_envio
  (tenant_id, chave_idempotencia);
CREATE UNIQUE INDEX IF NOT EXISTS lote_envio_um_em_voo ON integracao_fdv.lote_envio (tenant_id, entidade)
  WHERE estado IN ('montado', 'enviando', 'aceito');
CREATE UNIQUE INDEX IF NOT EXISTS lote_envio_hub_lote_uq ON integracao_fdv.lote_envio (tenant_id, hub_lote_id)
  WHERE hub_lote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lote_envio_entidade_estado_idx ON integracao_fdv.lote_envio (tenant_id, entidade, estado);

-- Espelho (M1): um registro por (tenant, entidade do Hub, registro_external_id) com o payload canônico do Hub (sem
-- custo, M8), o hash (RN-INF-03), a ordem (alterado_em = ocorrido_em do evento, M3) e a marca pendente. O payload do
-- inativado e já confirmado é anulado em 30 dias. registro_external_id em COLLATE "C": a ordem é a do Hub.
CREATE TABLE IF NOT EXISTS integracao_fdv.registro_publicado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  entidade integracao_fdv.entidade_hub NOT NULL,
  registro_external_id text COLLATE "C" NOT NULL CHECK (length(registro_external_id) BETWEEN 1 AND 200),
  payload jsonb CHECK (jsonb_typeof(payload) = 'object'),
  hash plataforma.sha256_hex NOT NULL,
  alterado_em timestamptz(3) NOT NULL,
  fonte_ocorrido_em timestamptz(3) NOT NULL,
  fonte_refs jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(fonte_refs) = 'object'),
  ativo boolean NOT NULL,
  pendente boolean NOT NULL DEFAULT true,
  hash_confirmado plataforma.sha256_hex,
  confirmado_em timestamptz(3),
  ultimo_lote_envio_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT registro_publicado_sem_custo CHECK (
    payload IS NULL OR NOT (payload ?| ARRAY['custo_cents', 'custo_centavos', 'preco_venda_cents'])),
  CONSTRAINT registro_publicado_confirmacao CHECK ((hash_confirmado IS NULL) = (confirmado_em IS NULL)),
  CONSTRAINT registro_publicado_payload_anulado CHECK (
    payload IS NOT NULL OR (NOT ativo AND NOT pendente AND hash_confirmado IS NOT NULL)),
  FOREIGN KEY (tenant_id, ultimo_lote_envio_id) REFERENCES integracao_fdv.lote_envio (tenant_id, id)
);
SELECT controle.preparar_tabela('integracao_fdv.registro_publicado');
CREATE UNIQUE INDEX IF NOT EXISTS registro_publicado_registro_uq ON integracao_fdv.registro_publicado
  (tenant_id, entidade, registro_external_id);
CREATE INDEX IF NOT EXISTS registro_publicado_fila_idx ON integracao_fdv.registro_publicado
  (tenant_id, entidade, alterado_em, registro_external_id COLLATE "C") WHERE pendente;
CREATE INDEX IF NOT EXISTS registro_publicado_carga_idx ON integracao_fdv.registro_publicado
  (tenant_id, entidade, alterado_em, registro_external_id COLLATE "C") WHERE ativo;
CREATE INDEX IF NOT EXISTS registro_publicado_fonte_refs_idx ON integracao_fdv.registro_publicado
  USING gin (fonte_refs jsonb_path_ops);

-- Referências que não viram entidade do Hub mas compõem campo (M1, M10): tabela de preço (nome, vigência, inativo) e
-- filial padrão. dados só com essas chaves (sem dado pessoal).
CREATE TABLE IF NOT EXISTS integracao_fdv.referencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('tabela_preco', 'filial_padrao')),
  erp_id uuid NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dados) = 'object'
    AND dados - ARRAY['nome', 'vigencia_inicio', 'vigencia_fim', 'inativo', 'filial_id'] = '{}'::jsonb),
  fonte_ocorrido_em timestamptz(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64)
);
SELECT controle.preparar_tabela('integracao_fdv.referencia');
CREATE UNIQUE INDEX IF NOT EXISTS referencia_uq ON integracao_fdv.referencia (tenant_id, tipo, erp_id);

-- Cursor e agenda por entidade (seções 4, 5 e 6.1). Cursor nulo = carga completa. A reserva do worker (sem tenant,
-- worker_global) lê só as linhas vencidas e não pausadas. Pausa sem retentativa automática: os motivos da seção 5.
CREATE TABLE IF NOT EXISTS integracao_fdv.cursor_entidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  entidade integracao_fdv.entidade_hub NOT NULL,
  credencial_id uuid,
  cursor_alterado_em timestamptz(3),
  cursor_external_id text COLLATE "C" CHECK (length(cursor_external_id) BETWEEN 1 AND 200),
  sessao_aberta_id uuid,
  pausada_motivo text CHECK (pausada_motivo IN ('credencial', 'licenca_fdv', 'licenca_erp', 'versao', 'envelope',
    'idempotencia', 'topologia')),
  pausada_em timestamptz(3),
  proximo_em timestamptz(3) NOT NULL DEFAULT now(),
  ultimo_envio_em timestamptz(3),
  ultimo_sucesso_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT cursor_entidade_uq UNIQUE (tenant_id, entidade),
  CONSTRAINT cursor_entidade_par CHECK ((cursor_alterado_em IS NULL) = (cursor_external_id IS NULL)),
  CONSTRAINT cursor_entidade_pausa CHECK ((pausada_motivo IS NULL) = (pausada_em IS NULL)),
  FOREIGN KEY (tenant_id, credencial_id) REFERENCES integracao_fdv.credencial (tenant_id, id)
);
SELECT controle.preparar_tabela('integracao_fdv.cursor_entidade');
SELECT controle.worker_global('integracao_fdv.cursor_entidade');
CREATE INDEX IF NOT EXISTS cursor_entidade_agenda_idx ON integracao_fdv.cursor_entidade (proximo_em)
  WHERE pausada_motivo IS NULL;

-- Erro por linha (seção 5): o do ERP (validação local, M5) e o do Hub. Sem mensagem livre nem valor: a mensagem sai
-- do catálogo pelo código. O registro volta a pendente e o erro fica resolvido no lote que o aceitar.
CREATE TABLE IF NOT EXISTS integracao_fdv.lote_erro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  lote_envio_id uuid NOT NULL,
  indice integer NOT NULL CHECK (indice >= 0),
  origem text NOT NULL CHECK (origem IN ('erp', 'hub')),
  entidade integracao_fdv.entidade_hub NOT NULL,
  registro_external_id text CHECK (length(registro_external_id) BETWEEN 1 AND 200),
  codigo integracao_fdv.codigo NOT NULL,
  campo text CHECK (campo ~ '^[A-Za-z0-9_.\[\]]{1,80}$'),
  reprocessavel boolean NOT NULL DEFAULT false,
  resolvido_em timestamptz(3),
  resolvido_no_lote_envio_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT lote_erro_linha_uq UNIQUE (lote_envio_id, origem, indice),
  CONSTRAINT lote_erro_resolvido CHECK (resolvido_no_lote_envio_id IS NULL OR resolvido_em IS NOT NULL),
  FOREIGN KEY (tenant_id, lote_envio_id) REFERENCES integracao_fdv.lote_envio (tenant_id, id),
  FOREIGN KEY (tenant_id, resolvido_no_lote_envio_id) REFERENCES integracao_fdv.lote_envio (tenant_id, id)
);
SELECT controle.preparar_tabela('integracao_fdv.lote_erro');
CREATE INDEX IF NOT EXISTS lote_erro_entidade_idx ON integracao_fdv.lote_erro (tenant_id, entidade, resolvido_em);
CREATE INDEX IF NOT EXISTS lote_erro_codigo_idx ON integracao_fdv.lote_erro (tenant_id, codigo);

-- Pedido baixado do Hub (F3, seção 9; criada já). Idempotente pelo pedido_uuid do FDV (RN-PED-01): o reenvio do Hub
-- cai no mesmo registro e só atualiza recebido_em (última entrega; created_at é a primeira). rejeitado é terminal
-- (erro_codigo obrigatório) e fica fora da fila. payload anulado 90 dias depois de entregue.
CREATE TABLE IF NOT EXISTS integracao_fdv.pedido_recebido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  pedido_uuid uuid NOT NULL,
  payload jsonb CHECK (jsonb_typeof(payload) = 'object'),
  hash plataforma.sha256_hex NOT NULL,
  recebido_em timestamptz(3) NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'recebido' CHECK (estado IN ('recebido', 'entregue', 'rejeitado')),
  pedido_id uuid,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  erro_codigo integracao_fdv.codigo,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT pedido_recebido_pedido_uuid_uq UNIQUE (tenant_id, pedido_uuid),
  CONSTRAINT pedido_recebido_payload CHECK (payload IS NOT NULL OR estado = 'entregue'),
  CONSTRAINT pedido_recebido_rejeitado CHECK (estado <> 'rejeitado' OR erro_codigo IS NOT NULL)
);
SELECT controle.preparar_tabela('integracao_fdv.pedido_recebido');
CREATE INDEX IF NOT EXISTS pedido_recebido_fila_idx ON integracao_fdv.pedido_recebido (tenant_id, recebido_em)
  WHERE estado = 'recebido';

-- Retorno do pedido ao Hub (F3, RN-PED-05): o corpo enviado e o hash dele; o mesmo status com o mesmo conteúdo nunca
-- vira dois retornos. Retentativa reenvia o mesmo corpo (sem data própria: a agenda é sinal.proximo_retorno_em).
-- falhou é terminal (fora da fila); pendente segue retentável.
CREATE TABLE IF NOT EXISTS integracao_fdv.retorno_enviado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  pedido_uuid uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total',
    'cancelado')),
  numero_erp text CHECK (length(numero_erp) BETWEEN 1 AND 30),
  corpo jsonb NOT NULL CHECK (jsonb_typeof(corpo) = 'object'),
  hash plataforma.sha256_hex NOT NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'enviado', 'falhou')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  resposta_http integer CHECK (resposta_http BETWEEN 100 AND 599),
  itens_descartados jsonb CHECK (jsonb_typeof(itens_descartados) = 'array'),
  enviado_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT retorno_enviado_uq UNIQUE (tenant_id, pedido_uuid, status, hash),
  CONSTRAINT retorno_enviado_enviado CHECK (estado <> 'enviado' OR enviado_em IS NOT NULL),
  FOREIGN KEY (tenant_id, pedido_uuid) REFERENCES integracao_fdv.pedido_recebido (tenant_id, pedido_uuid)
);
SELECT controle.preparar_tabela('integracao_fdv.retorno_enviado');
CREATE INDEX IF NOT EXISTS retorno_enviado_fila_idx ON integracao_fdv.retorno_enviado (tenant_id, created_at)
  WHERE estado = 'pendente';

-- Sinal de vida e agenda das tarefas do tenant (seções 6 e 6.1): uma linha por tenant, sem dado pessoal. As colunas
-- proximo*_em são a agenda (worker_global); as da F3 ficam nulas até a F3 ligar.
CREATE TABLE IF NOT EXISTS integracao_fdv.sinal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  ultimo_envio_em timestamptz(3),
  ultimo_aceito_em timestamptz(3),
  ultimo_http integer CHECK (ultimo_http BETWEEN 100 AND 599),
  politica_versao jsonb CHECK (jsonb_typeof(politica_versao) = 'object'),
  parado_por_versao boolean NOT NULL DEFAULT false,
  proximo_sinal_em timestamptz(3) NOT NULL DEFAULT now(),
  proxima_reconciliacao_em timestamptz(3) NOT NULL DEFAULT now(),
  proxima_busca_pedidos_em timestamptz(3),
  proximo_retorno_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT sinal_um_por_tenant UNIQUE (tenant_id)
);
SELECT controle.preparar_tabela('integracao_fdv.sinal');
SELECT controle.worker_global('integracao_fdv.sinal');
CREATE INDEX IF NOT EXISTS sinal_proximo_sinal_idx ON integracao_fdv.sinal (proximo_sinal_em);
CREATE INDEX IF NOT EXISTS sinal_proxima_reconciliacao_idx ON integracao_fdv.sinal (proxima_reconciliacao_em);
CREATE INDEX IF NOT EXISTS sinal_proxima_busca_pedidos_idx ON integracao_fdv.sinal (proxima_busca_pedidos_em)
  WHERE proxima_busca_pedidos_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS sinal_proximo_retorno_idx ON integracao_fdv.sinal (proximo_retorno_em)
  WHERE proximo_retorno_em IS NOT NULL;

-- Reconciliação diária (seção 6): contagem de ativos do espelho por entidade; soma nula na v1.
CREATE TABLE IF NOT EXISTS integracao_fdv.reconciliacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  entidade integracao_fdv.entidade_hub NOT NULL,
  data_referencia date NOT NULL,
  contagem integer NOT NULL CHECK (contagem >= 0),
  soma bigint,
  resposta_http integer CHECK (resposta_http BETWEEN 100 AND 599),
  enviado_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT reconciliacao_uq UNIQUE (tenant_id, entidade, data_referencia)
);
SELECT controle.preparar_tabela('integracao_fdv.reconciliacao');

-- Privilégios (seção 8). Sem DELETE para ninguém (exclusão = deleted_at; retenção por anulação de coluna).
-- Credencial: o app grava, lê só o resumo (nunca o cifrado) e marca a substituição; o worker lê o cifrado, marca o uso
-- e anula a chave da substituída (a trigger só deixa anular); a leitura não vê a tabela.
GRANT INSERT ON integracao_fdv.credencial TO macuxierp_app;
GRANT SELECT (id, tenant_id, conector_id, ambiente, chave_prefixo, chave_mestra_versao, substituida_em, criada_por,
  ultimo_uso_em, created_at, updated_at, deleted_at, external_id) ON integracao_fdv.credencial TO macuxierp_app;
GRANT UPDATE (substituida_em, deleted_at) ON integracao_fdv.credencial TO macuxierp_app;
GRANT SELECT ON integracao_fdv.credencial TO macuxierp_worker;
GRANT UPDATE (ultimo_uso_em, chave_cifrada) ON integracao_fdv.credencial TO macuxierp_worker;

-- App: lê tudo (monitor). Ações do BKO (seção 6, C-7): carga completa, retomar e troca de conector mexem no cursor e
-- na confirmação do espelho; o sinal o app só cria. Consumidor de evento, envio e agenda são do worker.
GRANT SELECT ON integracao_fdv.registro_publicado, integracao_fdv.referencia, integracao_fdv.cursor_entidade,
  integracao_fdv.lote_envio, integracao_fdv.lote_erro, integracao_fdv.pedido_recebido, integracao_fdv.retorno_enviado,
  integracao_fdv.sinal, integracao_fdv.reconciliacao TO macuxierp_app;
GRANT INSERT ON integracao_fdv.cursor_entidade, integracao_fdv.sinal TO macuxierp_app;
GRANT UPDATE (credencial_id, cursor_alterado_em, cursor_external_id, sessao_aberta_id, pausada_motivo, pausada_em,
  proximo_em, deleted_at) ON integracao_fdv.cursor_entidade TO macuxierp_app;
GRANT UPDATE (pendente, hash_confirmado, confirmado_em) ON integracao_fdv.registro_publicado TO macuxierp_app;

GRANT SELECT, INSERT, UPDATE ON integracao_fdv.registro_publicado, integracao_fdv.referencia,
  integracao_fdv.cursor_entidade, integracao_fdv.lote_envio, integracao_fdv.lote_erro, integracao_fdv.pedido_recebido,
  integracao_fdv.retorno_enviado, integracao_fdv.sinal, integracao_fdv.reconciliacao TO macuxierp_worker;

-- Leitura: tudo do próprio tenant, menos a credencial.
GRANT SELECT ON integracao_fdv.registro_publicado, integracao_fdv.referencia, integracao_fdv.cursor_entidade,
  integracao_fdv.lote_envio, integracao_fdv.lote_erro, integracao_fdv.pedido_recebido, integracao_fdv.retorno_enviado,
  integracao_fdv.sinal, integracao_fdv.reconciliacao TO macuxierp_leitura;
