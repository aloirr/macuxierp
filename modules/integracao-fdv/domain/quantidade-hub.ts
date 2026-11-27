/**
 * T-0097 critério 3 (RN-INF-07, RN-CAD-17; decisão 23 A): o Hub do FDV aceita fração em `ItemFaturado.quantidade` e
 * `ProdutoUnidade.fator` (ADR 0076 do FDV, `fracao_liberada`), com até 4 casas. Só KG e M fracionam; fração em outra unidade
 * é recusada POR REGISTRO com o código `quantidade_fracionaria` e o resto do lote segue. Funções puras, sem cálculo novo.
 */
import { validarFracaoDaQuantidade } from '@macuxierp/cadastros/contracts';
import { casasAte4, ESCALA_4_CASAS } from '../contracts/hub';

/** Fator máximo de `ProdutoUnidade.fator` no Hub (até 9999). */
export const FATOR_MAXIMO_HUB = 9999;

/** Código do erro por linha (catálogo `CATALOGO_ERRO`): fração em unidade que não é KG nem M. */
export const CODIGO_QUANTIDADE_FRACIONARIA = 'quantidade_fracionaria';

/**
 * RN-CAD-17 no envio: o fator em unidades é aceito para a unidade? Inteiro passa em qualquer unidade; fração só em KG e M,
 * e sempre em até 4 casas (mais casas que isso o Hub recusaria).
 */
export function fatorAceitoNoHub(unidade: string | null | undefined, fatorUnidades: number): boolean {
  if (!casasAte4(fatorUnidades)) return false;
  return validarFracaoDaQuantidade(unidade, Math.round(fatorUnidades * ESCALA_4_CASAS)).ok;
}
