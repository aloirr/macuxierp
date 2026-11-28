/**
 * Regra de marca (decisão 125 B, v0.3.30): nenhuma caixa de mensagem começa com rótulo ("Erro.", "Aviso.",
 * "Atenção.", "Pronto.", "Sucesso."). O tipo é dito pela cor, pelo ícone e por role="alert" ou role="status".
 */
const PREFIXO = /^\s*(erro|aviso|aten[cç][aã]o|pronto|sucesso)\s*[.:!\-–—]/i;

export function temPrefixoProibido(texto: string): boolean {
  return PREFIXO.test(texto);
}

/** Em desenvolvimento e nos testes, falha alto se o texto da caixa começar com rótulo; em produção não faz nada. */
export function exigirSemPrefixo(texto: string, onde: string): void {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return;
  if (temPrefixoProibido(texto)) {
    throw new Error(`${onde}: o texto não pode começar com rótulo (Erro., Aviso., Atenção., Pronto., Sucesso.). A cor e o ícone já dizem o tipo.`);
  }
}
