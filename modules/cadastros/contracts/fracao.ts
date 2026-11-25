/**
 * RN-CAD-17: só as unidades KG e M aceitam quantidade fracionária (até 4 casas); as demais, só inteiros.
 * Única definição da regra: o pedido (manual e do FDV), a carga e o cadastro importam daqui, sem copiar.
 * Quantidade em × 10^4 (D11): a quantidade é inteira quando é múltipla de 10_000.
 */
export const UNIDADES_FRACIONAVEIS: readonly string[] = ['KG', 'M'];
const ESCALA_QTD = 10_000;

export const MOTIVO_FRACAO_NAO_ACEITA = 'Esta unidade só aceita quantidade inteira (fração só em KG e M)';

/** RN-CAD-17: a unidade (sem diferenciar maiúscula nem espaços nas pontas) aceita fração? */
export function quantidadeAceitaFracao(unidade: string | null | undefined): boolean {
  return UNIDADES_FRACIONAVEIS.includes((unidade ?? '').trim().toUpperCase());
}

export type ResultadoFracao = { ok: true } | { ok: false; motivo: string };

/** RN-CAD-17: confere a quantidade (× 10^4) contra a unidade. Fração em unidade que não a aceita volta `ok: false` com o motivo. */
export function validarFracaoDaQuantidade(unidade: string | null | undefined, quantidade: number): ResultadoFracao {
  if (!Number.isSafeInteger(quantidade)) return { ok: false, motivo: 'Quantidade deve ter no máximo 4 casas decimais' };
  if (quantidade % ESCALA_QTD === 0 || quantidadeAceitaFracao(unidade)) return { ok: true };
  return { ok: false, motivo: MOTIVO_FRACAO_NAO_ACEITA };
}
