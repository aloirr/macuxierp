-- 0020 — faturamento.nota_xml guarda a NF-e assinada antes do envio (tipo nfe_assinada, uma linha por versão do
-- conteúdo; T-0021, revisão do lote 1c, regra 7). Aditiva e reexecutável. Motivo em docs/banco/README.md (T-0021).

SET LOCAL lock_timeout = '5s';

-- versao: número da montagem do conteúdo assinado (o reenvio da rejeitada remonta a nota, RN-FAT-07).
ALTER TABLE faturamento.nota_xml ADD COLUMN IF NOT EXISTS versao smallint;

-- A NF-e assinada ainda não tem protocolo; os outros tipos continuam com ele (CHECK nota_xml_protocolo_ck abaixo).
-- O CHECK inline do formato (protocolo ~ '^[0-9]{15}$') passa com nulo e continua valendo quando há protocolo.
ALTER TABLE faturamento.nota_xml ALTER COLUMN protocolo DROP NOT NULL;

DO $$
DECLARE
  c record;
BEGIN
  -- O CHECK inline do tipo (0013) dá lugar ao nota_xml_tipo_ck, de nome estável; o nome antigo é lido do catálogo.
  FOR c IN
    SELECT k.conname FROM pg_constraint k
    WHERE k.conrelid = 'faturamento.nota_xml'::regclass AND k.contype = 'c' AND k.conname <> 'nota_xml_tipo_ck'
      AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'faturamento.nota_xml'::regclass AND attname = 'tipo')]
  LOOP
    EXECUTE format('ALTER TABLE faturamento.nota_xml DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota_xml'::regclass AND conname = 'nota_xml_tipo_ck') THEN
    ALTER TABLE faturamento.nota_xml ADD CONSTRAINT nota_xml_tipo_ck
      CHECK (tipo IN ('nfe_assinada', 'nfe_autorizada', 'evento_cancelamento', 'evento_cce', 'inutilizacao'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota_xml'::regclass AND conname = 'nota_xml_versao_ck') THEN
    ALTER TABLE faturamento.nota_xml ADD CONSTRAINT nota_xml_versao_ck
      CHECK ((tipo = 'nfe_assinada') = (versao IS NOT NULL) AND (versao IS NULL OR versao >= 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'faturamento.nota_xml'::regclass AND conname = 'nota_xml_protocolo_ck') THEN
    ALTER TABLE faturamento.nota_xml ADD CONSTRAINT nota_xml_protocolo_ck
      CHECK ((tipo = 'nfe_assinada') = (protocolo IS NULL));
  END IF;
END $$;

-- nfe_assinada e nfe_autorizada referenciam a nota do mesmo jeito (nota e chave; sem evento nem inutilização).
ALTER TABLE faturamento.nota_xml DROP CONSTRAINT IF EXISTS nota_xml_referencia;
ALTER TABLE faturamento.nota_xml ADD CONSTRAINT nota_xml_referencia CHECK (CASE
  WHEN tipo IN ('nfe_autorizada', 'nfe_assinada') THEN nota_id IS NOT NULL AND evento_id IS NULL
    AND inutilizacao_id IS NULL AND chave_acesso IS NOT NULL
  WHEN tipo = 'inutilizacao' THEN inutilizacao_id IS NOT NULL AND nota_id IS NULL AND evento_id IS NULL
  ELSE evento_id IS NOT NULL AND nota_id IS NOT NULL AND inutilizacao_id IS NULL AND chave_acesso IS NOT NULL END);

-- Uma linha por versão da nota (tenant na frente, no padrão do schema); a nfe_autorizada segue única por nota
-- (nota_xml_autorizada_uq, da 0013), sem conflito com este índice.
CREATE UNIQUE INDEX IF NOT EXISTS nota_xml_assinada_versao_uq ON faturamento.nota_xml (tenant_id, nota_id, versao)
  WHERE tipo = 'nfe_assinada';

-- BEFORE INSERT da 0013 com o ramo nfe_assinada: a nota existe no tenant, está em rascunho, rejeitada ou emitida em
-- contingência (em_autorizacao não: a última versão guardada é a transmitida) e a chave do XML é a da nota. Na
-- contingência a chave muda (tpEmis), então o XML entra depois da troca de status, na mesma transação. Os outros
-- ramos não mudam.
CREATE OR REPLACE FUNCTION faturamento.nota_xml_antes_inserir() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  n faturamento.nota%ROWTYPE;
  e faturamento.nota_evento%ROWTYPE;
  i faturamento.inutilizacao%ROWTYPE;
BEGIN
  IF NOT faturamento.sou_dono(TG_RELID) OR NEW.guardado_em IS NULL THEN
    NEW.guardado_em := now();
  END IF;
  NEW.tamanho_bytes := coalesce(NEW.tamanho_bytes, octet_length(convert_to(NEW.xml, 'UTF8')));
  NEW.guardar_ate := coalesce(NEW.guardar_ate,
    (date_trunc('year', NEW.guardado_em AT TIME ZONE 'UTC') + interval '6 years')::date);

  IF NEW.tipo = 'nfe_assinada' THEN
    SELECT * INTO n FROM faturamento.nota x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.nota_id;
    IF NOT FOUND OR n.status NOT IN ('rascunho', 'rejeitada', 'emitida_contingencia') THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML assinado entra só na nota em rascunho, rejeitada ou emitida em contingência'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.chave_acesso IS DISTINCT FROM n.chave_acesso THEN
      RAISE EXCEPTION 'RN-FAT-03: chave do XML assinado diferente da chave da nota' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.tipo = 'nfe_autorizada' THEN
    SELECT * INTO n FROM faturamento.nota x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.nota_id;
    IF NOT FOUND OR n.status <> 'autorizada_guarda_pendente' THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML autorizado entra só na nota autorizada com guarda pendente'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.chave_acesso IS DISTINCT FROM n.chave_acesso OR NEW.protocolo IS DISTINCT FROM n.protocolo THEN
      RAISE EXCEPTION 'RN-FAT-03: chave ou protocolo do XML diferentes dos da nota' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.tipo IN ('evento_cancelamento', 'evento_cce') THEN
    SELECT * INTO e FROM faturamento.nota_evento x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.evento_id;
    IF NOT FOUND OR e.status <> 'pendente' OR NEW.tipo <> 'evento_' || e.tipo THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML do evento entra só no evento pendente do mesmo tipo'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.nota_id := coalesce(NEW.nota_id, e.nota_id);
    SELECT * INTO n FROM faturamento.nota x WHERE x.tenant_id = NEW.tenant_id AND x.id = e.nota_id;
    NEW.chave_acesso := coalesce(NEW.chave_acesso, n.chave_acesso);
    IF NEW.nota_id <> e.nota_id OR NEW.chave_acesso <> n.chave_acesso
       OR (e.protocolo IS NOT NULL AND NEW.protocolo <> e.protocolo) THEN
      RAISE EXCEPTION 'RN-FAT-03: nota, chave ou protocolo do XML diferentes dos do evento'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO i FROM faturamento.inutilizacao x WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.inutilizacao_id;
    IF NOT FOUND OR i.status <> 'pendente' OR (i.protocolo IS NOT NULL AND NEW.protocolo <> i.protocolo) THEN
      RAISE EXCEPTION 'RN-FAT-03: o XML da inutilização entra só na inutilização pendente, com o protocolo dela'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- AFTER INSERT da 0013 com ramos explícitos: só a nfe_autorizada leva a nota a autorizada; a nfe_assinada não muda
-- status nenhum (antes, um tipo fora da lista cairia no ramo dos eventos).
CREATE OR REPLACE FUNCTION faturamento.nota_xml_depois_inserir() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.tipo = 'nfe_autorizada' THEN
    UPDATE faturamento.nota SET status = 'autorizada'
    WHERE tenant_id = NEW.tenant_id AND id = NEW.nota_id AND status = 'autorizada_guarda_pendente';
  ELSIF NEW.tipo = 'inutilizacao' THEN
    UPDATE faturamento.inutilizacao SET status = 'registrado', protocolo = NEW.protocolo,
      registrado_em = coalesce(registrado_em, NEW.guardado_em)
    WHERE tenant_id = NEW.tenant_id AND id = NEW.inutilizacao_id AND status = 'pendente';
  ELSIF NEW.tipo IN ('evento_cancelamento', 'evento_cce') THEN
    UPDATE faturamento.nota_evento SET status = 'registrado', protocolo = NEW.protocolo,
      registrado_em = coalesce(registrado_em, NEW.guardado_em)
    WHERE tenant_id = NEW.tenant_id AND id = NEW.evento_id AND status = 'pendente';
  END IF;
  RETURN NULL;
END $$;

-- A leitura tem SELECT por coluna (0013, sem xml): versao entra. App e worker têm SELECT e INSERT na tabela.
GRANT SELECT (versao) ON faturamento.nota_xml TO macuxierp_leitura;

COMMENT ON COLUMN faturamento.nota_xml.versao IS
  'Só na nfe_assinada: versão do conteúdo assinado da nota (1, 2, ... a cada remontagem do reenvio, RN-FAT-07); '
  'única por tenant e nota (nota_xml_assinada_versao_uq).';

COMMENT ON TABLE faturamento.nota_xml IS
  'XML da NF-e assinada antes do envio (nfe_assinada, uma linha por versão, sem protocolo), da NF-e autorizada '
  '(nfeProc), dos eventos (procEventoNFe) e da inutilização (procInutNFe), guardado antes de qualquer outra coisa '
  '(RN-FAT-03, regra 7): só INSERT, sha256 e tamanho conferidos pelo banco, guarda mínima de 5 anos. A inserção da '
  'nfe_autorizada leva a nota a autorizada e a do evento ou da inutilização os leva a registrado; a nfe_assinada não '
  'muda status. Só o dono apaga, depois do guardar_ate. arquivo_id: cópia no S3 (plataforma.arquivo, opaco).';
