/**
 * Contratos públicos do módulo fiscal (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 */
import { z } from 'zod';
import { Uf } from '@macuxierp/cadastros/contracts';

export const MODULO = 'fiscal' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

/* ===================== fiscal.calculo@1 =====================
 * Contrato do cálculo tributário (RF-FIS-01/02). O motor é puro: recebe as regras já buscadas; quem busca no banco é a API.
 * Convenções (RN do doc 03 e regra 4 do CLAUDE.md):
 *  - dinheiro em CENTAVOS (inteiro);
 *  - alíquotas, reduções e MVA em DÉCIMOS DE MILÉSIMO DE PONTO PERCENTUAL (4 casas), inteiros (180000 = 18,0000%; 1000000 = 100%);
 *  - datas de vigência e de emissão como 'AAAA-MM-DD' (data civil do tenant);
 *  - campos opcionais ipi/pis/cofins (lote 2) e ibs/cbs/is (lote 3) já declarados para não quebrar o @1;
 *  - evolução compatível no @1: a RegraTributaria ganhou `tributo` (padrão 'icms') e os campos de IPI/PIS/COFINS (todos opcionais com padrão;
 *    o lote 3 acrescenta IBS/CBS/IS do mesmo jeito), e novos códigos de erro podem surgir (ex.: CODIGO_INCOMPATIVEL_REGIME);
 *    o consumidor deve tratar código de erro desconhecido (mostrar a mensagem e o rn, sem quebrar).
 *  - lote 2: o motor calcula IPI, PIS e COFINS e cobre só NF-e de SAÍDA (CST de entrada é recusado com CODIGO_INCOMPATIVEL_REGIME).
 *    Precedência do `ipi_centavos` de entrada: ver o campo em ItemCalculo.
 *  - PIS/COFINS: Simples (CRT 1, 2 e 4) recolhe no DAS e não exige regra (sem regra sai CST 99, sem valor). CRT 3 exige a regra:
 *    sem regra de PIS ou de COFINS o erro é REGRA_NAO_ENCONTRADA. No CRT 3 o `regime_pis_cofins` do emitente é exigido, mas a falta dele
 *    é erro tipado (REGRA_INCOMPLETA), não exceção do Zod, para não quebrar o parse de quem já usa o @1.
 *  - valor por unidade (vUnid/vAliqProd, 11v4 do Manual): inteiro em DÉCIMOS DE MILÉSIMO DE REAL (×10^4; R$ 0,1411 = 1411).
 *    A quantidade (qTrib) vale com até 4 casas; o valor em centavos é quantidade × valor por unidade, meio para cima.
 *  - lote 3 (RF-FIS-03/04, RN-FIS-03): IBS/CBS (grupo gIBSCBS da NT 2025.002-RTC) e IS (gIS) por regra de `tributo` 'ibs_cbs' | 'is' (ou nos campos
 *    cst_ibs_cbs/cst_is da linha única); a versão da NT vem da regra (`versao_nt_rtc`, obrigatória para calcular) e sai UMA vez por item
 *    (`versao_nt_rtc` do ItemResultado), não em cada grupo. Sem regra de IBS/CBS ou de IS o grupo simplesmente não sai (fase de teste de 2026).
 *    Leiaute do resultado igual à NT: `ibs_cbs` { cst, cClassTrib, vBC, gIBSUF, gIBSMun, vIBS, gCBS } com gRed (pRedAliq, pAliqEfet) separado em
 *    UF, Município e CBS, e `is` (gIS). Os grupos `ibs` e `cbs` do @1 são OBSOLETOS: não são mais preenchidos e saem no @2.
 *    Carga aproximada (Lei 12.741, IBPT): `carga_aproximada` por item (a API busca em fiscal.carga_aproximada); sai vTotTrib por item e no total.
 *  - Arredondamento (decisão do Alexandre, 22/11/2026, Manaus): IBS, CBS e IS em MEIO-PARA-PAR (ABNT NBR 5891), igual à Calculadora RTC da RFB
 *    (github.com/ReceitaFederal/calculadora-rtc-regime-regular, HALF_EVEN: vBC arredondado uma vez a 2 casas; pAliqEfet = alíquota × (1 − pRedAliq)
 *    a 4 casas; valor = arred2(vBC × pAliqEfet ÷ 100)). ICMS, IPI, PIS e COFINS seguem meio para cima (RN-CORE-03).
 *  - vNF (regra única, aqui): vNF = vProd − vDesc + vFrete + vSeg + vOutro + vST + vFCPST + vIPI e NÃO soma IBS/CBS/IS (em 2026, fase de teste, a NT os
 *    destaca "por fora"). O total com os tributos por fora sai à parte em `totais.v_nf_tot` (opcional) = vNF + vIBS + vCBS + vIS.
 *    Alíquotas de 2026 (teste: CBS 0,9% e IBS 0,1%) vêm sempre da regra, nunca do código.
 *  - vBC do IBS/CBS por item (BaseCalculoUnificadaService da Calculadora RTC): vProd + vFrete + vSeg + vOutro + vII + vIS (vIS só a partir de 2027)
 *    − vDesc − vPIS − vCOFINS − vICMS − vICMSUFDest − vFCP − vFCPUFDest − vICMSMono − vISSQN; o vIPI NÃO entra; os componentes de ICMS/FCP/ICMSMono
 *    só valem para bem, de 2026 a 2032.
 *  - lote 4 (T-0020, pedido do faturamento T-0021): ICMS-ST retido (CST 60/CSOSN 500), CST 51 (diferimento) e emitente MEI (CRT 4); detalhes nos JSDocs de `ItemCalculo.st_retido`, `RegraTributaria.p_dif`/`p_icms_efet` e `IcmsItem`.
 */

export const CALCULO_VERSAO = 1 as const;

// Centavos: não vem de cadastros porque aqui é inteiro seguro e o piso (não negativo) é aplicado à parte; repetido de propósito (como o TenantId).
const Centavos = z.number().int().safe();
const CentavosNaoNeg = Centavos.nonnegative();
/** Valor por unidade (vUnid/vAliqProd, 11v4 do Manual) em décimos de milésimo de real (×10^4): R$ 0,1411 = 1411. */
const ValorUnidade4 = z.number().int().safe().nonnegative();
/** Alíquota/MVA em décimos de milésimo de ponto percentual, 4 casas (180000 = 18,0000%). Teto largo: só a MVA o usa. */
export const Aliquota = z.number().int().nonnegative().max(100_000_000);
/** Alíquota, FCP, pCredSN e reduções: no máximo 100% (1_000_000). */
export const Percentual = Aliquota.max(1_000_000);
const Cfop = z.string().regex(/^\d{4}$/);
const DataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** CRT da filial emissora: 1 Simples, 2 Simples com excesso de sublimite, 3 regime normal, 4 MEI. */
export const Crt = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Crt = z.infer<typeof Crt>;

export const TipoContribuinte = z.enum(['contribuinte', 'isento', 'nao_contribuinte']);
export type TipoContribuinte = z.infer<typeof TipoContribuinte>;

export const OrigemMercadoria = z.enum(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
export const FinalidadeNfe = z.enum(['normal', 'complementar', 'ajuste', 'devolucao']);

export const CST_ICMS = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90'] as const;
export const CSOSN_ICMS = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'] as const;

export const EmitenteCalculo = z.object({
  uf: Uf,
  crt: Crt,
  /** Regime de PIS/COFINS da filial (lote 2). */
  regime_pis_cofins: z.enum(['cumulativo', 'nao_cumulativo']).optional(),
  /** Emitente industrial ou equiparado a industrial (contribuinte do IPI). Falso (padrão): o grupo IPI não é calculado. */
  industrial_ipi: z.boolean().default(false),
});
export const DestinatarioCalculo = z.object({
  uf: Uf,
  tipo_contribuinte: TipoContribuinte,
  consumidor_final: z.boolean(),
  tipo_pessoa: z.enum(['PF', 'PJ']),
});
export const OperacaoCalculo = z.object({
  finalidade: FinalidadeNfe,
  /** Data de emissão (AAAA-MM-DD, fuso do tenant): decide a vigência das regras (RN-FIS-04). */
  data_emissao: DataCivil,
});

/**
 * RF-FIS-04 (Lei 12.741/2012, Decreto 8.264/2014): alíquotas aproximadas por NCM, 4 casas (Percentual), com versão e fonte da tabela IBPT.
 * Federal tem duas alíquotas (nacional e importado); o motor escolhe pela origem da mercadoria (origens 1, 2, 6 e 7 = importado; as demais são nacionais, inclusive 3, 4, 5 e 8).
 */
export const CargaAproximada = z.object({
  federal_nacional: Percentual,
  federal_importado: Percentual,
  estadual: Percentual,
  municipal: Percentual,
  versao: z.string().min(1),
  fonte: z.string().min(1),
});
export type CargaAproximada = z.infer<typeof CargaAproximada>;

/** Resultado da carga aproximada de um item (RF-FIS-04): abertura por esfera, com a versão e a fonte da tabela. */
export const CargaAproximadaItem = z.object({
  v_federal: CentavosNaoNeg,
  v_estadual: CentavosNaoNeg,
  v_municipal: CentavosNaoNeg,
  versao: z.string(),
  fonte: z.string(),
});
export type CargaAproximadaItem = z.infer<typeof CargaAproximadaItem>;

/** ST retido na compra (alíquotas com 4 casas). FCP-ST retido: os três campos juntos ou nenhum. */
export const StRetido = z.object({
  v_bc_st_ret: CentavosNaoNeg,
  /** pST: alíquota suportada pelo consumidor final (ICMS-ST + FCP-ST). */
  p_st: Percentual,
  v_icms_substituto: CentavosNaoNeg,
  v_icms_st_ret: CentavosNaoNeg,
  v_bc_fcp_st_ret: CentavosNaoNeg.optional(),
  p_fcp_st_ret: Percentual.optional(),
  v_fcp_st_ret: CentavosNaoNeg.optional(),
  /** pRedBCEfet (ICMS efetivo, consumidor final); padrão 0. */
  p_red_bc_efet: Percentual.optional(),
});
export type StRetido = z.infer<typeof StRetido>;

export const ItemCalculo = z.object({
  id: z.string().min(1),
  ncm: z.string().regex(/^\d{8}$/),
  cest: z.string().regex(/^\d{7}$/).optional(),
  cfop: Cfop,
  quantidade: z.number().positive(),
  /** Informativo (vUnCom): não entra no cálculo; a base parte de valor_bruto_centavos. */
  valor_unitario_centavos: CentavosNaoNeg,
  valor_bruto_centavos: CentavosNaoNeg,
  desconto_centavos: CentavosNaoNeg.default(0),
  frete_centavos: CentavosNaoNeg.default(0),
  seguro_centavos: CentavosNaoNeg.default(0),
  outras_despesas_centavos: CentavosNaoNeg.default(0),
  origem: OrigemMercadoria,
  /**
   * IPI do item informado por quem chama. Precedência: havendo regra de IPI aplicável (emitente `industrial_ipi` = true), o valor
   * calculado SUBSTITUI este campo; sem regra, ele é usado como está (compatível com o lote 1). Entra na BC do ICMS/ST conforme o destinatário.
   */
  ipi_centavos: CentavosNaoNeg.default(0),
  /** RF-FIS-04: alíquotas aproximadas do NCM do item (IBPT), já buscadas pela API. Sem este campo não há vTotTrib do item. */
  carga_aproximada: CargaAproximada.optional(),
  /** Unidade tributável (uTrib) do item; sai no gIS específico (ad rem) quando informada. */
  u_trib: z.string().min(1).max(6).optional(),
  /**
   * Componentes da vBC do IBS/CBS (Calculadora RTC da RFB), todos com padrão 0 para não virar erro silencioso quando o DIFAL, o monofásico, o II e
   * o ISSQN entrarem no motor: imposto de importação (soma); ICMS e FCP da UF de destino, ICMS monofásico e ISSQN (subtraem).
   * Premissa: quem chama informa os valores já apurados; o motor ainda não os calcula.
   */
  v_ii: CentavosNaoNeg.default(0),
  v_icms_uf_dest: CentavosNaoNeg.default(0),
  v_fcp_uf_dest: CentavosNaoNeg.default(0),
  v_icms_mono: CentavosNaoNeg.default(0),
  v_issqn: CentavosNaoNeg.default(0),
  /**
   * ICMS-ST retido anteriormente (CST 60 / CSOSN 500), da nota de COMPRA do item; nos demais códigos é ignorado. O motor só valida a coerência e repassa
   * (valor retido maior que a base = ENTRADA_INVALIDA). Com consumidor final e `p_icms_efet` na regra, calcula também o ICMS efetivo. Não entra no vST nem no vNF.
   */
  st_retido: StRetido.optional(),
});

export const FonteRegra = z.object({
  tipo: z.enum(['NT', 'convenio', 'anexo', 'lei', 'ajuste_sinief', 'resolucao', 'outro']),
  referencia: z.string(),
});

export const TributoRegra = z.enum(['icms', 'ipi', 'pis', 'cofins', 'ibs_cbs', 'is']);
export type TributoRegra = z.infer<typeof TributoRegra>;
/** IPI de SAÍDA (Manual da NF-e): 50 e 99 tributados; 51..55 sem valor. 00..05 e 49 são de entrada e o motor os recusa. */
export const CST_IPI_TRIBUTADO = ['50', '99'] as const;
export const CST_IPI_SEM_VALOR = ['51', '52', '53', '54', '55'] as const;
export const CST_IPI_ENTRADA = ['00', '01', '02', '03', '04', '05', '49'] as const;

/**
 * RN-FIS-01/04: filtros nulos significam "todos"; fonte e vigência são obrigatórias para a regra valer.
 * Uma regra serve a um tributo de duas formas (a seleção roda separada por tributo):
 *  - linha dedicada: `tributo` = 'ipi' | 'pis' | 'cofins' e os campos daquele tributo (cst_ipi/aliquota_ipi, cst_pis/aliquota_pis ...);
 *    `codigo` (ICMS) é opcional/nulo nessas linhas (obrigatório só quando `tributo` = 'icms', conforme o CHECK do banco);
 *  - linha única (formato do banco): `tributo` = 'icms' e, além do ICMS, os campos de IPI/PIS/COFINS preenchidos; a linha vale
 *    para cada tributo cujo `cst_*` não é nulo.
 */
const RegraBase = z.object({
  id: z.string().uuid(),
  tributo: TributoRegra.default('icms'),
  /** Prefixo de NCM de 2 a 8 dígitos (8 = exato); null = todos. */
  ncm_prefixo: z.string().regex(/^\d{2,8}$/).nullable(),
  uf_origem: Uf.nullable(),
  uf_destino: Uf.nullable(),
  tipo_cliente: TipoContribuinte.nullable(),
  crt: Crt.nullable(),
  cfop: Cfop.nullable(),
  /** CST (2 dígitos) ou CSOSN (3 dígitos) do ICMS; a compatibilidade com o CRT é validada no domínio (RN-FIS-02). Nulo só nas linhas de IPI/PIS/COFINS. */
  codigo: z.string().regex(/^\d{2,3}$/).nullable().default(null),
  mod_bc: z.number().int().min(0).max(3).default(3),
  aliquota_icms: Percentual.nullable().default(null),
  reducao_bc: Percentual.nullable().default(null),
  mod_bc_st: z.number().int().min(0).max(5).nullable().default(null),
  mva_original: Aliquota.nullable().default(null),
  /** MVA ajustada já cadastrada; se ausente e ajustar_mva = true, o motor calcula pela fórmula (interestadual). */
  mva_ajustada: Aliquota.nullable().default(null),
  ajustar_mva: z.boolean().default(false),
  reducao_bc_st: Percentual.nullable().default(null),
  /** Alíquota interna da UF de destino para o ST. */
  aliquota_interna_destino: Percentual.nullable().default(null),
  p_fcp: Percentual.nullable().default(null),
  p_fcp_st: Percentual.nullable().default(null),
  /** Crédito do Simples (CSOSN 101/201/900), vem da faixa do contribuinte. */
  p_cred_sn: Percentual.nullable().default(null),
  /** CST 51: percentual de diferimento (pDif, 4 casas; 1000000 = 100%). Obrigatório nessa regra (sem ele: REGRA_INCOMPLETA). Com `p_fcp` o CST 51 é CODIGO_NAO_SUPORTADO (FCP diferido sem fonte). */
  p_dif: Percentual.nullable().default(null),
  /** CST 60/CSOSN 500 com `st_retido` e consumidor final: pICMSEfet (alíquota efetiva da UF do emitente, 4 casas). Sem ele o grupo do ICMS efetivo não sai. */
  p_icms_efet: Percentual.nullable().default(null),
  /** IPI: CST (2 dígitos), alíquota ad valorem, enquadramento legal (padrão '999') e valor por unidade (×10^4 de real, ver cabeçalho). Alíquota e valor por unidade ao mesmo tempo = regra ambígua (REGRA_INCOMPLETA). */
  cst_ipi: z.string().regex(/^\d{2}$/).nullable().default(null),
  aliquota_ipi: Percentual.nullable().default(null),
  c_enq: z.string().regex(/^\d{3}$/).default('999'),
  valor_unidade_ipi: ValorUnidade4.nullable().default(null),
  /** PIS e COFINS: CST, alíquota (cumulativo 0,65%/3%, não cumulativo 1,65%/7,6%: vêm da regra) e valor por unidade (pauta, ×10^4 de real). */
  cst_pis: z.string().regex(/^\d{2}$/).nullable().default(null),
  aliquota_pis: Percentual.nullable().default(null),
  valor_unidade_pis: ValorUnidade4.nullable().default(null),
  cst_cofins: z.string().regex(/^\d{2}$/).nullable().default(null),
  aliquota_cofins: Percentual.nullable().default(null),
  valor_unidade_cofins: ValorUnidade4.nullable().default(null),
  /**
   * IBS/CBS (NT 2025.002-RTC, gIBSCBS): CST (3 dígitos) e cClassTrib (6 dígitos; os 3 primeiros são o CST, como na tabela oficial), alíquotas de
   * IBS UF, IBS Mun e CBS e as reduções de alíquota (pRedAliq) de IBS (vale para UF e Mun) e de CBS. As alíquotas vêm da regra (ver o cabeçalho do contrato).
   */
  cst_ibs_cbs: z.string().regex(/^\d{3}$/).nullable().default(null),
  c_class_trib: z.string().regex(/^\d{6}$/).nullable().default(null),
  p_ibs_uf: Percentual.nullable().default(null),
  p_ibs_mun: Percentual.nullable().default(null),
  p_cbs: Percentual.nullable().default(null),
  p_red_ibs: Percentual.nullable().default(null),
  p_red_cbs: Percentual.nullable().default(null),
  /** Imposto Seletivo (gIS): CST, cClassTrib, alíquota ad valorem e valor por unidade (×10^4 de real, ad rem). Os dois ao mesmo tempo (combinada) valem só no CST 000: soma das duas. */
  cst_is: z.string().regex(/^\d{3}$/).nullable().default(null),
  c_class_trib_is: z.string().regex(/^\d{6}$/).nullable().default(null),
  p_is: Percentual.nullable().default(null),
  valor_unidade_is: ValorUnidade4.nullable().default(null),
  /** RN-FIS-03: versão da NT 2025.002-RTC em que a regra de IBS/CBS/IS se apoia (aparece na tela de regras). Obrigatória para calcular. */
  versao_nt_rtc: z.string().min(1).nullable().default(null),
  /** Tema 69 do STF: exclui o vICMS do item da BC de PIS/COFINS. Padrão false (BC cheia). */
  excluir_icms_bc: z.boolean().default(false),
  fonte: FonteRegra.nullable(),
  versao: z.string().min(1),
  vigencia_inicio: DataCivil,
  vigencia_fim: DataCivil.nullable(),
});
/** O código de ICMS é obrigatório na linha de ICMS (espelha o CHECK do banco: tributo <> 'icms' OR codigo IS NOT NULL). */
export const RegraTributaria = RegraBase.refine((r) => r.tributo !== 'icms' || r.codigo !== null, { message: "codigo é obrigatório quando tributo = 'icms'", path: ['codigo'] });
export type RegraTributaria = z.infer<typeof RegraTributaria>;

export const CalculoEntrada = z.object({
  emitente: EmitenteCalculo,
  destinatario: DestinatarioCalculo,
  operacao: OperacaoCalculo,
  itens: z.array(ItemCalculo).min(1),
  regras: z.array(RegraTributaria),
});
export type CalculoEntrada = z.infer<typeof CalculoEntrada>;
export type ItemCalculo = z.infer<typeof ItemCalculo>;

export const IcmsItem = z.object({
  orig: OrigemMercadoria,
  cst: z.string().optional(),
  csosn: z.string().optional(),
  mod_bc: z.number().int().optional(),
  p_red_bc: Percentual.optional(),
  v_bc: CentavosNaoNeg.optional(),
  p_icms: Percentual.optional(),
  v_icms: CentavosNaoNeg.optional(),
  mod_bc_st: z.number().int().optional(),
  p_mva_st: Aliquota.optional(),
  p_red_bc_st: Percentual.optional(),
  v_bc_st: CentavosNaoNeg.optional(),
  p_icms_st: Percentual.optional(),
  v_icms_st: CentavosNaoNeg.optional(),
  v_bc_fcp: CentavosNaoNeg.optional(),
  p_fcp: Percentual.optional(),
  v_fcp: CentavosNaoNeg.optional(),
  v_bc_fcp_st: CentavosNaoNeg.optional(),
  p_fcp_st: Percentual.optional(),
  v_fcp_st: CentavosNaoNeg.optional(),
  p_cred_sn: Percentual.optional(),
  v_cred_icms_sn: CentavosNaoNeg.optional(),
  /** CST 51: vICMSOp, pDif e vICMSDif (vICMS = vICMSOp − vICMSDif). */
  v_icms_op: CentavosNaoNeg.optional(),
  p_dif: Percentual.optional(),
  v_icms_dif: CentavosNaoNeg.optional(),
  /** CST 60 / CSOSN 500: ST retido (de `ItemCalculo.st_retido`) e ICMS efetivo. */
  ...StRetido.omit({ p_red_bc_efet: true }).partial().shape,
  p_red_bc_efet: Percentual.optional(),
  v_bc_efet: CentavosNaoNeg.optional(),
  p_icms_efet: Percentual.optional(),
  v_icms_efet: CentavosNaoNeg.optional(),
});
export type IcmsItem = z.infer<typeof IcmsItem>;

export const RegraUsada = z.object({ id: z.string().uuid(), fonte: FonteRegra, versao: z.string() });
/** Regra de IBS/CBS ou de IS usada no item (auditoria, RN-FIS-04). */
export const RegraRtcUsada = RegraUsada.extend({ tributo: z.enum(['ibs_cbs', 'is']), versao_nt_rtc: z.string() });
export type RegraRtcUsada = z.infer<typeof RegraRtcUsada>;

/** Grupos dos lotes 2 e 3, com os campos do Manual (todos opcionais até o lote que os calcula). */
export const IpiItem = z
  .object({ cst: z.string(), c_enq: z.string(), v_bc: CentavosNaoNeg, p_ipi: Percentual, q_unid: z.number(), /** ×10^4 de real */ v_unid: ValorUnidade4, v_ipi: CentavosNaoNeg })
  .partial();
export type IpiItem = z.infer<typeof IpiItem>;
export const PisCofinsItem = z
  .object({ cst: z.string(), v_bc: CentavosNaoNeg, p_aliq: Percentual, q_bc_prod: z.number(), /** ×10^4 de real */ v_aliq_prod: ValorUnidade4, v_valor: CentavosNaoNeg })
  .partial();
export type PisCofinsItem = z.infer<typeof PisCofinsItem>;
/** OBSOLETO (sai no @2): leiaute antigo dos grupos `ibs` e `cbs`. Não é mais preenchido; use `ItemResultado.ibs_cbs`. */
export const IbsCbsItem = z
  .object({
    cst: z.string(),
    c_class_trib: z.string(),
    v_bc: CentavosNaoNeg,
    p_ibs_uf: Percentual,
    v_ibs_uf: CentavosNaoNeg,
    p_ibs_mun: Percentual,
    v_ibs_mun: CentavosNaoNeg,
    p_cbs: Percentual,
    v_cbs: CentavosNaoNeg,
    p_red_aliq: Percentual,
  })
  .partial();
export type IbsCbsItem = z.infer<typeof IbsCbsItem>;
/** gRed da NT: pRedAliq e pAliqEfet (4 casas). */
export const GRed = z.object({ p_red_aliq: Percentual, p_aliq_efet: Percentual });
export type GRed = z.infer<typeof GRed>;
/** gIBSUF, gIBSMun e gCBS (NT 2025.002-RTC): alíquota, redução (só nos CST com redução) e valor. */
export const GIbsUf = z.object({ p_ibs_uf: Percentual, g_red: GRed.optional(), v_ibs_uf: CentavosNaoNeg });
export const GIbsMun = z.object({ p_ibs_mun: Percentual, g_red: GRed.optional(), v_ibs_mun: CentavosNaoNeg });
export const GCbs = z.object({ p_cbs: Percentual, g_red: GRed.optional(), v_cbs: CentavosNaoNeg });
/**
 * Grupo IBSCBS do item no leiaute da NT 2025.002-RTC. Nos CST sem valor (400, 410, 550) saem só cst e c_class_trib. A versão da NT fica em
 * `ItemResultado.versao_nt_rtc`.
 */
export const IbsCbsGrupo = z.object({
  cst: z.string(),
  c_class_trib: z.string(),
  v_bc: CentavosNaoNeg.optional(),
  g_ibs_uf: GIbsUf.optional(),
  g_ibs_mun: GIbsMun.optional(),
  /** vIBS = vIBSUF + vIBSMun. */
  v_ibs: CentavosNaoNeg.optional(),
  g_cbs: GCbs.optional(),
});
export type IbsCbsGrupo = z.infer<typeof IbsCbsGrupo>;
/**
 * gIS: cst_is, cClassTrib, vBCIS, pIS (ad valorem), pISEspec (ad rem, ×10^4 de real por unidade), uTrib, qTrib e vIS.
 */
export const IsItem = z
  .object({ cst_is: z.string(), c_class_trib_is: z.string(), v_bc_is: CentavosNaoNeg, p_is: Percentual, p_is_espec: ValorUnidade4, u_trib: z.string(), q_trib: z.number(), v_is: CentavosNaoNeg })
  .partial();
export type IsItem = z.infer<typeof IsItem>;

/**
 * Imposto (ICMS-ST ou IPI) calculado por regra, em centavos e alíquota de 4 casas (RN-FIS-05, decisão 63 A).
 * Só existe quando houve regra aplicada; o valor 0 COM regra é legítimo (ex.: base reduzida a zero).
 */
export const ImpostoCalculado = z.object({ v_bc: CentavosNaoNeg, p_aliq: Percentual, v_valor: CentavosNaoNeg });
export type ImpostoCalculado = z.infer<typeof ImpostoCalculado>;
/** Total de ICMS-ST ou IPI; omitido se algum item não tem regra (RN-FIS-05). */
export const TotalImpostoCalculado = z.object({ v_bc: CentavosNaoNeg, v_valor: CentavosNaoNeg });
export type TotalImpostoCalculado = z.infer<typeof TotalImpostoCalculado>;
/** Indicador explícito por imposto: true = houve regra aplicada (o grupo `calc_*` do imposto vem junto); false = sem regra (grupo omitido). */
export const RegraAplicada = z.object({ st: z.boolean(), ipi: z.boolean() });
export type RegraAplicada = z.infer<typeof RegraAplicada>;

export const ItemResultado = z.object({
  item_id: z.string(),
  /** RN-FIS-05 (aditivo no @1): indicador de regra aplicada por imposto. Ausente = emissor antigo, sem informação. */
  regra_aplicada: RegraAplicada.optional(),
  /** RN-FIS-05 (aditivo no @1): ICMS-ST e IPI do item por regra. Omitidos sem regra; 0 só com regra. */
  calc_st: ImpostoCalculado.optional(),
  calc_ipi: ImpostoCalculado.optional(),
  icms: IcmsItem,
  /** Reservados: IPI/PIS/COFINS (lote 2) e IBS/CBS/IS (lote 3). */
  ipi: IpiItem.optional(),
  pis: PisCofinsItem.optional(),
  cofins: PisCofinsItem.optional(),
  /** OBSOLETOS (saem no @2): não são mais preenchidos; use `ibs_cbs`. */
  ibs: IbsCbsItem.optional(),
  cbs: IbsCbsItem.optional(),
  /** Grupo IBSCBS no leiaute da NT (lote 3). */
  ibs_cbs: IbsCbsGrupo.optional(),
  is: IsItem.optional(),
  /** Versão da NT 2025.002-RTC usada no item (IBS/CBS/IS), uma vez por item (RN-FIS-03). */
  versao_nt_rtc: z.string().optional(),
  /** CFOP do item (o da entrada), para o faturamento. */
  cfop: Cfop.optional(),
  /** RF-FIS-04: vTotTrib do item e a abertura por esfera, com a versão e a fonte da tabela (DANFE). */
  v_tot_trib: CentavosNaoNeg.optional(),
  carga_aproximada: CargaAproximadaItem.optional(),
  regra: RegraUsada,
  /** Auditoria (RN-FIS-04): regras de IBS/CBS e IS usadas no item, com fonte e versão da regra e da NT. */
  regras_rtc: z.array(RegraRtcUsada).optional(),
});
export type ItemResultado = z.infer<typeof ItemResultado>;

export const TotaisCalculo = z.object({
  v_bc: CentavosNaoNeg,
  v_icms: CentavosNaoNeg,
  v_bc_st: CentavosNaoNeg,
  v_st: CentavosNaoNeg,
  v_fcp: CentavosNaoNeg,
  v_fcp_st: CentavosNaoNeg,
  /** vFCPSTRet (W06b): soma do FCP-ST retido dos itens; só sai se algum item o traz. Fora do vNF (já pago na compra). */
  v_fcp_st_ret: CentavosNaoNeg.optional(),
  v_prod: CentavosNaoNeg,
  v_desc: CentavosNaoNeg,
  v_frete: CentavosNaoNeg,
  v_seg: CentavosNaoNeg,
  v_outro: CentavosNaoNeg,
  v_ipi: CentavosNaoNeg,
  /** vProd − vDesc + vFrete + vSeg + vOutro + vST + vFCPST + vIPI. Não soma IBS/CBS/IS (ver o cabeçalho do contrato). */
  v_nf: CentavosNaoNeg,
  v_cred_icms_sn: CentavosNaoNeg,
  /** Lotes 2 e 3: opcionais para não quebrar o @1. */
  v_pis: CentavosNaoNeg.optional(),
  v_cofins: CentavosNaoNeg.optional(),
  /** IBSCBSTot (NT 2025.002-RTC): base, IBS UF, IBS Mun, IBS total e CBS. */
  v_bc_ibs_cbs: CentavosNaoNeg.optional(),
  v_ibs_uf: CentavosNaoNeg.optional(),
  v_ibs_mun: CentavosNaoNeg.optional(),
  v_ibs: CentavosNaoNeg.optional(),
  v_cbs: CentavosNaoNeg.optional(),
  v_is: CentavosNaoNeg.optional(),
  /** vNFTot da NT: total da NF com IBS, CBS e IS por fora = vNF + vIBS + vCBS + vIS. Só sai quando há IBS/CBS ou IS no documento. */
  v_nf_tot: CentavosNaoNeg.optional(),
  v_tot_trib: CentavosNaoNeg.optional(),
  /** RN-FIS-05 (aditivo no @1): total de ST e de IPI por regra. Omitidos se algum item não tem regra (os `v_st` e `v_ipi` acima continuam). */
  calc_st: TotalImpostoCalculado.optional(),
  calc_ipi: TotalImpostoCalculado.optional(),
});
export type TotaisCalculo = z.infer<typeof TotaisCalculo>;

export const CodigoErroFiscal = z.enum([
  'REGRA_NAO_ENCONTRADA',
  'REGRA_EMPATE',
  'REGRA_SEM_FONTE',
  'REGRA_FORA_DA_VIGENCIA',
  'CODIGO_INCOMPATIVEL_CRT',
  'CODIGO_NAO_SUPORTADO',
  'REGRA_INCOMPLETA',
  'BASE_NEGATIVA',
  /** Lote 2: CST de PIS/COFINS incompatível com o regime (cumulativo/não cumulativo). */
  'CODIGO_INCOMPATIVEL_REGIME',
  /** Lote 4: dado da ENTRADA incoerente (ex.: ST retido com valor maior que a base), diferente de erro de cadastro da regra. */
  'ENTRADA_INVALIDA',
]);
export const ErroFiscal = z.object({
  rn: z.string().regex(/^RN-FIS-\d{2}$/),
  codigo: CodigoErroFiscal,
  mensagem: z.string(),
  item_id: z.string().optional(),
  regra_ids: z.array(z.string()).optional(),
});
export type ErroFiscal = z.infer<typeof ErroFiscal>;

export const CalculoSaida = z.object({
  operacao: z.enum(['interna', 'interestadual']),
  itens: z.array(ItemResultado),
  totais: TotaisCalculo,
}).superRefine((c, ctx) => {
  // RN-FIS-05: o indicador `regra_aplicada` e o grupo `calc_*` andam juntos; o total só existe se todos os itens têm regra.
  for (const imp of ['st', 'ipi'] as const) {
    const key = `calc_${imp}` as const;
    c.itens.forEach((it, i) => {
      const aplicada = it.regra_aplicada?.[imp] === true;
      if (aplicada !== (it[key] !== undefined)) ctx.addIssue({ code: 'custom', path: ['itens', i, key], message: `RN-FIS-05: ${key} só com regra_aplicada.${imp} = true` });
    });
    const todos = c.itens.length > 0 && c.itens.every((it) => it.regra_aplicada?.[imp] === true);
    if (todos !== (c.totais[key] !== undefined)) ctx.addIssue({ code: 'custom', path: ['totais', key], message: `RN-FIS-05: total ${key} só se todos os itens têm regra` });
  }
});
export type CalculoSaida = z.infer<typeof CalculoSaida>;

/** Resultado do cálculo para quem o consome por sequência de item (adaptador do fiscal/api, porta do faturamento): aditivo no @1; `cfops` por sequência. */
export type ResultadoCalculoFiscal =
  | { ok: true; saida: CalculoSaida; cfops: Record<number, string> }
  | { ok: false; erros: ErroFiscal[] };

/** Erro de negócio é resultado tipado, nunca exceção. */
export const CalculoResultado = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), valor: CalculoSaida }),
  z.object({ ok: z.literal(false), erros: z.array(ErroFiscal).min(1) }),
]);
export type CalculoResultado = z.infer<typeof CalculoResultado>;
