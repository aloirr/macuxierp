import type { ErroFiscal } from '../contracts';

/** Códigos de erro de negócio dos cálculos por item (ICMS, IPI, PIS, COFINS). Comum a todos os tributos. */
export type CodigoErroCalculo = Extract<ErroFiscal['codigo'], 'CODIGO_NAO_SUPORTADO' | 'REGRA_INCOMPLETA' | 'BASE_NEGATIVA' | 'CODIGO_INCOMPATIVEL_REGIME' | 'CODIGO_INCOMPATIVEL_CRT' | 'ENTRADA_INVALIDA'>;
