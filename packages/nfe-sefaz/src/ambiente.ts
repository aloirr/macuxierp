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
 * Modo de emissão que passa pelo transporte. `normal` vai ao autorizador da UF; `svc-an` e `svc-rs` são as
 * contingências on-line (SEFAZ Virtual). FS-DA (tpEmis 5) e EPEC (tpEmis 4) não entram aqui: a FS-DA não transmite
 * na hora (a nota segue depois pelo modo normal) e o EPEC é evento do Ambiente Nacional, fora da v1 (desenho §2.2).
 */
export const ModoEmissao = z.enum(['normal', 'svc-an', 'svc-rs']);
export type ModoEmissao = z.infer<typeof ModoEmissao>;

/** `tpEmis` do XML para cada modo. */
export const TP_EMIS = Object.freeze({ normal: 1, 'svc-an': 6, 'svc-rs': 7 } as const satisfies Record<ModoEmissao, number>);

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
