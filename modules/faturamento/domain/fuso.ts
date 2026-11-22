/**
 * Fuso da filial emissora. A chave de acesso e o XML são do `packages/nfe-emissor` (ADR 0002, T-0018): o faturamento só informa
 * o instante UTC e o deslocamento do fuso (`ide.fusoMinutos`) e usa a data civil de Manaus para a vigência das regras fiscais.
 */
/** Manaus (UTC−4, sem horário de verão), em minutos: o `ide.fusoMinutos` da NotaParaEmissao. */
export const FUSO_MANAUS_MINUTOS = -240;

/** Instante deslocado para UTC−4 (Manaus): ler com os getters UTC. */
export const instanteManaus = (instante: Date): Date => new Date(instante.getTime() + FUSO_MANAUS_MINUTOS * 60_000);

/** Data civil (`AAAA-MM-DD`) do instante no fuso de Manaus (RD-0617): único lugar que faz esta conta. */
export const dataCivilManaus = (instante: Date): string => instanteManaus(instante).toISOString().slice(0, 10);
