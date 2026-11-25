/**
 * T-0085 (v0.3.12): enquanto o Hub do FDV só aceita quantidade e fator inteiros (`ItemFaturado.quantidade` e
 * `ProdutoUnidade.fator`, OpenAPI real), o ERP recusa POR REGISTRO o fracionário, com o código `quantidade_fracionaria`,
 * e o resto do lote segue. Funções puras.
 */
const ESCALA_QTD4 = 10_000;

/** Fator máximo de `ProdutoUnidade.fator` no Hub (inteiro, até 9999). */
export const FATOR_MAXIMO_HUB = 9999;

/** Código do erro por linha e do item recusado no retorno de nota (catálogo `CATALOGO_ERRO`). */
export const CODIGO_QUANTIDADE_FRACIONARIA = 'quantidade_fracionaria';

/** Quantidade em Qtd4 (valor × 10000) sem casas decimais? */
export function qtd4InteiraParaHub(qtd4: number): boolean {
  return Number.isFinite(qtd4) && Number.isInteger(qtd4) && qtd4 % ESCALA_QTD4 === 0;
}

/** Valor já em unidades (como vai no payload do lote) sem casas decimais? */
export function unidadesInteirasParaHub(unidades: number): boolean {
  return Number.isFinite(unidades) && qtd4InteiraParaHub(Math.round(unidades * ESCALA_QTD4)) && Number.isInteger(unidades);
}
