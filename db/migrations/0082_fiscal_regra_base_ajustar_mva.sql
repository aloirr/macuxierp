-- 0082 — Catálogo fiscal.regra_base e ajustar_mva sem padrão (v0.3.32, T-0127; RF-FIS-01 a 03, RN-FIS-01 a 05).
-- Aditiva e reexecutável. O porquê: docs/banco/README.md, seção "Catálogo regra_base e ajustar_mva (0082)".
--
-- 1. fiscal.regra_tributaria.ajustar_mva perde o DEFAULT false e o NOT NULL (condição do engenheiro-software na
--    revisão do #942, 28/11 04h32): nulo = "a regra não diz se ajusta a MVA", que o fiscal recusa no ST interestadual
--    (CODIGO_NAO_SUPORTADO). As linhas que já existem ficam com o valor que têm (não há como saber se o false veio do
--    padrão ou foi escolhido; mudar dado de regra fiscal sem o fiscal não é papel da migração).
-- 2. fiscal.regra_base: catálogo de regras base, só no tenant de referência (D9; lido por todo tenant, gravado só
--    pela migração ou seed versionado). A carga nunca é aplicada sozinha: o fiscal valida e o administrador aplica,
--    copiando a linha para fiscal.regra_tributaria do tenant (regra_tributaria.regra_base_id guarda a origem).
--    Sem carga nesta migração: não há fonte oficial das regras base no repositório (db/tabelas-fiscais). E nenhuma
--    regra de ST interestadual entra no catálogo: o CHECK regra_base_sem_st_interestadual recusa (só sai por migração
--    nova, depois do fiscal tratar ajustar_mva nulo).
-- Versão anterior sobre o esquema novo: ela lê ajustar_mva das linhas antigas (todas não nulas) e não conhece as
-- tabelas e colunas novas.

-- motivo em docs/banco/README.md (T-0043)
SET LOCAL lock_timeout = '5s';

-- ============================================================================================================
-- 1. ajustar_mva sem padrão e nulável (só catálogo do Postgres: sem reescrita da tabela)
-- ============================================================================================================
ALTER TABLE fiscal.regra_tributaria
  ALTER COLUMN ajustar_mva DROP DEFAULT,
  ALTER COLUMN ajustar_mva DROP NOT NULL;
COMMENT ON COLUMN fiscal.regra_tributaria.ajustar_mva IS
  'ST interestadual: true = ajusta a MVA original pela fórmula (sem mva_ajustada); false = usa a MVA original; '
  'nulo = não informado (sem padrão desde a 0082): o fiscal recusa o ST interestadual sem mva_ajustada '
  '(CODIGO_NAO_SUPORTADO). RN-FIS-05, T-0127.';

-- ============================================================================================================
-- 2. fiscal.regra_base (catálogo; mesmas colunas de negócio da regra_tributaria, mesmos CHECKs)
-- ============================================================================================================
CREATE TABLE IF NOT EXISTS fiscal.regra_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT plataforma.tenant_referencia() REFERENCES plataforma.tenant (id),
  -- Identificação no catálogo.
  chave text NOT NULL CHECK (chave ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  descricao text CHECK (length(descricao) BETWEEN 1 AND 1000),
  tributo text NOT NULL DEFAULT 'icms' CHECK (tributo IN ('icms', 'ipi', 'pis', 'cofins', 'ibs_cbs', 'is')),
  -- Filtros (nulo = todos, RN-FIS-01).
  ncm_prefixo text CHECK (ncm_prefixo ~ '^[0-9]{2,8}$'),
  uf_origem text CHECK (uf_origem ~ '^[A-Z]{2}$'),
  uf_destino text CHECK (uf_destino ~ '^[A-Z]{2}$'),
  tipo_cliente text CHECK (tipo_cliente IN ('contribuinte', 'isento', 'nao_contribuinte')),
  crt smallint CHECK (crt BETWEEN 1 AND 4),
  cfop text CHECK (cfop ~ '^[1-7][0-9]{3}$'),
  -- ICMS: CST (2 dígitos) ou CSOSN (3).
  codigo text CHECK (codigo ~ '^[0-9]{2,3}$'),
  mod_bc smallint NOT NULL DEFAULT 3 CHECK (mod_bc BETWEEN 0 AND 3),
  aliquota_icms integer CHECK (aliquota_icms BETWEEN 0 AND 1000000),
  reducao_bc integer CHECK (reducao_bc BETWEEN 0 AND 1000000),
  p_cred_sn integer CHECK (p_cred_sn BETWEEN 0 AND 1000000),
  p_dif integer CHECK (p_dif BETWEEN 0 AND 1000000),
  p_icms_efet integer CHECK (p_icms_efet BETWEEN 0 AND 1000000),
  excluir_icms_bc boolean NOT NULL DEFAULT false,
  -- ICMS-ST e FCP. ajustar_mva sem padrão, como na regra_tributaria desde esta migração.
  mod_bc_st smallint CHECK (mod_bc_st BETWEEN 0 AND 5),
  mva_original integer CHECK (mva_original BETWEEN 0 AND 100000000),
  mva_ajustada integer CHECK (mva_ajustada BETWEEN 0 AND 100000000),
  ajustar_mva boolean,
  reducao_bc_st integer CHECK (reducao_bc_st BETWEEN 0 AND 1000000),
  aliquota_interna_destino integer CHECK (aliquota_interna_destino BETWEEN 0 AND 1000000),
  p_fcp integer CHECK (p_fcp BETWEEN 0 AND 1000000),
  p_fcp_st integer CHECK (p_fcp_st BETWEEN 0 AND 1000000),
  -- IPI.
  cst_ipi text CHECK (cst_ipi ~ '^[0-9]{2}$'),
  aliquota_ipi integer CHECK (aliquota_ipi BETWEEN 0 AND 1000000),
  valor_unidade_ipi bigint CHECK (valor_unidade_ipi >= 0),
  c_enq text NOT NULL DEFAULT '999' CHECK (c_enq ~ '^[0-9]{3}$'),
  -- PIS e COFINS.
  cst_pis text CHECK (cst_pis ~ '^[0-9]{2}$'),
  aliquota_pis integer CHECK (aliquota_pis BETWEEN 0 AND 1000000),
  valor_unidade_pis bigint CHECK (valor_unidade_pis >= 0),
  cst_cofins text CHECK (cst_cofins ~ '^[0-9]{2}$'),
  aliquota_cofins integer CHECK (aliquota_cofins BETWEEN 0 AND 1000000),
  valor_unidade_cofins bigint CHECK (valor_unidade_cofins >= 0),
  -- IBS, CBS e IS (NT 2025.002-RTC).
  cst_ibs_cbs text CHECK (cst_ibs_cbs ~ '^[0-9]{3}$'),
  c_class_trib text CHECK (c_class_trib ~ '^[0-9]{6}$'),
  p_ibs_uf integer CHECK (p_ibs_uf BETWEEN 0 AND 1000000),
  p_ibs_mun integer CHECK (p_ibs_mun BETWEEN 0 AND 1000000),
  p_cbs integer CHECK (p_cbs BETWEEN 0 AND 1000000),
  p_red_ibs integer CHECK (p_red_ibs BETWEEN 0 AND 1000000),
  p_red_cbs integer CHECK (p_red_cbs BETWEEN 0 AND 1000000),
  p_is integer CHECK (p_is BETWEEN 0 AND 1000000),
  cst_is text CHECK (cst_is ~ '^[0-9]{3}$'),
  c_class_trib_is text CHECK (c_class_trib_is ~ '^[0-9]{6}$'),
  valor_unidade_is bigint CHECK (valor_unidade_is >= 0),
  versao_nt_rtc text CHECK (length(versao_nt_rtc) BETWEEN 1 AND 40),
  -- Fonte e vigência (RN-FIS-04).
  fonte_tipo text NOT NULL CHECK (fonte_tipo IN ('NT', 'convenio', 'anexo', 'lei', 'ajuste_sinief', 'resolucao',
    'outro')),
  fonte_referencia text NOT NULL CHECK (length(fonte_referencia) BETWEEN 1 AND 200),
  versao text NOT NULL CHECK (length(versao) BETWEEN 1 AND 40),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  external_id text CHECK (length(external_id) <= 64),
  -- Catálogo geral: só no tenant de referência.
  CONSTRAINT regra_base_so_referencia CHECK (tenant_id = plataforma.tenant_referencia()),
  CONSTRAINT regra_base_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT regra_base_cst_ou_csosn CHECK (crt IS NULL OR codigo IS NULL OR (crt IN (1, 4)) = (length(codigo) = 3)),
  CONSTRAINT regra_base_ibs_cbs_par CHECK ((cst_ibs_cbs IS NULL) = (c_class_trib IS NULL)),
  CONSTRAINT regra_base_is_par CHECK ((cst_is IS NULL) = (c_class_trib_is IS NULL)),
  CONSTRAINT regra_base_icms_com_codigo CHECK (tributo <> 'icms' OR codigo IS NOT NULL),
  CONSTRAINT regra_base_so_o_tributo CHECK (tributo = 'icms' OR (
    num_nonnulls(codigo, aliquota_icms, reducao_bc, p_cred_sn, mod_bc_st, mva_original, mva_ajustada, reducao_bc_st,
      aliquota_interna_destino, p_fcp, p_fcp_st, p_dif, p_icms_efet) = 0
    AND (tributo = 'ipi' OR num_nonnulls(cst_ipi, aliquota_ipi, valor_unidade_ipi) = 0)
    AND (tributo = 'pis' OR num_nonnulls(cst_pis, aliquota_pis, valor_unidade_pis) = 0)
    AND (tributo = 'cofins' OR num_nonnulls(cst_cofins, aliquota_cofins, valor_unidade_cofins) = 0)
    AND (tributo = 'ibs_cbs' OR num_nonnulls(cst_ibs_cbs, c_class_trib, p_ibs_uf, p_ibs_mun, p_cbs, p_red_ibs,
      p_red_cbs) = 0)
    AND (tributo = 'is' OR num_nonnulls(p_is, cst_is, c_class_trib_is, valor_unidade_is) = 0))),
  -- T-0127 (engenheiro, 28/11 04h32): nenhuma regra de ST interestadual no catálogo. ST = campo de ST preenchido ou
  -- CST/CSOSN que cobra ST (10, 30, 70, 201, 202, 203); só passa com origem e destino informados e iguais (interna).
  -- O ST retido (60/500) é repasse da compra e não é barrado. O coalesce fecha o nulo (UF nula = todas = interestadual).
  CONSTRAINT regra_base_sem_st_interestadual CHECK (
    (num_nonnulls(mod_bc_st, mva_original, mva_ajustada, ajustar_mva, reducao_bc_st, aliquota_interna_destino,
      p_fcp_st) = 0 AND coalesce(codigo, '') NOT IN ('10', '30', '70', '201', '202', '203'))
    OR coalesce(uf_origem = uf_destino, false))
);
SELECT controle.preparar_tabela('fiscal.regra_base', true);
-- Uma versão viva por chave e início de vigência (a nova vigência é linha nova, com a mesma chave).
CREATE UNIQUE INDEX IF NOT EXISTS regra_base_chave_uq ON fiscal.regra_base (tenant_id, chave, vigencia_inicio)
  WHERE deleted_at IS NULL;
-- Tela do catálogo: filtro por UF de origem e tributo.
CREATE INDEX IF NOT EXISTS regra_base_uf_origem_idx ON fiscal.regra_base (uf_origem, tributo, vigencia_inicio)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE fiscal.regra_base IS
  'Catálogo de regras base (T-0127, RF-FIS-01 a 03): só no tenant de referência (D9), lido por todo tenant e gravado '
  'só pela migração ou seed versionado (fonte e vigência, RN-FIS-04). Mesmas colunas de negócio e CHECKs da '
  'regra_tributaria, mais chave, titulo e descricao. Nunca é aplicada sozinha: o fiscal valida e o administrador '
  'aplica (cópia para regra_tributaria, com regra_base_id). Sem ST interestadual (regra_base_sem_st_interestadual).';
COMMENT ON COLUMN fiscal.regra_base.chave IS
  'Identificador estável no catálogo (minúsculas, dígitos, ponto, hífen e sublinhado); vigência nova = linha nova com '
  'a mesma chave.';

-- ============================================================================================================
-- 3. fiscal.regra_tributaria.regra_base_id (origem da regra aplicada; nulo = cadastrada à mão)
-- ============================================================================================================
ALTER TABLE fiscal.regra_tributaria ADD COLUMN IF NOT EXISTS regra_base_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'fiscal.regra_tributaria'::regclass AND conname = 'regra_tributaria_regra_base_fk') THEN
    ALTER TABLE fiscal.regra_tributaria
      ADD CONSTRAINT regra_tributaria_regra_base_fk FOREIGN KEY (regra_base_id) REFERENCES fiscal.regra_base (id);
  END IF;
END $$;
-- Aplicar duas vezes a mesma regra base no tenant = repetido (escrita idempotente); excluída libera nova aplicação.
CREATE UNIQUE INDEX IF NOT EXISTS regra_tributaria_regra_base_uq ON fiscal.regra_tributaria (tenant_id, regra_base_id)
  WHERE regra_base_id IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN fiscal.regra_tributaria.regra_base_id IS
  'Regra do catálogo fiscal.regra_base de onde a linha foi aplicada (T-0127); nulo = cadastrada à mão. Uma aplicação '
  'viva por tenant e regra base (regra_tributaria_regra_base_uq).';

-- Catálogo: só leitura para os papéis da aplicação (a escrita é da migração). Coluna nova da regra_tributaria entra
-- nos grants por tabela da 0013.
GRANT SELECT ON fiscal.regra_base TO macuxierp_app, macuxierp_leitura;
