/**
 * Catálogo único dos motivos de pausa (RD-2321): BKO e /config leem daqui. Texto em pt-BR, sem jargão,
 * conforme a linha "Motivos de pausa" de docs/design/resultado-acao/nomes-integracao.md.
 */

/** Texto único de "sem licença" (ERP e FDV): a API usa o mesmo. */
export const MSG_SEM_LICENCA = 'Integração FDV sem licença nesta empresa. Ligue o módulo na aba Empresa.';

/** Texto para código ou motivo que o catálogo não conhece; nunca ecoa texto do Hub. */
export const MENSAGEM_ERRO_DESCONHECIDO = 'Erro desconhecido. Fale com a Macuxi.';

export const MENSAGENS_PAUSA: Readonly<Record<string, string>> = {
  credencial: 'O FDV recusou a chave do conector. Use "Trocar chave".',
  licenca_fdv: MSG_SEM_LICENCA,
  licenca_erp: MSG_SEM_LICENCA,
  versao: 'O FDV não aceita mais esta versão do conector. Fale com a Macuxi.',
  envelope: 'O FDV recusou o formato do envio. Fale com a Macuxi.',
  idempotencia: 'O FDV recusou um envio repetido. Fale com a Macuxi.',
  topologia: 'Outro conector já envia este cadastro ao FDV. Fale com a Macuxi.',
};

export function mensagemDaPausa(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MENSAGENS_PAUSA[motivo] ?? MENSAGEM_ERRO_DESCONHECIDO;
}
