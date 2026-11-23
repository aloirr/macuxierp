-- 0032 — contingência da NF-e com EPEC (T-0021, lote 4 do faturamento, v0.2.1; RN-FAT-05, 08 e 09). Estende a
-- faturamento.contingencia da 0013 (a "filial_contingencia" do pedido do faturamento), sem tabela nova nem view:
-- modalidade 'epec', quem ligou e quem desligou; na nota, tpEmis 4 (EPEC) e o protocolo do evento EPEC. A RN-FAT-10
-- (filial com NF-e simulada não entra em contingência) fica na API, sem regra no banco. Aditiva e reexecutável.
-- Detalhes em docs/banco/README.md (0032).

SET LOCAL lock_timeout = '5s';

-- ============================================================================================================
-- faturamento.contingencia
-- ============================================================================================================
ALTER TABLE faturamento.contingencia ADD COLUMN IF NOT EXISTS ligada_por uuid;
ALTER TABLE faturamento.contingencia ADD COLUMN IF NOT EXISTS desligada_por uuid;

-- Modalidade: o CHECK inline da 0013 (nome gerado, contingencia_modalidade_check) dá lugar ao nomeado com a EPEC
-- (ADR 0011; FS-DA fora da v1). Acha-se o CHECK antigo pela coluna (conkey só com modalidade), não pelo nome.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'faturamento.contingencia'::regclass AND c.contype = 'c'
      AND c.conname <> 'contingencia_modalidade_ck'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'faturamento.contingencia'::regclass AND attname = 'modalidade')]
  LOOP
    EXECUTE format('ALTER TABLE faturamento.contingencia DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.contingencia'::regclass AND conname = 'contingencia_modalidade_ck') THEN
    ALTER TABLE faturamento.contingencia ADD CONSTRAINT contingencia_modalidade_ck
      CHECK (modalidade IN ('svc_an', 'svc_rs', 'epec'));
  END IF;
END $$;

-- desligada_por só com fim_em; NOT VALID por causa das fechadas de antes, VALIDATE se não houver (README 0032).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.contingencia'::regclass AND conname = 'contingencia_desligada_ck') THEN
    ALTER TABLE faturamento.contingencia ADD CONSTRAINT contingencia_desligada_ck
      CHECK ((fim_em IS NULL) = (desligada_por IS NULL)) NOT VALID;
  END IF;
  IF NOT (SELECT convalidated FROM pg_constraint
          WHERE conrelid = 'faturamento.contingencia'::regclass AND conname = 'contingencia_desligada_ck')
     AND NOT EXISTS (SELECT 1 FROM faturamento.contingencia WHERE (fim_em IS NULL) <> (desligada_por IS NULL)) THEN
    ALTER TABLE faturamento.contingencia VALIDATE CONSTRAINT contingencia_desligada_ck;
  END IF;
END $$;

-- ligada_por obrigatório só no INSERT (as abertas de antes ainda fecham); UPDATE só fecha, uma vez (README 0032).
CREATE OR REPLACE FUNCTION faturamento.contingencia_antes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.ambiente := faturamento.ambiente_conferido(NEW.tenant_id, NEW.filial_id, NEW.ambiente);
    IF NEW.ligada_por IS NULL THEN
      RAISE EXCEPTION 'RN-FAT-05: ligada_por é obrigatório ao abrir a contingência' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  k := faturamento.coluna_alterada(to_jsonb(OLD), to_jsonb(NEW), ARRAY['fim_em', 'desligada_por', 'updated_at']);
  IF k IS NOT NULL OR OLD.fim_em IS NOT NULL THEN
    RAISE EXCEPTION 'RN-FAT-05: a contingência só recebe o fim, uma vez (% recusado)', coalesce(k, 'fim_em')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON TABLE faturamento.contingencia IS
  'Períodos de contingência (RN-FAT-05, 08 e 09): SVC-AN, SVC-RS ou EPEC; uma aberta por tenant, filial e ambiente; '
  'quem liga (ligada_por, obrigatório no INSERT) e quem desliga (desligada_por, junto com fim_em, uma vez). A nota '
  'com tpEmis 4, 6 ou 7 sai do rascunho ou da rejeitada, ou entra em emitida_contingencia, só com a aberta da '
  'modalidade do tpEmis (epec, svc_an, svc_rs). Filial com NF-e simulada não entra (RN-FAT-10, na API).';
COMMENT ON COLUMN faturamento.contingencia.ligada_por IS
  'Usuário (plataforma.usuario, opaco) que abriu a contingência. Obrigatório desde a 0032; nulo só nas linhas antigas.';
COMMENT ON COLUMN faturamento.contingencia.desligada_por IS
  'Usuário (plataforma.usuario, opaco) que encerrou a contingência; existe só com fim_em (contingencia_desligada_ck).';

-- ============================================================================================================
-- faturamento.nota: tpEmis 4 (EPEC), além de 1, 6 (SVC-AN) e 7 (SVC-RS), e o protocolo do evento EPEC.
-- Os CHECKs são afrouxados (todas as linhas atuais passam) ou valem só para colunas novas (nulas): ADD direto, validado.
-- ============================================================================================================
ALTER TABLE faturamento.nota ADD COLUMN IF NOT EXISTS epec_protocolo text;
ALTER TABLE faturamento.nota ADD COLUMN IF NOT EXISTS epec_autorizada_em timestamptz;

DO $$
DECLARE
  r record;
BEGIN
  -- CHECK inline da 0013 em tipo_emissao (nome gerado, nota_tipo_emissao_check), achado pela coluna.
  FOR r IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'faturamento.nota'::regclass AND c.contype = 'c' AND c.conname <> 'nota_tipo_emissao_ck'
      AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'faturamento.nota'::regclass AND attname = 'tipo_emissao')]
  LOOP
    EXECUTE format('ALTER TABLE faturamento.nota DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota'::regclass AND conname = 'nota_tipo_emissao_ck') THEN
    ALTER TABLE faturamento.nota ADD CONSTRAINT nota_tipo_emissao_ck CHECK (tipo_emissao IN (1, 4, 6, 7));
  END IF;

  -- RN-FAT-05: emitida em contingência com tpEmis 4 (EPEC), 6 (SVC-AN) ou 7 (SVC-RS).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota'::regclass AND conname = 'nota_emitida_contingencia'
                   AND pg_get_constraintdef(oid) LIKE '%ARRAY[4, 6, 7]%') THEN
    ALTER TABLE faturamento.nota DROP CONSTRAINT IF EXISTS nota_emitida_contingencia;
    ALTER TABLE faturamento.nota ADD CONSTRAINT nota_emitida_contingencia
      CHECK (status <> 'emitida_contingencia' OR tipo_emissao IN (4, 6, 7));
  END IF;

  -- Protocolo do evento EPEC: 15 dígitos; protocolo e data juntos, só na nota EPEC (tpEmis 4).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota'::regclass AND conname = 'nota_epec_protocolo_ck') THEN
    ALTER TABLE faturamento.nota ADD CONSTRAINT nota_epec_protocolo_ck CHECK (epec_protocolo ~ '^[0-9]{15}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota'::regclass AND conname = 'nota_epec_coerente_ck') THEN
    ALTER TABLE faturamento.nota ADD CONSTRAINT nota_epec_coerente_ck
      CHECK (num_nulls(epec_protocolo, epec_autorizada_em) IN (0, 2)
        AND (epec_protocolo IS NULL OR tipo_emissao = 4));
  END IF;
END $$;

COMMENT ON COLUMN faturamento.nota.epec_protocolo IS
  'nProt do evento EPEC autorizado (15 dígitos; RN-FAT-08). Só com tipo_emissao 4, junto com epec_autorizada_em; '
  'gravado de nulo para valor com a nota indo a (ou já em) emitida_contingencia, num UPDATE só se quiser; depois de '
  'gravado não muda nem volta a nulo em nenhum status (nota_antes_alterar). Sem ele, a nota EPEC não volta a '
  'em_autorizacao (RN-FAT-09).';
COMMENT ON COLUMN faturamento.nota.epec_autorizada_em IS
  'Data e hora (UTC) da autorização do evento EPEC (dhRegEvento). Junto com epec_protocolo e, como ele, não muda '
  'depois de gravada.';

-- UPDATE da nota: o da 0013 mais o EPEC e a coerência entre tpEmis e modalidade (RN-FAT-05, 08 e 09; README 0032).
CREATE OR REPLACE FUNCTION faturamento.nota_antes_alterar() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  velho jsonb := to_jsonb(OLD);
  novo jsonb := to_jsonb(NEW);
  fixos text[] := ARRAY['id', 'tenant_id', 'filial_id', 'ambiente', 'modelo', 'serie', 'idempotencia_chave',
    'pedido_id', 'created_at'];
  retorno text[] := ARRAY['status', 'updated_at', 'c_stat', 'x_motivo', 'recibo', 'protocolo', 'autorizada_em'];
  contingencia text[] := ARRAY['tipo_emissao', 'chave_acesso', 'c_nf', 'contingencia_em', 'contingencia_justificativa',
    'emitida_em'];
  epec text[] := ARRAY['epec_protocolo', 'epec_autorizada_em'];
  autorizada text[] := ARRAY['status', 'updated_at', 'cancelada_em'];
  -- EPEC entra só com a nota indo a (ou já em) emitida_contingencia; "uma vez" fica com a trava logo abaixo.
  epec_aqui text[] := CASE WHEN NEW.status = 'emitida_contingencia' THEN epec ELSE '{}'::text[] END;
  k text;
BEGIN
  FOREACH k IN ARRAY fixos LOOP
    IF velho -> k IS DISTINCT FROM novo -> k THEN
      RAISE EXCEPTION 'RN-FAT-01/04: % da nota não muda', k USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  -- RN-FAT-08 e regra 7: o EPEC gravado não muda nem volta a nulo, em nenhum status.
  IF OLD.epec_protocolo IS NOT NULL THEN
    k := CASE WHEN NEW.epec_protocolo IS DISTINCT FROM OLD.epec_protocolo THEN 'epec_protocolo'
              WHEN NEW.epec_autorizada_em IS DISTINCT FROM OLD.epec_autorizada_em THEN 'epec_autorizada_em' END;
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-08: o EPEC autorizado não muda (% recusado)', k USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF OLD.numero IS NOT NULL AND NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'RN-FAT-01/07: numero da nota não muda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.numero IS NULL AND NEW.numero IS NOT NULL THEN
    PERFORM faturamento.conferir_reservado(NEW);
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
     AND (OLD.status <> 'rascunho' OR NEW.numero IS NOT NULL OR OLD.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'RN-FAT-01: só o rascunho sem número é excluído' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status = 'em_autorizacao' THEN
    k := faturamento.coluna_alterada(velho, novo,
      retorno || epec_aqui || CASE WHEN NEW.status = 'emitida_contingencia' THEN contingencia ELSE '{}'::text[] END);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-02: nota em autorização só recebe o retorno da SEFAZ (% recusado)', k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status = 'emitida_contingencia' THEN
    k := faturamento.coluna_alterada(velho, novo, retorno || epec_aqui);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-05: nota emitida em contingência só recebe o retorno da SEFAZ (% recusado)', k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status IN ('autorizada_guarda_pendente', 'autorizada') THEN
    k := faturamento.coluna_alterada(velho, novo, autorizada);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-02: nota % nunca é editada, só evento (% recusado)', OLD.status, k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.status IN ('cancelada', 'denegada', 'inutilizada') THEN
    k := faturamento.coluna_alterada(velho, novo, ARRAY['updated_at']);
    IF k IS NOT NULL THEN
      RAISE EXCEPTION 'RN-FAT-02: nota % nunca é editada (% recusado)', OLD.status, k
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  -- RN-FAT-08: o EPEC entra só com a nota indo a (ou já em) emitida_contingencia, nunca no rascunho ou na rejeitada
  -- (senão a exceção da volta da EPEC na RN-FAT-05, abaixo, viraria atalho).
  IF OLD.epec_protocolo IS NULL AND NEW.epec_protocolo IS NOT NULL AND NEW.status <> 'emitida_contingencia' THEN
    RAISE EXCEPTION 'RN-FAT-08: o EPEC entra só com a nota em emitida_contingencia (% recusado)', NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'rascunho' AND NEW.status IN ('em_autorizacao', 'emitida_contingencia'))
         OR (OLD.status = 'em_autorizacao' AND NEW.status IN ('autorizada_guarda_pendente', 'rejeitada', 'denegada',
              'emitida_contingencia'))
         OR (OLD.status = 'rejeitada' AND NEW.status IN ('em_autorizacao', 'emitida_contingencia', 'inutilizada'))
         OR (OLD.status = 'rascunho' AND NEW.status = 'inutilizada' AND NEW.numero IS NOT NULL)
         OR (OLD.status = 'emitida_contingencia' AND NEW.status = 'em_autorizacao')
         OR (OLD.status = 'autorizada_guarda_pendente' AND NEW.status = 'autorizada')
         OR (OLD.status = 'autorizada' AND NEW.status = 'cancelada')) THEN
      RAISE EXCEPTION 'RN-FAT-02: transição de % para % recusada', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'autorizada' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_xml x
        WHERE x.tenant_id = NEW.tenant_id AND x.nota_id = NEW.id AND x.tipo = 'nfe_autorizada') THEN
      RAISE EXCEPTION 'RN-FAT-03: a nota só fica autorizada com o XML guardado (guarda pendente)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'cancelada' AND NOT EXISTS (SELECT 1 FROM faturamento.nota_evento e
        WHERE e.tenant_id = NEW.tenant_id AND e.nota_id = NEW.id AND e.tipo = 'cancelamento'
          AND e.status = 'registrado') THEN
      RAISE EXCEPTION 'RN-FAT-02: cancelamento só pelo evento registrado' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'inutilizada' AND NOT faturamento.numero_inutilizado(NEW.tenant_id, NEW.filial_id, NEW.ambiente,
        NEW.modelo, NEW.serie, NEW.numero, true) THEN
      RAISE EXCEPTION 'RN-FAT-01: inutilizada só com a inutilização registrada da faixa'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('em_autorizacao', 'emitida_contingencia') AND OLD.status IN ('rascunho', 'rejeitada') THEN
      IF faturamento.numero_inutilizado(NEW.tenant_id, NEW.filial_id, NEW.ambiente, NEW.modelo, NEW.serie,
          NEW.numero) THEN
        RAISE EXCEPTION 'RN-FAT-07: o número % está em inutilização; a nota não volta a ser enviada', NEW.numero
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.ambiente <> faturamento.ambiente_da_filial(NEW.tenant_id, NEW.filial_id) THEN
        RAISE EXCEPTION 'RN-FAT-04: a nota é de % e a filial agora emite em %; crie outra nota', NEW.ambiente,
          faturamento.ambiente_da_filial(NEW.tenant_id, NEW.filial_id) USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    -- RN-FAT-05: tpEmis 4, 6 ou 7 saindo do rascunho ou da rejeitada, ou entrando em emitida_contingencia (também
    -- de em_autorizacao), só com a contingência aberta da modalidade do tpEmis. Fora: a volta da EPEC à SEFAZ normal
    -- (emitida_contingencia → em_autorizacao), que pode vir com a contingência já fechada, e o reenvio da nota EPEC
    -- que já passou pelo evento (tpEmis 4 com epec_protocolo gravado) e foi rejeitada na volta (RN-FAT-07 e 09).
    -- tpEmis 1 em emitida_contingencia cai no CHECK nota_emitida_contingencia.
    IF NEW.tipo_emissao <> 1
       AND NOT (NEW.tipo_emissao = 4 AND OLD.epec_protocolo IS NOT NULL)
       AND (NEW.status = 'emitida_contingencia'
            OR (OLD.status IN ('rascunho', 'rejeitada') AND NEW.status = 'em_autorizacao'))
       AND NOT EXISTS (SELECT 1 FROM faturamento.contingencia c
         WHERE c.tenant_id = NEW.tenant_id AND c.filial_id = NEW.filial_id AND c.ambiente = NEW.ambiente
           AND c.fim_em IS NULL AND c.deleted_at IS NULL
           AND c.modalidade = CASE NEW.tipo_emissao WHEN 4 THEN 'epec' WHEN 6 THEN 'svc_an' WHEN 7 THEN 'svc_rs' END) THEN
      RAISE EXCEPTION 'RN-FAT-05: tpEmis % só com a contingência aberta da modalidade % na filial e no ambiente',
        NEW.tipo_emissao, CASE NEW.tipo_emissao WHEN 4 THEN 'epec' WHEN 6 THEN 'svc_an' WHEN 7 THEN 'svc_rs' END
        USING ERRCODE = 'check_violation';
    END IF;
    -- RN-FAT-09: a nota EPEC volta à SEFAZ normal só com o evento EPEC autorizado (epec_protocolo).
    IF OLD.status = 'emitida_contingencia' AND NEW.status = 'em_autorizacao' AND NEW.tipo_emissao = 4
       AND NEW.epec_protocolo IS NULL THEN
      RAISE EXCEPTION 'RN-FAT-09: a nota EPEC volta a em_autorizacao só com o evento EPEC autorizado (epec_protocolo)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ============================================================================================================
-- Privilégios. contingencia e nota: app e worker têm INSERT e UPDATE por tabela (0013), e as colunas novas entram
-- sozinhas (o app liga e desliga pela tela do operador). A leitura lê a nota por coluna (0013, sem o retrato do
-- destinatário e o transporte): ganha as duas colunas do EPEC, que não têm dado pessoal.
-- ============================================================================================================
GRANT SELECT (epec_protocolo, epec_autorizada_em) ON faturamento.nota TO macuxierp_leitura;
