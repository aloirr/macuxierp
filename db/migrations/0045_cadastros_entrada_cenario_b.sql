-- 0045 — Entrada de dados do cenário B (T-0057, v0.3.11; ADR 0014 §3, §4, §8 e a emenda §12–15). A ADR cita a 0044,
-- que saiu na v0.3.7 para a carga sem dependência; a 0045 ficou reservada a esta (quadro, 24/11).
-- Aditiva e reexecutável: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, REVOKE, GRANT e COMMENT.
-- Não muda nenhuma linha existente e não depende das 0046–0049 (que entraram antes no main).
--
-- O que entra (schema cadastros; toda tabela com as colunas da regra 5, RLS isolamento_tenant e nenhum DELETE):
-- - entrada_credencial: as duas bases por empresa (tipo conector|api), conector_id único na plataforma, só o
--   HMAC-SHA256(pepper, chave) calculado na API (o banco nunca vê a chave nem o pepper), o prefixo de exibição e as
--   datas; no máximo uma ativa por empresa e tipo;
-- - entrada_lote: o envelope recebido (corpo zerado no estado final ou em 24 h), a idempotência (idempotency_key por
--   credencial + hash_corpo), a sessão de carga completa (parte e última), os contadores e a trava de 30%
--   (aguardando_confirmacao; o CHECK entrada_lote_trava recusa inativar acima do limite sem a confirmação);
-- - entrada_lote_erro: erros por linha (indice, registro_external_id, campo, codigo), sem o dado nem a mensagem;
-- - entrada_cursor e entrada_sinal: por conector_id (trocar a chave não zera; trocar o conector_id, sim);
-- - entrada_dono (§14): o dono de cada um dos 10 cadastros da F2 (sem linha = erp); o par cliente/cliente_endereco e
--   produto/produto_unidade anda junto;
-- - entrada_descida (§13): a fila do que desce ao banco do cliente (pedido, cliente e nota), com o payload só até o
--   retorno aceito;
-- - §15 (faturamento ligado ou desligado): sem coluna; é a licença do módulo faturamento (RN-CORE-02). O
--   portal_entrada_ler devolve faturamento_licenciado.
--
-- Funções (SECURITY DEFINER e search_path fixo, salvo a entrada_sessao_completa, que roda com a RLS de quem chama):
-- - cadastros.entrada_autenticar(text): EXECUTE só do macuxierp_app, sem tenant na sessão; devolve só tenant_id,
--   credencial_id, tipo e chave_hmac da credencial ativa (a API compara com timingSafeEqual);
-- - portal (lista fechada da ADR 0012, molde da §2 da ADR 0013; EXECUTE só do macuxierp_config; exigir_superadmin,
--   empresa visível e auditar_superadmin): portal_entrada_ler, portal_entrada_credencial_definir,
--   portal_entrada_confirmar_inativacao e portal_entrada_dono_definir;
-- - worker: entrada_sessao_completa (o gatilho a usa) e entrada_lote_expirar (LGPD: corpo em 24 h; confirmação em 7
--   dias; vistos em 8 dias).
-- Auditoria com os nomes canônicos cadastros.entrada.credencial.criar|trocar, cadastros.entrada.inativacao.confirmar e
-- cadastros.entrada.dono.alterar; nunca a chave, o HMAC nem o prefixo.
--
-- SQLSTATE próprios (a API traduz): MXE01 credencial_mudou (409), MXE02 conector_id_em_uso (409), MXE03
-- sessao_incompleta (erro do worker: a sessão não fechou), MXE04 sem_confirmacao_pendente | confirmacao_expirada (409),
-- MXE05 entidade_dependente (422). Escrita do portal com a empresa fora de ativo ou sem o cadastros licenciado = MXC04
-- (DETAIL empresa_inativa | modulo_desligado), como na 0040; empresa não visível = P0002.
--
-- Premissas (banco-dados, T-0057):
-- - o vocabulário é o do Hub (os 10 de ENTIDADES_ENVIO_FDV), não os 8 cadastros da carga do portal (0044);
-- - a inativação dos ausentes e o cálculo da trava são do domain do cadastros (como o Substituir tudo da 0040); o banco
--   guarda as contagens e recusa o que viola a regra (sessão incompleta, acima do limite sem confirmação);
-- - "vistos" (external_ids recebidos na sessão, válidos ou não) fica no lote até a sessão fechar, porque o corpo é
--   zerado ao fim de cada parte e a inativação do último precisa dele (o registro inválido nunca é inativado);
-- - "erros abertos" = os erros do último lote final da entidade e da base;
-- - o limite de tentativas por conector_id e IP é em memória na API (ADR 0012 §6); o IP não vai para o banco, salvo o
--   prefixo truncado do último sinal (§8).

CREATE OR REPLACE FUNCTION cadastros.entrada_entidades() RETURNS text[]
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT ARRAY['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco',
                     'estoque', 'cliente', 'cliente_endereco']::text[] $$;
COMMENT ON FUNCTION cadastros.entrada_entidades() IS
  'Interna (0045): os 10 cadastros da F2 do Hub na ordem (espelho de ENTIDADES_ENVIO_FDV do SDK); os CHECKs da entrada a usam (por isso EXECUTE do app e do worker, que gravam) e o teste da 0045 trava a lista. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.entrada_dono_principal(p_entidade text) RETURNS text
  LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT CASE WHEN p_entidade = 'cliente_endereco' THEN 'cliente'
              WHEN p_entidade = 'produto_unidade' THEN 'produto'
              WHEN p_entidade = ANY (cadastros.entrada_entidades()) THEN p_entidade END
$$;
COMMENT ON FUNCTION cadastros.entrada_dono_principal(text) IS
  'Interna (0045): a entidade que manda no dono (ADR 0014 §14: cliente_endereco segue cliente; produto_unidade segue produto; as outras, elas mesmas); NULL fora da lista. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cadastros.entrada_credencial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('conector', 'api')),
  conector_id text NOT NULL CHECK (conector_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  chave_hmac bytea NOT NULL CHECK (octet_length(chave_hmac) = 32),
  chave_prefixo text NOT NULL CHECK (chave_prefixo ~ '^[A-Za-z0-9_-]{8}$'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  substituida_em timestamptz,
  ultimo_uso_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_credencial_substituida CHECK (substituida_em IS NULL OR substituida_em >= criada_em)
);
SELECT controle.preparar_tabela('cadastros.entrada_credencial');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_credencial_ativa_uq ON cadastros.entrada_credencial (tenant_id, tipo)
  WHERE substituida_em IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entrada_credencial_conector_uq ON cadastros.entrada_credencial (conector_id)
  WHERE substituida_em IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS entrada_credencial_conector_ix ON cadastros.entrada_credencial (conector_id, tenant_id);
COMMENT ON TABLE cadastros.entrada_credencial IS
  'Credenciais da entrada /entrada/v1 (0045, ADR 0014 §4): via Conector e via API; no máximo uma ativa por empresa e tipo; conector_id único na plataforma. Só o HMAC-SHA256(pepper, chave) (32 bytes), nunca a chave. Só as funções portal_entrada_* gravam; o app só atualiza ultimo_uso_em. T-0057.';

CREATE TABLE IF NOT EXISTS cadastros.entrada_lote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  credencial_id uuid NOT NULL,
  entidade text NOT NULL CHECK (entidade = ANY (cadastros.entrada_entidades())),
  modo text NOT NULL CHECK (modo IN ('completo', 'delta')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[!-~]{8,128}$'),
  hash_corpo plataforma.sha256_hex NOT NULL,
  corpo jsonb CHECK (jsonb_typeof(corpo) = 'object'),
  registros integer NOT NULL CHECK (registros BETWEEN 0 AND 5000),
  vistos text[],
  sessao_id uuid,
  sessao_parte integer CHECK (sessao_parte >= 1),
  sessao_ultima boolean,
  estado text NOT NULL DEFAULT 'recebido' CHECK (estado IN ('recebido', 'processando', 'concluido',
    'concluido_com_erros', 'falhou', 'aguardando_confirmacao')),
  contagens jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(contagens) = 'object'),
  limite_inativacao_pct smallint NOT NULL DEFAULT 30 CHECK (limite_inativacao_pct BETWEEN 1 AND 100),
  ativos_antes integer CHECK (ativos_antes >= 0),
  inativacao_prevista integer CHECK (inativacao_prevista >= 0),
  inativados integer CHECK (inativados >= 0),
  aguardando_desde timestamptz,
  confirmada_em timestamptz,
  confirmada_por uuid REFERENCES plataforma.superadmin (id),
  erro_codigo text CHECK (erro_codigo ~ '^[a-z][a-z0-9_]{0,59}$'),
  recebido_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_lote_credencial_fk FOREIGN KEY (tenant_id, credencial_id)
    REFERENCES cadastros.entrada_credencial (tenant_id, id),
  CONSTRAINT entrada_lote_sessao CHECK (
    (modo = 'completo' AND sessao_id IS NOT NULL AND sessao_parte IS NOT NULL AND sessao_ultima IS NOT NULL)
    OR (modo = 'delta' AND sessao_id IS NULL AND sessao_parte IS NULL AND sessao_ultima IS NULL)),
  CONSTRAINT entrada_lote_vistos CHECK (vistos IS NULL OR modo = 'completo'),
  CONSTRAINT entrada_lote_corpo_final CHECK (estado NOT IN ('concluido', 'concluido_com_erros', 'falhou') OR corpo IS NULL),
  CONSTRAINT entrada_lote_final CHECK ((estado IN ('concluido', 'concluido_com_erros', 'falhou')) = (concluido_em IS NOT NULL)),
  CONSTRAINT entrada_lote_aguardando CHECK (estado <> 'aguardando_confirmacao' OR (sessao_ultima IS TRUE
    AND ativos_antes IS NOT NULL AND inativacao_prevista IS NOT NULL AND aguardando_desde IS NOT NULL)),
  CONSTRAINT entrada_lote_confirmada CHECK (confirmada_em IS NULL OR (confirmada_por IS NOT NULL AND aguardando_desde IS NOT NULL)),
  CONSTRAINT entrada_lote_inativados CHECK (inativados IS NULL OR sessao_ultima IS TRUE),
  CONSTRAINT entrada_lote_trava CHECK (inativados IS NULL OR inativados = 0 OR (ativos_antes IS NOT NULL
    AND (inativados::bigint * 100 <= limite_inativacao_pct::bigint * ativos_antes OR confirmada_em IS NOT NULL)))
);
SELECT controle.preparar_tabela('cadastros.entrada_lote');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_lote_idempotencia_uq ON cadastros.entrada_lote
  (tenant_id, credencial_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS entrada_lote_sessao_parte_uq ON cadastros.entrada_lote
  (tenant_id, credencial_id, sessao_id, sessao_parte) WHERE sessao_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entrada_lote_sessao_ultima_uq ON cadastros.entrada_lote
  (tenant_id, credencial_id, sessao_id) WHERE sessao_ultima;
CREATE INDEX IF NOT EXISTS entrada_lote_fila_ix ON cadastros.entrada_lote (tenant_id, credencial_id, entidade, recebido_em)
  WHERE estado IN ('recebido', 'processando');
CREATE INDEX IF NOT EXISTS entrada_lote_ultimo_ix ON cadastros.entrada_lote
  (tenant_id, credencial_id, entidade, recebido_em DESC);
CREATE INDEX IF NOT EXISTS entrada_lote_corpo_ix ON cadastros.entrada_lote (recebido_em) WHERE corpo IS NOT NULL;
CREATE INDEX IF NOT EXISTS entrada_lote_vistos_ix ON cadastros.entrada_lote (recebido_em) WHERE vistos IS NOT NULL;
CREATE INDEX IF NOT EXISTS entrada_lote_aguardando_ix ON cadastros.entrada_lote (aguardando_desde)
  WHERE estado = 'aguardando_confirmacao';
COMMENT ON TABLE cadastros.entrada_lote IS
  'Lotes recebidos pela /entrada/v1 (0045, ADR 0014 §3): idempotência por (credencial, idempotency_key) com hash_corpo; corpo só até o estado final ou 24 h (LGPD); sessão de carga completa com parte e última; inativação só no último da sessão completa (MXE03) e, acima de limite_inativacao_pct, só com a confirmação do superadmin (CHECK entrada_lote_trava). T-0057.';
COMMENT ON COLUMN cadastros.entrada_lote.vistos IS
  'external_ids recebidos neste lote (válidos ou não) da carga completa: a inativação do último lote usa a união da sessão. Zerado ao fechar a sessão ou em 8 dias (entrada_lote_expirar).';
COMMENT ON COLUMN cadastros.entrada_lote.contagens IS
  'Contadores do LoteResultado (nomes do módulo cadastros), sem dado de registro.';

CREATE TABLE IF NOT EXISTS cadastros.entrada_lote_erro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  lote_id uuid NOT NULL,
  indice integer CHECK (indice BETWEEN 0 AND 4999),
  registro_external_id text NOT NULL CHECK (length(registro_external_id) BETWEEN 1 AND 200),
  campo text CHECK (campo ~ '^[A-Za-z0-9_.\[\]]{1,80}$'),
  codigo text NOT NULL CHECK (codigo ~ '^[a-z][a-z0-9_]{0,59}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_lote_erro_lote_fk FOREIGN KEY (tenant_id, lote_id) REFERENCES cadastros.entrada_lote (tenant_id, id)
);
SELECT controle.preparar_tabela('cadastros.entrada_lote_erro');
SELECT controle.somente_insercao('cadastros.entrada_lote_erro');
CREATE UNIQUE INDEX IF NOT EXISTS entrada_lote_erro_uq ON cadastros.entrada_lote_erro
  (tenant_id, lote_id, coalesce(indice, -1), registro_external_id, coalesce(campo, ''), codigo);
COMMENT ON TABLE cadastros.entrada_lote_erro IS
  'Erros por linha do lote da entrada (0045): indice (nulo = linha inválida declarada pelo Conector), registro_external_id, campo e codigo; sem o dado nem a mensagem. Só inserção. T-0057.';

CREATE TABLE IF NOT EXISTS cadastros.entrada_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  conector_id text NOT NULL CHECK (conector_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  entidade text NOT NULL CHECK (entidade = ANY (cadastros.entrada_entidades())),
  cursor_alterado_em timestamptz(3) NOT NULL,
  cursor_external_id text NOT NULL CHECK (length(cursor_external_id) BETWEEN 1 AND 200),
  lote_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_cursor_lote_fk FOREIGN KEY (tenant_id, lote_id) REFERENCES cadastros.entrada_lote (tenant_id, id),
  CONSTRAINT entrada_cursor_uq UNIQUE (tenant_id, conector_id, entidade)
);
SELECT controle.preparar_tabela('cadastros.entrada_cursor');
COMMENT ON TABLE cadastros.entrada_cursor IS
  'CursorEntidade da entrada (0045): alterado_em e external_id do último registro aplicado, por conector_id e entidade (trocar a chave não zera; trocar o conector_id, sim). Só o worker grava. T-0057.';

CREATE TABLE IF NOT EXISTS cadastros.entrada_sinal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  conector_id text NOT NULL CHECK (conector_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  credencial_id uuid NOT NULL,
  ultimo_sinal_em timestamptz NOT NULL DEFAULT now(),
  versao text CHECK (versao ~ '^[0-9A-Za-z.+-]{1,50}$'),
  ip_prefixo cidr CHECK ((family(ip_prefixo) = 4 AND masklen(ip_prefixo) <= 24)
    OR (family(ip_prefixo) = 6 AND masklen(ip_prefixo) <= 48)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_sinal_credencial_fk FOREIGN KEY (tenant_id, credencial_id)
    REFERENCES cadastros.entrada_credencial (tenant_id, id),
  CONSTRAINT entrada_sinal_uq UNIQUE (tenant_id, conector_id)
);
SELECT controle.preparar_tabela('cadastros.entrada_sinal');
COMMENT ON TABLE cadastros.entrada_sinal IS
  'Último sinal do Conector (0045, POST /entrada/v1/sinal): quando, a versão e o IP de origem truncado (/24 no IPv4, /48 no IPv6), por conector_id. T-0057.';

CREATE TABLE IF NOT EXISTS cadastros.entrada_dono (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  entidade text NOT NULL CHECK (entidade = ANY (cadastros.entrada_entidades())),
  dono text NOT NULL DEFAULT 'erp' CHECK (dono IN ('cliente', 'erp')),
  carga_completa_pedida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_dono_carga CHECK (carga_completa_pedida_em IS NULL OR dono = 'cliente'),
  CONSTRAINT entrada_dono_uq UNIQUE (tenant_id, entidade)
);
SELECT controle.preparar_tabela('cadastros.entrada_dono');
COMMENT ON TABLE cadastros.entrada_dono IS
  'Dono de cada cadastro da F2 na empresa (0045, ADR 0014 §14): cliente (o banco do cliente, pela /entrada/v1) ou erp (o BKO e a carga de CSV); sem linha = erp. Só o portal_entrada_dono_definir grava, com o par junto; carga_completa_pedida_em marca a troca de erp para cliente até a carga completa fechar (o worker anula). T-0057.';

CREATE TABLE IF NOT EXISTS cadastros.entrada_descida (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  tipo text NOT NULL CHECK (tipo IN ('pedido', 'cliente', 'nota')),
  referencia text NOT NULL,
  payload jsonb CHECK (jsonb_typeof(payload) = 'object'),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'entregue', 'confirmado', 'erro')),
  entregas integer NOT NULL DEFAULT 0 CHECK (entregas >= 0),
  ultima_entrega_em timestamptz,
  confirmado_em timestamptz,
  retorno_codigo text CHECK (retorno_codigo ~ '^[a-z][a-z0-9_]{0,59}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  CONSTRAINT entrada_descida_referencia CHECK (
    (tipo IN ('pedido', 'cliente') AND referencia ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR (tipo = 'nota' AND referencia ~ '^[0-9]{44}$')),
  CONSTRAINT entrada_descida_confirmado CHECK ((estado = 'confirmado') = (confirmado_em IS NOT NULL)),
  CONSTRAINT entrada_descida_payload CHECK ((estado = 'confirmado') = (payload IS NULL)),
  CONSTRAINT entrada_descida_uq UNIQUE (tenant_id, tipo, referencia)
);
SELECT controle.preparar_tabela('cadastros.entrada_descida');
CREATE INDEX IF NOT EXISTS entrada_descida_fila_ix ON cadastros.entrada_descida (tenant_id, tipo, created_at)
  WHERE estado <> 'confirmado';
COMMENT ON TABLE cadastros.entrada_descida IS
  'Fila do que desce ao banco do cliente pelo Conector (0045, ADR 0014 §13): pedido (PedidoParaErp, por pedido_uuid), cliente (pré-cadastro, ClienteParaErp, por cliente_uuid) e nota (NotaParaCliente, pela chave de 44 dígitos, sem XML). Enfileirar = ON CONFLICT DO NOTHING; o payload fica só até o retorno aceito (confirmado). T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------------------------------------------

-- As partes 1..p-1 da sessão existem e terminaram aplicadas (concluido|concluido_com_erros). SECURITY INVOKER: roda
-- com a RLS de quem chama (o worker, com app.tenant_id).
CREATE OR REPLACE FUNCTION cadastros.entrada_sessao_completa(p_credencial_id uuid, p_sessao_id uuid, p_parte integer)
  RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT coalesce(p_parte >= 1, false) AND (
    SELECT count(DISTINCT x.sessao_parte) FROM cadastros.entrada_lote x
     WHERE x.credencial_id = p_credencial_id AND x.sessao_id = p_sessao_id AND x.sessao_parte < p_parte
       AND x.estado IN ('concluido', 'concluido_com_erros') AND x.deleted_at IS NULL) = p_parte - 1
$$;
COMMENT ON FUNCTION cadastros.entrada_sessao_completa(uuid, uuid, integer) IS
  'Worker (0045): a sessão de carga completa está completa até a parte p (as partes 1..p-1 existem e estão concluido ou concluido_com_erros). SECURITY INVOKER (RLS de quem chama). O gatilho entrada_lote_antes a usa antes de inativar ou travar (MXE03). EXECUTE do macuxierp_worker. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.entrada_lote_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'recebido' OR NEW.inativados IS NOT NULL OR NEW.aguardando_desde IS NOT NULL
       OR NEW.confirmada_em IS NOT NULL OR NEW.concluido_em IS NOT NULL THEN
      RAISE EXCEPTION 'o lote nasce recebido, sem inativação nem confirmação' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.sessao_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM cadastros.entrada_lote x
                  WHERE x.tenant_id = NEW.tenant_id AND x.sessao_id = NEW.sessao_id
                    AND (x.credencial_id <> NEW.credencial_id OR x.entidade <> NEW.entidade)) THEN
        RAISE EXCEPTION 'sessão de carga completa de outra entidade ou credencial' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM cadastros.entrada_lote x
                  WHERE x.tenant_id = NEW.tenant_id AND x.credencial_id = NEW.credencial_id AND x.sessao_id = NEW.sessao_id
                    AND ((x.sessao_ultima AND x.sessao_parte < NEW.sessao_parte)
                      OR (NEW.sessao_ultima AND x.sessao_parte > NEW.sessao_parte))) THEN
        RAISE EXCEPTION 'parte depois da última da sessão' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.tenant_id, NEW.credencial_id, NEW.entidade, NEW.modo, NEW.idempotency_key, NEW.hash_corpo, NEW.registros,
      NEW.sessao_id, NEW.sessao_parte, NEW.sessao_ultima, NEW.limite_inativacao_pct, NEW.recebido_em)
     IS DISTINCT FROM (OLD.tenant_id, OLD.credencial_id, OLD.entidade, OLD.modo, OLD.idempotency_key, OLD.hash_corpo,
      OLD.registros, OLD.sessao_id, OLD.sessao_parte, OLD.sessao_ultima, OLD.limite_inativacao_pct, OLD.recebido_em) THEN
    RAISE EXCEPTION 'coluna imutável do lote da entrada' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.corpo IS NOT NULL AND NEW.corpo IS DISTINCT FROM OLD.corpo THEN
    RAISE EXCEPTION 'o corpo do lote só é zerado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.vistos IS NOT NULL AND NEW.vistos IS NOT NULL AND NEW.vistos IS DISTINCT FROM OLD.vistos THEN
    RAISE EXCEPTION 'os vistos do lote só são gravados uma vez e zerados' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.estado IN ('concluido', 'concluido_com_erros', 'falhou') AND NEW.estado <> OLD.estado THEN
    RAISE EXCEPTION 'lote em estado final não muda de estado' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.confirmada_em IS DISTINCT FROM OLD.confirmada_em
     AND (OLD.confirmada_em IS NOT NULL OR OLD.estado <> 'aguardando_confirmacao') THEN
    RAISE EXCEPTION 'a confirmação só sai de aguardando_confirmacao' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'aguardando_confirmacao' AND NEW.estado NOT IN ('aguardando_confirmacao', 'concluido_com_erros', 'falhou')
     AND NEW.confirmada_em IS NULL THEN
    RAISE EXCEPTION 'o lote sai de aguardando_confirmacao só com a confirmação' USING ERRCODE = 'check_violation';
  END IF;
  -- a sessão incompleta não inativa nem trava: as partes anteriores têm de estar aplicadas
  IF ((NEW.inativados IS NOT NULL AND OLD.inativados IS NULL)
      OR (NEW.estado = 'aguardando_confirmacao' AND OLD.estado <> 'aguardando_confirmacao'))
     AND NEW.sessao_ultima IS TRUE
     AND NOT cadastros.entrada_sessao_completa(NEW.credencial_id, NEW.sessao_id, NEW.sessao_parte) THEN
    RAISE EXCEPTION 'sessão de carga completa incompleta' USING ERRCODE = 'MXE03', DETAIL = 'sessao_incompleta';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION cadastros.entrada_lote_antes() IS
  'Gatilho (0045) de cadastros.entrada_lote. INSERT: nasce recebido; a sessão tem uma entidade e uma credencial e nenhuma parte depois da última (check_violation). UPDATE: identidade imutável e corpo só anula (42501); estado final não muda; confirmação só de aguardando_confirmacao, e só com ela sai para processando ou concluido; inativar ou travar só com a sessão completa (MXE03, DETAIL sessao_incompleta). T-0057.';
DROP TRIGGER IF EXISTS entrada_lote_antes ON cadastros.entrada_lote;
CREATE TRIGGER entrada_lote_antes BEFORE INSERT OR UPDATE ON cadastros.entrada_lote
  FOR EACH ROW EXECUTE FUNCTION cadastros.entrada_lote_antes();

CREATE OR REPLACE FUNCTION cadastros.entrada_descida_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF (NEW.tenant_id, NEW.tipo, NEW.referencia) IS DISTINCT FROM (OLD.tenant_id, OLD.tipo, OLD.referencia) THEN
    RAISE EXCEPTION 'coluna imutável da fila de descida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.payload IS NOT NULL AND NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'o payload da descida só é zerado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.estado = 'confirmado' AND NEW.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'descida confirmada não muda de estado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION cadastros.entrada_descida_antes() IS
  'Gatilho (0045) de cadastros.entrada_descida: tenant, tipo e referência imutáveis e payload só anula (42501); confirmado é final (check_violation). T-0057.';
DROP TRIGGER IF EXISTS entrada_descida_antes ON cadastros.entrada_descida;
CREATE TRIGGER entrada_descida_antes BEFORE UPDATE ON cadastros.entrada_descida
  FOR EACH ROW EXECUTE FUNCTION cadastros.entrada_descida_antes();

-- ---------------------------------------------------------------------------------------------------------------
-- Autenticação da máquina (EXECUTE só do macuxierp_app, sem tenant na sessão)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cadastros.entrada_autenticar(p_conector_id text)
  RETURNS TABLE (tenant_id uuid, credencial_id uuid, tipo text, chave_hmac bytea)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT c.tenant_id, c.id, c.tipo, c.chave_hmac
    FROM cadastros.entrada_credencial c
    JOIN plataforma.tenant t ON t.id = c.tenant_id
   WHERE p_conector_id ~ '^[A-Za-z0-9._-]{1,100}$' AND c.conector_id = p_conector_id
     AND c.substituida_em IS NULL AND c.deleted_at IS NULL AND plataforma.empresa_visivel(t)
$$;
COMMENT ON FUNCTION cadastros.entrada_autenticar(text) IS
  'Entrada /entrada/v1 (0045, ADR 0014 §4): sem app.tenant_id, devolve 0 ou 1 linha (tenant_id, credencial_id, tipo, chave_hmac) da credencial ativa do conector_id, de empresa visível; formato inválido ou nulo = 0 linha, sem erro. A API compara o HMAC com timingSafeEqual e só então abre a transação do tenant; situação e licença ela confere depois (403 RN-CORE-02). Só macuxierp_app. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Internas do portal (sem EXECUTE para ninguém)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cadastros.entrada_portal_empresa(p_tenant uuid, p_escrita boolean) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  t plataforma.tenant;
BEGIN
  SELECT * INTO t FROM plataforma.tenant x WHERE x.id = p_tenant AND plataforma.empresa_visivel(x) FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_escrita AND t.situacao <> 'ativo' THEN
    RAISE EXCEPTION 'empresa fora de ativo' USING ERRCODE = 'MXC04', DETAIL = 'empresa_inativa';
  END IF;
  IF p_escrita AND NOT plataforma.modulo_licenciado(t.id, 'cadastros') THEN
    RAISE EXCEPTION 'módulo cadastros desligado na empresa' USING ERRCODE = 'MXC04', DETAIL = 'modulo_desligado';
  END IF;
  RETURN t.id;
END $$;
COMMENT ON FUNCTION cadastros.entrada_portal_empresa(uuid, boolean) IS
  'Interna (0045): a empresa alvo do portal com FOR KEY SHARE (visível; senão P0002); para escrita, ativa e com o cadastros licenciado (senão MXC04, DETAIL empresa_inativa | modulo_desligado, como na 0040). T-0057.';

CREATE OR REPLACE FUNCTION cadastros.entrada_portal_estado(p_tenant uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  WITH bases AS (
    SELECT b.tipo, b.o, c.id AS credencial_id, c.conector_id, c.chave_prefixo, c.criada_em, c.ultimo_uso_em
      FROM unnest(ARRAY['conector', 'api']) WITH ORDINALITY AS b(tipo, o)
      LEFT JOIN cadastros.entrada_credencial c
        ON c.tenant_id = p_tenant AND c.tipo = b.tipo AND c.substituida_em IS NULL AND c.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'empresa_id', p_tenant,
    'modulo_licenciado', plataforma.modulo_licenciado(p_tenant, 'cadastros'),
    'faturamento_licenciado', plataforma.modulo_licenciado(p_tenant, 'faturamento'),
    'bases', (
      SELECT jsonb_agg(jsonb_build_object(
        'tipo', b.tipo,
        'credencial', CASE WHEN b.credencial_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', b.credencial_id, 'conector_id', b.conector_id, 'chave_prefixo', b.chave_prefixo,
          'criada_em', plataforma.instante_iso(b.criada_em), 'ultimo_uso_em', plataforma.instante_iso(b.ultimo_uso_em)) END,
        'sinal', (SELECT jsonb_build_object('ultimo_sinal_em', plataforma.instante_iso(s.ultimo_sinal_em), 'versao', s.versao)
                    FROM cadastros.entrada_sinal s
                   WHERE s.tenant_id = p_tenant AND s.conector_id = b.conector_id AND s.deleted_at IS NULL))
        ORDER BY b.o) FROM bases b),
    'entidades', (
      SELECT jsonb_agg(jsonb_build_object(
        'entidade', f.e,
        'dono', coalesce(d.dono, 'erp'),
        'carga_completa_pedida_em', plataforma.instante_iso(d.carga_completa_pedida_em),
        'bases', (
          SELECT jsonb_agg(jsonb_build_object(
            'tipo', b.tipo,
            'cursor_alterado_em', (
              SELECT plataforma.instante_iso(k.cursor_alterado_em) FROM cadastros.entrada_cursor k
               WHERE k.tenant_id = p_tenant AND k.conector_id = b.conector_id AND k.entidade = f.e AND k.deleted_at IS NULL),
            'ultimo_lote', (
              SELECT jsonb_build_object('id', l.id, 'estado', l.estado, 'erro_codigo', l.erro_codigo,
                'recebido_em', plataforma.instante_iso(l.recebido_em), 'concluido_em', plataforma.instante_iso(l.concluido_em),
                'contagens', l.contagens, 'inativados', l.inativados)
                FROM cadastros.entrada_lote l JOIN cadastros.entrada_credencial c ON c.tenant_id = l.tenant_id AND c.id = l.credencial_id
               WHERE l.tenant_id = p_tenant AND c.tipo = b.tipo AND l.entidade = f.e AND l.deleted_at IS NULL
               ORDER BY l.recebido_em DESC, l.id DESC LIMIT 1),
            'erros_abertos', coalesce((
              SELECT count(*)::integer FROM cadastros.entrada_lote_erro x
               WHERE x.tenant_id = p_tenant AND x.deleted_at IS NULL AND x.lote_id = (
                 SELECT l.id FROM cadastros.entrada_lote l
                   JOIN cadastros.entrada_credencial c ON c.tenant_id = l.tenant_id AND c.id = l.credencial_id
                  WHERE l.tenant_id = p_tenant AND c.tipo = b.tipo AND l.entidade = f.e AND l.deleted_at IS NULL
                    AND l.estado IN ('concluido', 'concluido_com_erros', 'falhou')
                  ORDER BY l.concluido_em DESC, l.id DESC LIMIT 1)), 0),
            'confirmacao_pendente', (
              SELECT jsonb_build_object('lote_id', l.id, 'ativos_antes', l.ativos_antes,
                'inativacao_prevista', l.inativacao_prevista,
                'expira_em', plataforma.instante_iso(l.aguardando_desde + interval '7 days'))
                FROM cadastros.entrada_lote l JOIN cadastros.entrada_credencial c ON c.tenant_id = l.tenant_id AND c.id = l.credencial_id
               WHERE l.tenant_id = p_tenant AND c.tipo = b.tipo AND l.entidade = f.e AND l.deleted_at IS NULL
                 AND l.estado = 'aguardando_confirmacao' AND l.aguardando_desde > now() - interval '7 days'
               ORDER BY l.aguardando_desde DESC, l.id DESC LIMIT 1))
            ORDER BY b.o) FROM bases b))
        ORDER BY f.o)
      FROM unnest(cadastros.entrada_entidades()) WITH ORDINALITY AS f(e, o)
      LEFT JOIN cadastros.entrada_dono d ON d.tenant_id = p_tenant AND d.entidade = f.e AND d.deleted_at IS NULL))
$$;
COMMENT ON FUNCTION cadastros.entrada_portal_estado(uuid) IS
  'Interna (0045): o jsonb do portal_entrada_ler (empresa_id, modulo_licenciado, faturamento_licenciado, bases [conector, api] com a credencial ativa sem o HMAC e o último sinal sem o IP, e os 10 cadastros com dono, carga_completa_pedida_em e, por base, cursor_alterado_em, ultimo_lote, erros_abertos e confirmacao_pendente). Nunca chave_hmac, corpo, vistos, external_id de registro nem IP. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Portal /config (EXECUTE só do macuxierp_config)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cadastros.portal_entrada_ler(p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := cadastros.entrada_portal_empresa(p_tenant, false);
BEGIN
  RETURN cadastros.entrada_portal_estado(v_t);
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_ler(uuid) IS
  'Portal /config (0045, ADR 0014 §4 e §5): a entrada da empresa visível (entrada_portal_estado), sem trava nem auditoria; sem o HMAC, o corpo nem dado de negócio. MXS01 sem sessão; P0002 empresa não visível. Só macuxierp_config. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.portal_entrada_credencial_definir(p_tenant uuid, p_tipo text, p_anterior_id uuid,
  p_conector_id text, p_chave_hmac bytea, p_chave_prefixo text, p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := cadastros.entrada_portal_empresa(p_tenant, true);
  v_ant cadastros.entrada_credencial;
  v_nova cadastros.entrada_credencial;
  v_restricao text;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('conector', 'api') THEN
    RAISE EXCEPTION 'tipo da credencial fora de conector|api' USING ERRCODE = 'check_violation';
  END IF;
  IF p_conector_id IS NULL OR p_conector_id !~ '^[A-Za-z0-9._-]{1,100}$' THEN
    RAISE EXCEPTION 'conector_id fora do formato [A-Za-z0-9._-]{1,100}' USING ERRCODE = 'check_violation';
  END IF;
  IF p_chave_hmac IS NULL OR octet_length(p_chave_hmac) <> 32 THEN
    RAISE EXCEPTION 'HMAC da chave fora de 32 bytes' USING ERRCODE = 'check_violation';
  END IF;
  IF p_chave_prefixo IS NULL OR p_chave_prefixo !~ '^[A-Za-z0-9_-]{8}$' THEN
    RAISE EXCEPTION 'prefixo da chave fora de 8 caracteres base64url' USING ERRCODE = 'check_violation';
  END IF;

  -- a ativa da base, travada, tem de ser a que a tela leu (na primeira, as duas são NULL)
  SELECT * INTO v_ant FROM cadastros.entrada_credencial x
   WHERE x.tenant_id = v_t AND x.tipo = p_tipo AND x.substituida_em IS NULL AND x.deleted_at IS NULL FOR UPDATE;
  IF v_ant.id IS DISTINCT FROM p_anterior_id THEN
    RAISE EXCEPTION 'a credencial mudou; recarregue' USING ERRCODE = 'MXE01', DETAIL = 'credencial_mudou';
  END IF;
  -- o conector_id é de uma empresa só (histórico incluso) e de uma base só
  IF EXISTS (SELECT 1 FROM cadastros.entrada_credencial x
              WHERE x.conector_id = p_conector_id
                AND (x.tenant_id <> v_t OR (x.tipo <> p_tipo AND x.substituida_em IS NULL AND x.deleted_at IS NULL))) THEN
    RAISE EXCEPTION 'conector_id em uso' USING ERRCODE = 'MXE02', DETAIL = 'conector_id_em_uso';
  END IF;

  -- a anterior sai na hora (a chave dela deixa de autenticar) antes da nova entrar
  IF v_ant.id IS NOT NULL THEN
    UPDATE cadastros.entrada_credencial SET substituida_em = now() WHERE tenant_id = v_t AND id = v_ant.id;
  END IF;
  BEGIN
    INSERT INTO cadastros.entrada_credencial (tenant_id, tipo, conector_id, chave_hmac, chave_prefixo)
      VALUES (v_t, p_tipo, p_conector_id, p_chave_hmac, p_chave_prefixo) RETURNING * INTO v_nova;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restricao = CONSTRAINT_NAME;
    IF v_restricao = 'entrada_credencial_ativa_uq' THEN
      RAISE EXCEPTION 'a credencial mudou; recarregue' USING ERRCODE = 'MXE01', DETAIL = 'credencial_mudou';
    END IF;
    RAISE EXCEPTION 'conector_id em uso' USING ERRCODE = 'MXE02', DETAIL = 'conector_id_em_uso';
  END;

  PERFORM plataforma.auditar_superadmin(v_t, v_sa,
    CASE WHEN v_ant.id IS NULL THEN 'cadastros.entrada.credencial.criar' ELSE 'cadastros.entrada.credencial.trocar' END,
    'entrada_credencial', v_nova.id,
    CASE WHEN v_ant.id IS NULL THEN NULL
         ELSE jsonb_build_object('credencial_id', v_ant.id, 'tipo', v_ant.tipo, 'conector_id', v_ant.conector_id) END,
    jsonb_build_object('tipo', v_nova.tipo, 'conector_id', v_nova.conector_id), p_request_id);
  RETURN jsonb_build_object('id', v_nova.id, 'tipo', v_nova.tipo, 'conector_id', v_nova.conector_id,
    'chave_prefixo', v_nova.chave_prefixo, 'criada_em', plataforma.instante_iso(v_nova.criada_em));
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_credencial_definir(uuid, text, uuid, text, bytea, text, text) IS
  'Portal /config (0045, ADR 0014 §4): cria ou troca a credencial da base (conector|api) recebendo o HMAC-SHA256 de 32 bytes já calculado pela API (nunca a chave) e o prefixo de 8. Formato inválido = check_violation; ativa diferente de p_anterior_id = MXE01 (credencial_mudou); conector_id de outra empresa ou ativo na outra base = MXE02 (conector_id_em_uso). A anterior deixa de autenticar na hora. Audita cadastros.entrada.credencial.criar|trocar só com tipo e conector_id. Devolve {id, tipo, conector_id, chave_prefixo, criada_em}. Só macuxierp_config. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.portal_entrada_confirmar_inativacao(p_tenant uuid, p_lote_id uuid, p_request_id text)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := cadastros.entrada_portal_empresa(p_tenant, true);
  l cadastros.entrada_lote;
  v_trabalho uuid;
BEGIN
  SELECT * INTO l FROM cadastros.entrada_lote x WHERE x.tenant_id = v_t AND x.id = p_lote_id AND x.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lote não encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  IF l.estado <> 'aguardando_confirmacao' THEN
    RAISE EXCEPTION 'o lote não aguarda confirmação' USING ERRCODE = 'MXE04', DETAIL = 'sem_confirmacao_pendente';
  END IF;
  IF l.aguardando_desde <= now() - interval '7 days' THEN
    RAISE EXCEPTION 'a confirmação expirou (7 dias)' USING ERRCODE = 'MXE04', DETAIL = 'confirmacao_expirada';
  END IF;
  UPDATE cadastros.entrada_lote SET confirmada_em = now(), confirmada_por = v_sa, estado = 'processando'
   WHERE tenant_id = v_t AND id = l.id RETURNING * INTO l;
  INSERT INTO plataforma.trabalho (tenant_id, tipo, payload)
    VALUES (v_t, 'cadastros.entrada_lote', jsonb_build_object('lote_id', l.id, 'etapa', 'inativar'))
    RETURNING id INTO v_trabalho;
  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'cadastros.entrada.inativacao.confirmar', 'entrada_lote', l.id,
    jsonb_build_object('estado', 'aguardando_confirmacao'),
    jsonb_build_object('entidade', l.entidade, 'ativos_antes', l.ativos_antes, 'inativacao_prevista', l.inativacao_prevista),
    p_request_id);
  RETURN jsonb_build_object('lote_id', l.id, 'estado', l.estado, 'confirmada_em', plataforma.instante_iso(l.confirmada_em),
    'trabalho_id', v_trabalho);
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_confirmar_inativacao(uuid, uuid, text) IS
  'Portal /config (0045, ADR 0014 §3, trava de 30%): o superadmin confirma a inativação do lote em aguardando_confirmacao há menos de 7 dias; o lote volta a processando com confirmada_em/por e o trabalho cadastros.entrada_lote {lote_id, etapa: inativar} vai à fila. Lote fora da empresa = P0002; sem confirmação pendente ou expirada = MXE04 (sem_confirmacao_pendente | confirmacao_expirada). Audita cadastros.entrada.inativacao.confirmar. Só macuxierp_config. T-0057.';

CREATE OR REPLACE FUNCTION cadastros.portal_entrada_dono_definir(p_tenant uuid, p_entidade text, p_dono text,
  p_request_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_sa uuid := plataforma.exigir_superadmin();
  v_t uuid := cadastros.entrada_portal_empresa(p_tenant, true);
  v_par text[];
  v_antes text;
  v_pedida timestamptz;
BEGIN
  IF p_entidade IS NULL OR NOT (p_entidade = ANY (cadastros.entrada_entidades())) THEN
    RAISE EXCEPTION 'entidade fora dos cadastros da F2' USING ERRCODE = 'check_violation';
  END IF;
  IF p_dono IS NULL OR p_dono NOT IN ('cliente', 'erp') THEN
    RAISE EXCEPTION 'dono fora de cliente|erp' USING ERRCODE = 'check_violation';
  END IF;
  IF cadastros.entrada_dono_principal(p_entidade) <> p_entidade THEN
    RAISE EXCEPTION 'a entidade segue o dono de %', cadastros.entrada_dono_principal(p_entidade)
      USING ERRCODE = 'MXE05', DETAIL = 'entidade_dependente';
  END IF;
  SELECT array_agg(e ORDER BY o) INTO v_par FROM unnest(cadastros.entrada_entidades()) WITH ORDINALITY AS f(e, o)
   WHERE cadastros.entrada_dono_principal(e) = p_entidade;

  -- trava as linhas que existem; o ON CONFLICT serializa a primeira gravação
  PERFORM 1 FROM cadastros.entrada_dono d WHERE d.tenant_id = v_t AND d.entidade = ANY (v_par) FOR UPDATE;
  SELECT coalesce((SELECT d.dono FROM cadastros.entrada_dono d WHERE d.tenant_id = v_t AND d.entidade = p_entidade
                    AND d.deleted_at IS NULL), 'erp') INTO v_antes;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_par) e
                  LEFT JOIN cadastros.entrada_dono d ON d.tenant_id = v_t AND d.entidade = e AND d.deleted_at IS NULL
                  WHERE coalesce(d.dono, 'erp') <> p_dono) THEN
    SELECT d.carga_completa_pedida_em INTO v_pedida FROM cadastros.entrada_dono d
     WHERE d.tenant_id = v_t AND d.entidade = p_entidade AND d.deleted_at IS NULL;
    RETURN jsonb_build_object('entidade', p_entidade, 'dono', p_dono, 'entidades', to_jsonb(v_par),
      'carga_completa_pedida_em', plataforma.instante_iso(v_pedida));
  END IF;

  v_pedida := CASE WHEN p_dono = 'cliente' THEN now() END;
  INSERT INTO cadastros.entrada_dono (tenant_id, entidade, dono, carga_completa_pedida_em)
  SELECT v_t, e, p_dono, v_pedida FROM unnest(v_par) e
  ON CONFLICT (tenant_id, entidade) DO UPDATE
    SET dono = EXCLUDED.dono, carga_completa_pedida_em = EXCLUDED.carga_completa_pedida_em, deleted_at = NULL;

  PERFORM plataforma.auditar_superadmin(v_t, v_sa, 'cadastros.entrada.dono.alterar', 'entrada_dono',
    (SELECT d.id FROM cadastros.entrada_dono d WHERE d.tenant_id = v_t AND d.entidade = p_entidade),
    jsonb_build_object('entidade', p_entidade, 'dono', v_antes),
    jsonb_build_object('entidade', p_entidade, 'dono', p_dono, 'entidades', to_jsonb(v_par)), p_request_id);
  RETURN jsonb_build_object('entidade', p_entidade, 'dono', p_dono, 'entidades', to_jsonb(v_par),
    'carga_completa_pedida_em', plataforma.instante_iso(v_pedida));
END $$;
COMMENT ON FUNCTION cadastros.portal_entrada_dono_definir(uuid, text, text, text) IS
  'Portal /config (0045, ADR 0014 §14): define o dono (cliente|erp) do cadastro e do dependente junto (cliente + cliente_endereco; produto + produto_unidade). Entidade ou dono fora da lista = check_violation; entidade dependente = MXE05 (entidade_dependente). De erp para cliente marca carga_completa_pedida_em; de cliente para erp, anula; nada é apagado. Sem mudança = sem auditoria; com mudança, audita cadastros.entrada.dono.alterar. Devolve {entidade, dono, entidades, carga_completa_pedida_em}. Só macuxierp_config. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Worker: expiração (LGPD: o corpo não passa de 24 h; a confirmação vale 7 dias; os vistos, 8)
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cadastros.entrada_lote_expirar() RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_conf integer;
  v_falhos integer;
  v_corpos integer;
  v_vistos integer;
BEGIN
  UPDATE cadastros.entrada_lote SET estado = 'concluido_com_erros', erro_codigo = 'confirmacao_expirada',
         concluido_em = now(), corpo = NULL, vistos = NULL
   WHERE estado = 'aguardando_confirmacao' AND aguardando_desde <= now() - interval '7 days';
  GET DIAGNOSTICS v_conf = ROW_COUNT;
  UPDATE cadastros.entrada_lote SET estado = 'falhou', erro_codigo = 'corpo_expirado', concluido_em = now(), corpo = NULL
   WHERE estado IN ('recebido', 'processando') AND recebido_em <= now() - interval '24 hours';
  GET DIAGNOSTICS v_falhos = ROW_COUNT;
  UPDATE cadastros.entrada_lote SET corpo = NULL WHERE corpo IS NOT NULL AND recebido_em <= now() - interval '24 hours';
  GET DIAGNOSTICS v_corpos = ROW_COUNT;
  UPDATE cadastros.entrada_lote SET vistos = NULL WHERE vistos IS NOT NULL AND recebido_em <= now() - interval '8 days';
  GET DIAGNOSTICS v_vistos = ROW_COUNT;
  RETURN jsonb_build_object('confirmacoes_expiradas', v_conf, 'falhos', v_falhos, 'corpos_zerados', v_corpos + v_falhos,
    'vistos_zerados', v_vistos);
END $$;
COMMENT ON FUNCTION cadastros.entrada_lote_expirar() IS
  'Worker (0045, LGPD da ADR 0014 §3), todos os tenants: aguardando_confirmacao há 7 dias ou mais vira concluido_com_erros (confirmacao_expirada); recebido|processando com 24 h ou mais vira falhou (corpo_expirado); todo corpo com 24 h ou mais é zerado; vistos com 8 dias ou mais, zerados. Devolve só as contagens. Só macuxierp_worker. T-0057.';

-- ---------------------------------------------------------------------------------------------------------------
-- Privilégios: nada para PUBLIC; nenhum DELETE; o HMAC, o corpo e os vistos fora do app e da leitura.
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION cadastros.entrada_entidades(), cadastros.entrada_dono_principal(text),
  cadastros.entrada_sessao_completa(uuid, uuid, integer), cadastros.entrada_lote_antes(),
  cadastros.entrada_descida_antes(), cadastros.entrada_autenticar(text), cadastros.entrada_portal_empresa(uuid, boolean),
  cadastros.entrada_portal_estado(uuid), cadastros.portal_entrada_ler(uuid),
  cadastros.portal_entrada_credencial_definir(uuid, text, uuid, text, bytea, text, text),
  cadastros.portal_entrada_confirmar_inativacao(uuid, uuid, text),
  cadastros.portal_entrada_dono_definir(uuid, text, text, text), cadastros.entrada_lote_expirar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cadastros.entrada_autenticar(text) TO macuxierp_app;
-- os CHECKs de entidade rodam com o papel de quem grava (app e worker): a lista é pública para eles, não é segredo
GRANT EXECUTE ON FUNCTION cadastros.entrada_entidades() TO macuxierp_app, macuxierp_worker;
GRANT EXECUTE ON FUNCTION cadastros.entrada_sessao_completa(uuid, uuid, integer), cadastros.entrada_lote_expirar()
  TO macuxierp_worker;
GRANT EXECUTE ON FUNCTION cadastros.portal_entrada_ler(uuid),
  cadastros.portal_entrada_credencial_definir(uuid, text, uuid, text, bytea, text, text),
  cadastros.portal_entrada_confirmar_inativacao(uuid, uuid, text),
  cadastros.portal_entrada_dono_definir(uuid, text, text, text) TO macuxierp_config;

REVOKE ALL ON cadastros.entrada_credencial, cadastros.entrada_lote, cadastros.entrada_lote_erro, cadastros.entrada_cursor,
  cadastros.entrada_sinal, cadastros.entrada_dono, cadastros.entrada_descida
  FROM macuxierp_app, macuxierp_worker, macuxierp_leitura, macuxierp_config;

GRANT SELECT (id, tenant_id, tipo, conector_id, chave_prefixo, criada_em, substituida_em, ultimo_uso_em, created_at,
  updated_at, deleted_at, external_id) ON cadastros.entrada_credencial TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
GRANT UPDATE (ultimo_uso_em) ON cadastros.entrada_credencial TO macuxierp_app;

GRANT SELECT (id, tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros, sessao_id,
  sessao_parte, sessao_ultima, estado, contagens, limite_inativacao_pct, ativos_antes, inativacao_prevista, inativados,
  aguardando_desde, confirmada_em, confirmada_por, erro_codigo, recebido_em, iniciado_em, concluido_em, created_at,
  updated_at, deleted_at, external_id) ON cadastros.entrada_lote TO macuxierp_app, macuxierp_leitura;
GRANT INSERT (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, corpo, registros, sessao_id,
  sessao_parte, sessao_ultima, external_id) ON cadastros.entrada_lote TO macuxierp_app;
GRANT SELECT ON cadastros.entrada_lote TO macuxierp_worker;
GRANT UPDATE (estado, contagens, vistos, corpo, ativos_antes, inativacao_prevista, inativados, aguardando_desde,
  erro_codigo, iniciado_em, concluido_em) ON cadastros.entrada_lote TO macuxierp_worker;

GRANT SELECT ON cadastros.entrada_lote_erro TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
GRANT INSERT ON cadastros.entrada_lote_erro TO macuxierp_worker;

GRANT SELECT ON cadastros.entrada_cursor TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
GRANT INSERT ON cadastros.entrada_cursor TO macuxierp_worker;
GRANT UPDATE (cursor_alterado_em, cursor_external_id, lote_id) ON cadastros.entrada_cursor TO macuxierp_worker;

GRANT SELECT ON cadastros.entrada_sinal TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
GRANT INSERT ON cadastros.entrada_sinal TO macuxierp_app;
GRANT UPDATE (credencial_id, ultimo_sinal_em, versao, ip_prefixo) ON cadastros.entrada_sinal TO macuxierp_app;

GRANT SELECT ON cadastros.entrada_dono TO macuxierp_app, macuxierp_worker, macuxierp_leitura;
GRANT UPDATE (carga_completa_pedida_em) ON cadastros.entrada_dono TO macuxierp_worker;

GRANT SELECT ON cadastros.entrada_descida TO macuxierp_app, macuxierp_worker;
GRANT SELECT (id, tenant_id, tipo, referencia, estado, entregas, ultima_entrega_em, confirmado_em, retorno_codigo,
  created_at, updated_at, deleted_at, external_id) ON cadastros.entrada_descida TO macuxierp_leitura;
GRANT INSERT (tenant_id, tipo, referencia, payload, external_id) ON cadastros.entrada_descida
  TO macuxierp_app, macuxierp_worker;
GRANT UPDATE (estado, entregas, ultima_entrega_em, confirmado_em, retorno_codigo, payload) ON cadastros.entrada_descida
  TO macuxierp_app, macuxierp_worker;
