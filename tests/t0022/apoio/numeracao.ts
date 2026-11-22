/**
 * T-0022: verificações puras da F4, usadas hoje nos testes da matriz e, quando a base existir (T-0019 a T-0021, T-0045),
 * sobre as notas lidas do banco.
 *
 * - RN-FAT-01 (CLAUDE.md, regra 7): numeração sequencial por série e filial, sem buraco; buraco só por inutilização.
 * - RN-CORE-08 e RN-FAT-04: o simulador só é chamado para filial em homologação; produção é barrada antes da rede.
 *
 * Só tipos de `contracts` (fronteiras): nada de `modules/<x>/domain`, `api` ou `db`.
 */
import type { AmbienteFiscal } from '../../../modules/core/contracts';

/** Chave da numeração: a sequência é independente por tenant, filial emissora e série (RN-FAT-01). */
export interface ChaveSerie {
  tenant: string;
  filial: string;
  serie: number;
}

export interface NumeroEmitido extends ChaveSerie {
  numero: number;
}

/** Faixa inutilizada na SEFAZ (inclusive nas duas pontas), o único buraco permitido. */
export interface FaixaInutilizada extends ChaveSerie {
  inicio: number;
  fim: number;
}

export interface ResultadoSequencia {
  ok: boolean;
  /** Números que faltam entre o início da série e o maior número usado, descontadas as faixas inutilizadas. */
  buracos: number[];
  /** Números usados mais de uma vez (corrida na reserva ou reenvio que gerou número novo). */
  duplicados: number[];
  /** Números que estão numa faixa inutilizada e também foram usados em nota. */
  inutilizadosUsados: number[];
  /** Números fora do intervalo válido da NF-e (1 a 999.999.999, inteiros). */
  invalidos: number[];
  /** Faixas com início maior que o fim ou fora do intervalo válido. */
  faixasInvalidas: Array<{ inicio: number; fim: number }>;
}

export const NUMERO_MAXIMO_NFE = 999_999_999;

const numeroValido = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= NUMERO_MAXIMO_NFE;

/**
 * RN-FAT-01: confere uma única série. A sequência começa em `inicio` (padrão 1) e vai até o maior número emitido,
 * inutilizado ou reservado (`ultimoReservado`, o contador da série no banco; 0 = nada reservado). Todo número do meio
 * tem de estar emitido exatamente uma vez ou inutilizado, nunca os dois. Emitido = nota autorizada, cancelada ou
 * denegada (todas consomem número); a tentativa rejeitada e reenviada com o mesmo número não é linha à parte.
 */
export function conferirSequencia(
  numeros: readonly number[],
  inutilizadas: ReadonlyArray<{ inicio: number; fim: number }> = [],
  inicio = 1,
  ultimoReservado?: number,
): ResultadoSequencia {
  const invalidos = numeros.filter((n) => !numeroValido(n));
  const reservadoValido =
    ultimoReservado === undefined || ultimoReservado === 0 || numeroValido(ultimoReservado);
  if (!reservadoValido) invalidos.push(ultimoReservado);
  const faixasInvalidas = inutilizadas
    .filter((f) => !numeroValido(f.inicio) || !numeroValido(f.fim) || f.inicio > f.fim)
    .map((f) => ({ inicio: f.inicio, fim: f.fim }));

  const contagem = new Map<number, number>();
  for (const n of numeros.filter(numeroValido)) contagem.set(n, (contagem.get(n) ?? 0) + 1);
  const duplicados = [...contagem].filter(([, c]) => c > 1).map(([n]) => n);

  const inutilizado = new Set<number>();
  for (const f of inutilizadas) {
    if (faixasInvalidas.some((x) => x.inicio === f.inicio && x.fim === f.fim)) continue;
    for (let n = f.inicio; n <= f.fim; n++) inutilizado.add(n);
  }
  const inutilizadosUsados = [...contagem.keys()].filter((n) => inutilizado.has(n));

  const reservado = reservadoValido && ultimoReservado !== undefined ? ultimoReservado : 0;
  const topo = Math.max(inicio - 1, reservado, ...contagem.keys(), ...inutilizado);
  const buracos: number[] = [];
  for (let n = inicio; n <= topo; n++) if (!contagem.has(n) && !inutilizado.has(n)) buracos.push(n);

  const ordenar = (xs: number[]) => xs.sort((a, b) => a - b);
  const r = {
    buracos,
    duplicados: ordenar(duplicados),
    inutilizadosUsados: ordenar(inutilizadosUsados),
    invalidos: ordenar(invalidos),
    faixasInvalidas,
  };
  const ok = Object.values(r).every((v) => v.length === 0);
  return { ok, ...r };
}

export const rotuloSerie = (c: ChaveSerie): string => `${c.tenant}/${c.filial}/serie-${c.serie}`;

/**
 * RN-FAT-01 em todas as séries de uma vez: agrupa por tenant, filial e série e confere cada grupo. `ultimosReservados`
 * traz o contador de cada série (`numero` = último reservado), para acusar número reservado no fim sem nota.
 */
export function conferirNumeracaoPorSerie(
  notas: readonly NumeroEmitido[],
  inutilizacoes: readonly FaixaInutilizada[] = [],
  ultimosReservados: readonly NumeroEmitido[] = [],
): Map<string, ResultadoSequencia> {
  const numeros = new Map<string, number[]>();
  const faixas = new Map<string, FaixaInutilizada[]>();
  const reservados = new Map(ultimosReservados.map((r) => [rotuloSerie(r), r.numero]));
  for (const n of notas) numeros.set(rotuloSerie(n), [...(numeros.get(rotuloSerie(n)) ?? []), n.numero]);
  for (const f of inutilizacoes) faixas.set(rotuloSerie(f), [...(faixas.get(rotuloSerie(f)) ?? []), f]);
  const chaves = [...new Set([...numeros.keys(), ...faixas.keys(), ...reservados.keys()])].sort();
  return new Map(
    chaves.map((k) => [
      k,
      conferirSequencia(numeros.get(k) ?? [], faixas.get(k) ?? [], 1, reservados.get(k)),
    ]),
  );
}

/** Ambiente como vem do `core` (contrato `AmbienteFiscal`); ausente = filial sem ambiente lido. */
export type AmbienteDaFilial = Pick<AmbienteFiscal, 'filial_id' | 'ambiente'> | null | undefined;

export type DecisaoSimulador =
  | { permitido: true; tpAmb: 2 }
  | { permitido: false; motivo: 'FILIAL_EM_PRODUCAO' | 'AMBIENTE_DESCONHECIDO' | 'FILIAL_DIFERENTE' };

/**
 * RN-CORE-08 e RN-FAT-04: só homologação (`tpAmb` 2) alcança o simulador. Falha fechada: produção, ambiente ausente,
 * valor fora do enum ou ambiente de outra filial bloqueiam.
 */
export function decidirChamadaAoSimulador(filialId: string, ambiente: AmbienteDaFilial): DecisaoSimulador {
  if (!ambiente) return { permitido: false, motivo: 'AMBIENTE_DESCONHECIDO' };
  if (ambiente.filial_id !== filialId) return { permitido: false, motivo: 'FILIAL_DIFERENTE' };
  if (ambiente.ambiente === 'producao') return { permitido: false, motivo: 'FILIAL_EM_PRODUCAO' };
  if (ambiente.ambiente !== 'homologacao') return { permitido: false, motivo: 'AMBIENTE_DESCONHECIDO' };
  return { permitido: true, tpAmb: 2 };
}

export class EmissaoBloqueadaAntesDaRede extends Error {
  constructor(readonly motivo: Exclude<DecisaoSimulador, { permitido: true }>['motivo']) {
    super(`emissão bloqueada antes da rede: ${motivo}`);
    this.name = 'EmissaoBloqueadaAntesDaRede';
  }
}

/**
 * Guarda só para os testes puros: a função `chamar` só roda depois da decisão. Nas notas reais (N16, N20) o cliente do
 * simulador NÃO passa por aqui: a contagem vem do próprio simulador (chamadas por filial/CNPJ e por tpAmb) e o bloqueio
 * tem de vir da API ou do worker, antes de reservar número e antes da rede; senão o teste provaria o arnês, não o produto.
 */
export async function chamarSimuladorSeHomologacao<T>(
  filialId: string,
  ambiente: AmbienteDaFilial,
  chamar: (tpAmb: 2) => Promise<T>,
): Promise<T> {
  const d = decidirChamadaAoSimulador(filialId, ambiente);
  if (!d.permitido) throw new EmissaoBloqueadaAntesDaRede(d.motivo);
  return chamar(d.tpAmb);
}
