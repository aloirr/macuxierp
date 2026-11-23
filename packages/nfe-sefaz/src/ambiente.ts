/**
 * Ambiente, modo de emissão e UF da NF-e modelo 55, layout 4.00 (Manual de Orientação do Contribuinte).
 * Desenho: docs/desenho/T-0045.md, seção 2.
 */
import { z } from 'zod';

/** Ambiente fiscal da filial emissora (o mesmo enum de `core.ambiente_fiscal`, RN-CORE-08). */
export const AmbienteFiscal = z.enum(['homologacao', 'producao']);
export type AmbienteFiscal = z.infer<typeof AmbienteFiscal>;

/** `tpAmb` do XML: 1 = produção, 2 = homologação. */
export const TpAmb = z.union([z.literal(1), z.literal(2)]);
export type TpAmb = z.infer<typeof TpAmb>;

export const TP_AMB = Object.freeze({ producao: 1, homologacao: 2 } as const satisfies Record<AmbienteFiscal, TpAmb>);

/**
 * `xNome` do destinatário em homologação (`tpAmb` 2): o texto que o Manual exige (regra de validação E04; RN-FAT-04).
 * Fonte única para quem monta a NF-e (emissor, faturamento) e para os documentos de teste (RD-0254).
 */
export const XNOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

/**
 * Modo de emissão que passa pelo transporte da AUTORIZAÇÃO. `normal` vai ao autorizador da UF; `svc-an` e `svc-rs` são
 * as contingências on-line (SEFAZ Virtual). A EPEC (tpEmis 4) não é modo de transporte da autorização: o evento 110140
 * vai ao Ambiente Nacional pelo `escolherDestinoEpec` e, na volta à normal, a NF-e com tpEmis 4 segue pelo modo
 * `normal` (ADR 0011). FS-DA (tpEmis 5) fica fora da v1.
 */
export const ModoEmissao = z.enum(['normal', 'svc-an', 'svc-rs']);
export type ModoEmissao = z.infer<typeof ModoEmissao>;

/** `tpEmis` do XML para cada modo. */
export const TP_EMIS = Object.freeze({ normal: 1, 'svc-an': 6, 'svc-rs': 7 } as const satisfies Record<ModoEmissao, number>);

/**
 * Modalidades de contingência da v1 (ADR 0011; RN-FAT-05): a SVC da UF ou a EPEC. A decisão de entrar é do operador;
 * o sistema só sugere. FS-DA fora da v1.
 */
export const ModalidadeContingencia = z.enum(['svc-an', 'svc-rs', 'epec']);
export type ModalidadeContingencia = z.infer<typeof ModalidadeContingencia>;

/** `tpEmis` da NF-e emitida em EPEC. */
export const TP_EMIS_EPEC = 4;

/**
 * `tpEmis` de cada modalidade: 4 = EPEC, 6 = SVC-AN, 7 = SVC-RS. CERTO (conferência do modulo-fiscal, 22/11/2026, 07h12,
 * pelo XSD do PL_010g); 2, 3, 5 e 9 ficam fora da v1 (ADR 0011).
 */
export const TP_EMIS_CONTINGENCIA = Object.freeze({
  'svc-an': TP_EMIS['svc-an'],
  'svc-rs': TP_EMIS['svc-rs'],
  epec: TP_EMIS_EPEC,
} as const satisfies Record<ModalidadeContingencia, number>);

/** `tpEmis` que o ERP emite na v1: normal, EPEC, SVC-AN e SVC-RS (ADR 0011). */
export const TpEmis = z.union([
  z.literal(TP_EMIS.normal),
  z.literal(TP_EMIS_EPEC),
  z.literal(TP_EMIS['svc-an']),
  z.literal(TP_EMIS['svc-rs']),
]);
export type TpEmis = z.infer<typeof TpEmis>;

/**
 * `tpEmis` que cada modo de transporte da autorização aceita. O autorizador normal recebe a nota normal e a nota
 * EPEC transmitida na volta (RN-FAT-09); a SVC recebe só a própria (570 no resto). Fonte única para o transporte
 * real (trava antes de sair) e para o simulador (570).
 */
export const TP_EMIS_ACEITOS = Object.freeze({
  normal: Object.freeze([TP_EMIS.normal, TP_EMIS_EPEC]),
  'svc-an': Object.freeze([TP_EMIS['svc-an']]),
  'svc-rs': Object.freeze([TP_EMIS['svc-rs']]),
} as const satisfies Record<ModoEmissao, readonly TpEmis[]>);

/** `cOrgao` do Ambiente Nacional (RFB), destino do evento EPEC 110140. FORTE (fiscal, 22/11/2026): NT 2013.004. */
export const C_ORGAO_AN = 91;

/**
 * Prazo para transmitir à SEFAZ normal a NF-e emitida em EPEC: 168 horas CONTADAS DA AUTORIZAÇÃO DO EPEC (não da
 * emissão nem do encerramento da contingência). FORTE (fiscal, 22/11/2026, 07h12): Ajuste SINIEF 07/05. A nota da SVC
 * não é retransmitida (FORTE, conferência do fiscal). Fonte única do número (ADR 0011): o faturamento usa esta constante pelo subcaminho
 * puro `@macuxierp/nfe-sefaz/contingencia`.
 */
export const PRAZO_TRANSMISSAO_EPEC_HORAS = 168;

export const Uf = z.enum([
  'RO', 'AC', 'AM', 'RR', 'PA', 'AP', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL',
  'SE', 'BA', 'MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS', 'MS', 'MT', 'GO', 'DF',
]);
export type Uf = z.infer<typeof Uf>;

/** `cUF` (código IBGE da UF) usado na chave de acesso e no `cUF`/`cOrgao` dos pedidos. */
export const CUF = Object.freeze({
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
  SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
} as const satisfies Record<Uf, number>);
