/**
 * RN-CAD-17: só as unidades KG e M aceitam quantidade fracionária (até 4 casas); as demais, só inteiros.
 * Única definição da regra: o pedido (manual e do FDV), a carga e o cadastro importam `validarFracaoDaQuantidade`.
 * Quantidade em × 10^4 (D11, inteira pelo `Qtd4`): é inteira quando é múltipla de 10_000.
 */
const UNIDADES_FRACIONAVEIS: readonly string[] = ['KG', 'M'];
const ESCALA_QTD = 10_000;
const MOTIVO_FRACAO_NAO_ACEITA = 'Fração só em KG e M: use quantidade inteira';

const quantidadeAceitaFracao = (unidade: string | null | undefined): boolean =>
  UNIDADES_FRACIONAVEIS.includes((unidade ?? '').trim().toUpperCase());

/** RN-CAD-17: confere a quantidade (× 10^4) contra a unidade. Fração em unidade que não a aceita volta `ok: false` com o motivo. */
export function validarFracaoDaQuantidade(unidade: string | null | undefined, quantidade: number): { ok: true } | { ok: false; motivo: string } {
  if (quantidade % ESCALA_QTD === 0 || quantidadeAceitaFracao(unidade)) return { ok: true };
  return { ok: false, motivo: MOTIVO_FRACAO_NAO_ACEITA };
}
