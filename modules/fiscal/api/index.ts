/** Só o que o apps/api liga (README do fiscal); o resto é interno do módulo. */
export { criarCalculoFiscal } from './calculo';
export type { CalculoFiscalDoFiscal, DepsCalculoFiscal, EntradaCalculoDoFiscal } from './calculo';
export type { ConsultaEmitenteFiscal, EmitenteFiscal, RepositorioFiscal } from './portas';
export { criarPluginFiscal, dependenciasRegrasDeProducao } from './plugin';
export { criarRotasRegras, hojeNoFuso } from './regras';
export type { DependenciasRegras, FiltroListaRegras, RepositorioCatalogo, RepositorioRegras } from './regras-portas';
