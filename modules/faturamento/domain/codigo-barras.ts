/**
 * Código de barras CODE-128, conjunto C, da chave de acesso de 44 dígitos no DANFE (RF-FAT-03; MOC, Anexo II). Função pura: devolve as
 * larguras alternadas (barra, espaço, barra...) em módulos; o desenho fica no `api/danfe-pdf.ts`.
 * Símbolo: start C (105), 22 pares de dígitos, checksum (soma ponderada mod 103), stop (106). Cada símbolo tem 11 módulos; o stop, 13.
 */
const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
] as const;
const START_C = 105;
const STOP = 106;

export interface CodigoBarras128C {
  /** Valores dos símbolos: start, pares, checksum e stop. */
  valores: number[];
  /** Larguras alternadas em módulos, começando por uma barra. */
  larguras: number[];
  /** Soma das larguras. */
  modulos: number;
}

export function codigoBarras128C(digitos: string): CodigoBarras128C {
  if (!/^\d+$/.test(digitos) || digitos.length % 2 !== 0) throw new RangeError('CODE-128 C exige dígitos em quantidade par');
  const valores: number[] = [START_C];
  for (let i = 0; i < digitos.length; i += 2) valores.push(Number(digitos.slice(i, i + 2)));
  const soma = valores.reduce((a, v, i) => a + v * (i === 0 ? 1 : i), 0);
  valores.push(soma % 103, STOP);
  const larguras = valores.flatMap((v) => [...PADROES[v]!].map(Number));
  return { valores, larguras, modulos: larguras.reduce((a, b) => a + b, 0) };
}
