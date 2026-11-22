-- 0015 — Espelho do conector com o UUID do ERP, configuração da credencial e conflito de chave (T-0011; decisão
-- do Alexandre de 21/11/2026, 23h22 de Manaus: virada na thathyany e external_id agora). Aditiva e reexecutável;
-- não toca em outro schema. Motivos e uso em docs/banco/README.md (seção da 0015).

-- motivo na seção da 0011 do README
SET LOCAL lock_timeout = '5s';

-- Par registro_external_id (chave do Hub) ↔ UUID do ERP: a tradução de volta dos pedidos (T-0016). UUID opaco, sem FK
-- entre schemas (como fonte_refs e referencia.erp_id). Nulo nas linhas anteriores, até o worker publicar e nas
-- entidades sem UUID único no ERP (forma_pagamento, preco, estoque). Único só entre as linhas ativas e não excluídas:
-- na troca de external_id (RN-CORE-05) a linha antiga, inativa e ainda pendente de confirmação no Hub, convive com a
-- nova do mesmo erp_id. Por isso a consulta erp_id → registro filtra ativo e deleted_at IS NULL.
ALTER TABLE integracao_fdv.registro_publicado ADD COLUMN IF NOT EXISTS erp_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS registro_publicado_erp_id_uq ON integracao_fdv.registro_publicado
  (tenant_id, entidade, erp_id) WHERE deleted_at IS NULL AND ativo;

-- Entidades que o conector envia (padrão: as 12 do domínio entidade_hub, na ordem de carga, para a credencial já
-- gravada seguir como hoje) e o teto de registros por lote (o do Hub é 5000, LIMITE_REGISTROS_LOTE). O array do
-- domínio valida cada elemento (23514 em entidade_hub_check); o CHECK só barra o elemento nulo. Vazia = publicação
-- desligada. A troca de chave cria credencial nova: o app copia as duas colunas no INSERT.
ALTER TABLE integracao_fdv.credencial ADD COLUMN IF NOT EXISTS entidades_habilitadas integracao_fdv.entidade_hub[]
  NOT NULL DEFAULT ARRAY['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade',
    'preco', 'estoque', 'cliente', 'cliente_endereco', 'titulo', 'nota']::integracao_fdv.entidade_hub[]
  CONSTRAINT credencial_entidades_habilitadas CHECK (array_position(entidades_habilitadas, NULL) IS NULL);
ALTER TABLE integracao_fdv.credencial ADD COLUMN IF NOT EXISTS limite_registros_lote integer NOT NULL DEFAULT 5000
  CONSTRAINT credencial_limite_registros_lote CHECK (limite_registros_lote BETWEEN 1 AND 5000);

-- Conflito de chave do Hub (ADR 0010, item 3; docs/desenho/T-0009.md §8): o registro cuja chave mudou sem troca
-- controlada (chave_alterada) ou repete a de outro registro (chave_duplicada) não vai ao Hub; fica aqui até ser
-- resolvido (pelo worker, quando o conflito some, ou pelo BKO). Um aberto por (entidade, erp_id); o resolvido libera
-- o próximo. erp_id é o UUID opaco do ERP, sem FK entre schemas. chave é a chave do Hub (o código/external_id do
-- registro, M2), nunca dado pessoal. external_id da regra 5 fica nulo, como no resto do schema.
CREATE TABLE IF NOT EXISTS integracao_fdv.conflito_chave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  entidade integracao_fdv.entidade_hub NOT NULL,
  erp_id uuid NOT NULL,
  chave text COLLATE "C" NOT NULL CONSTRAINT conflito_chave_chave CHECK (length(chave) BETWEEN 1 AND 200),
  codigo integracao_fdv.codigo NOT NULL
    CONSTRAINT conflito_chave_codigo CHECK (codigo IN ('chave_alterada', 'chave_duplicada')),
  detectado_em timestamptz(3) NOT NULL DEFAULT now(),
  resolvido_em timestamptz(3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT conflito_chave_resolvido CHECK (resolvido_em >= detectado_em),
  -- Só conflito resolvido sai de cena: um aberto com deleted_at ficaria invisível e seguiria travando o unique parcial.
  CONSTRAINT conflito_chave_exclui_resolvido CHECK (deleted_at IS NULL OR resolvido_em IS NOT NULL)
);
SELECT controle.preparar_tabela('integracao_fdv.conflito_chave');
CREATE UNIQUE INDEX IF NOT EXISTS conflito_chave_aberto_uq ON integracao_fdv.conflito_chave
  (tenant_id, entidade, erp_id) WHERE resolvido_em IS NULL;

-- Privilégios (matriz da 0007). registro_publicado.erp_id: o worker grava ao publicar e todos os que leem a tabela
-- leem (privilégios de tabela, já valem para a coluna nova); o app não ganha UPDATE. Credencial: o app (BKO) lê e
-- configura as duas colunas (o INSERT de tabela da 0007 já as cobre); o worker lê (SELECT de tabela) e não altera;
-- a leitura segue sem ver a tabela.
GRANT SELECT (entidades_habilitadas, limite_registros_lote) ON integracao_fdv.credencial TO macuxierp_app;
GRANT UPDATE (entidades_habilitadas, limite_registros_lote) ON integracao_fdv.credencial TO macuxierp_app;
-- conflito_chave: o worker detecta (INSERT), resolve e aplica a retenção de 12 meses (deleted_at); o app (BKO) lê e
-- resolve; a leitura lê. Sem DELETE para ninguém e sem worker_global (o worker trabalha no tenant da sessão).
GRANT SELECT, INSERT ON integracao_fdv.conflito_chave TO macuxierp_worker;
GRANT UPDATE (resolvido_em, deleted_at) ON integracao_fdv.conflito_chave TO macuxierp_worker;
GRANT SELECT ON integracao_fdv.conflito_chave TO macuxierp_app, macuxierp_leitura;
GRANT UPDATE (resolvido_em) ON integracao_fdv.conflito_chave TO macuxierp_app;
