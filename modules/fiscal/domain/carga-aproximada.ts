import type { CargaAproximada, CargaAproximadaItem, ItemCalculo } from '../contracts';
import { aplicarPercentual, valorOperacao } from './dinheiro';

/**
 * RF-FIS-04 (Lei 12.741/2012, Decreto 8.264/2014, tabela IBPT): valor aproximado dos tributos do item (vTotTrib), para a informação ao consumidor.
 * BC = valorOperacao do item (preço final cobrado, com despesas acessórias e líquido do desconto). Cada esfera é arredondada ao centavo
 * (meio para cima, RN-CORE-03) e o vTotTrib é a soma das esferas, para que o DANFE some igual. Federal: alíquota de importado só para as origens
 * 1, 2, 6 e 7 (estrangeira); as origens 0, 3, 4, 5 e 8 (nacionais, inclusive com conteúdo de importação até 40% ou processo produtivo básico) usam a
 * nacional. A versão e a fonte da tabela voltam no resultado.
 */
export type ResultadoCarga = CargaAproximadaItem & { v_tot_trib: number };

const ORIGEM_IMPORTADA = ['1', '2', '6', '7'];

export function calcularCargaAproximada(item: ItemCalculo, carga: CargaAproximada): ResultadoCarga {
  const bc = Math.max(0, valorOperacao(item));
  const federal = ORIGEM_IMPORTADA.includes(item.origem) ? carga.federal_importado : carga.federal_nacional;
  const v_federal = aplicarPercentual(bc, federal);
  const v_estadual = aplicarPercentual(bc, carga.estadual);
  const v_municipal = aplicarPercentual(bc, carga.municipal);
  return { v_tot_trib: v_federal + v_estadual + v_municipal, v_federal, v_estadual, v_municipal, versao: carga.versao, fonte: carga.fonte };
}
