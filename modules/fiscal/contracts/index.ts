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
 *  - evolução compatível no @1: a RegraTributaria vai ganhar `tributo` (padrão 'icms') nos lotes 2 e 3, e novos códigos de erro
 *    podem surgir; o consumidor deve tratar código de erro desconhecido (mostrar a mensagem e o rn, sem quebrar).
 */

export const CALCULO_VERSAO = 1 as const;

// Centavos: não vem de cadastros porque aqui é inteiro seguro e o piso (não negativo) é aplicado à parte; repetido de propósito (como o TenantId).
const Centavos = z.number().int().safe();
const CentavosNaoNeg = Centavos.nonnegative();
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
  /** IPI do item, quando já calculado (lote 2 passa a calculá-lo aqui dentro). Entra na BC do ICMS/ST conforme o destinatário. */
  ipi_centavos: CentavosNaoNeg.default(0),
});

export const FonteRegra = z.object({
  tipo: z.enum(['NT', 'convenio', 'anexo', 'lei', 'ajuste_sinief', 'resolucao', 'outro']),
  referencia: z.string(),
});

/** RN-FIS-01/04: filtros nulos significam "todos"; fonte e vigência são obrigatórias para a regra valer. */
export const RegraTributaria = z.object({
  id: z.string().uuid(),
  /** Prefixo de NCM de 2 a 8 dígitos (8 = exato); null = todos. */
  ncm_prefixo: z.string().regex(/^\d{2,8}$/).nullable(),
  uf_origem: Uf.nullable(),
  uf_destino: Uf.nullable(),
  tipo_cliente: TipoContribuinte.nullable(),
  crt: Crt.nullable(),
  cfop: Cfop.nullable(),
  /** CST (2 dígitos) ou CSOSN (3 dígitos); a compatibilidade com o CRT é validada no domínio (RN-FIS-02). */
  codigo: z.string().regex(/^\d{2,3}$/),
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
  fonte: FonteRegra.nullable(),
  versao: z.string().min(1),
  vigencia_inicio: DataCivil,
  vigencia_fim: DataCivil.nullable(),
});
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
});
export type IcmsItem = z.infer<typeof IcmsItem>;

export const RegraUsada = z.object({ id: z.string().uuid(), fonte: FonteRegra, versao: z.string() });

/** Grupos dos lotes 2 e 3, com os campos do Manual (todos opcionais até o lote que os calcula). */
export const IpiItem = z
  .object({ cst: z.string(), c_enq: z.string(), v_bc: CentavosNaoNeg, p_ipi: Percentual, v_ipi: CentavosNaoNeg })
  .partial();
export const PisCofinsItem = z.object({ cst: z.string(), v_bc: CentavosNaoNeg, p_aliq: Percentual, v_valor: CentavosNaoNeg }).partial();
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
export const IsItem = z.object({ cst_is: z.string(), c_class_trib_is: z.string(), v_bc_is: CentavosNaoNeg, p_is: Percentual, v_is: CentavosNaoNeg }).partial();

export const ItemResultado = z.object({
  item_id: z.string(),
  icms: IcmsItem,
  /** Reservados: IPI/PIS/COFINS (lote 2) e IBS/CBS/IS (lote 3). */
  ipi: IpiItem.optional(),
  pis: PisCofinsItem.optional(),
  cofins: PisCofinsItem.optional(),
  ibs: IbsCbsItem.optional(),
  cbs: IbsCbsItem.optional(),
  is: IsItem.optional(),
  regra: RegraUsada,
});
export type ItemResultado = z.infer<typeof ItemResultado>;

export const TotaisCalculo = z.object({
  v_bc: CentavosNaoNeg,
  v_icms: CentavosNaoNeg,
  v_bc_st: CentavosNaoNeg,
  v_st: CentavosNaoNeg,
  v_fcp: CentavosNaoNeg,
  v_fcp_st: CentavosNaoNeg,
  v_prod: CentavosNaoNeg,
  v_desc: CentavosNaoNeg,
  v_frete: CentavosNaoNeg,
  v_seg: CentavosNaoNeg,
  v_outro: CentavosNaoNeg,
  v_ipi: CentavosNaoNeg,
  /** Parcial no lote 1: vProd − vDesc + vFrete + vSeg + vOutro + vST + vFCPST + vIPI informado. */
  v_nf: CentavosNaoNeg,
  v_cred_icms_sn: CentavosNaoNeg,
  /** Lotes 2 e 3: opcionais para não quebrar o @1. */
  v_pis: CentavosNaoNeg.optional(),
  v_cofins: CentavosNaoNeg.optional(),
  v_ibs: CentavosNaoNeg.optional(),
  v_cbs: CentavosNaoNeg.optional(),
  v_is: CentavosNaoNeg.optional(),
  v_tot_trib: CentavosNaoNeg.optional(),
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
});
export type CalculoSaida = z.infer<typeof CalculoSaida>;

/** Erro de negócio é resultado tipado, nunca exceção. */
export const CalculoResultado = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), valor: CalculoSaida }),
  z.object({ ok: z.literal(false), erros: z.array(ErroFiscal).min(1) }),
]);
export type CalculoResultado = z.infer<typeof CalculoResultado>;
