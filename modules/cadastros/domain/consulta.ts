/** RN-CAD-05: consulta externa é sugestão; o cache (24 h) nunca guarda sócios, contatos de pessoa nem CPF. */
export const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
export const TIMEOUT_FONTE_MS = 5000;

export const expiraEm = (consultadoEm: Date): Date => new Date(consultadoEm.getTime() + TTL_CACHE_MS);
export const cacheValido = (expira: Date, agora: Date): boolean => expira.getTime() > agora.getTime();

/** Tira CPF (11 dígitos, com ou sem máscara) de um texto: a razão social do MEI traz o CPF do titular. */
export function removerCpf(texto: string): string {
  return texto
    .replace(/(?<![\d.\-/])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d.\-/])/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const CAMPOS_PESSOAIS = /^(qsa|socios|quadro_societario|email|e_mail|ddd_telefone_\d|telefone|telefones|cpf|.*cpf.*)$/i;

/** Resposta de CNPJ como vai ao cache: sem quadro de sócios, sem e-mail e telefone, sem CPF em texto. */
export function paraCacheCnpj(resposta: unknown): unknown {
  if (Array.isArray(resposta)) return resposta.map(paraCacheCnpj);
  if (resposta && typeof resposta === 'object') {
    return Object.fromEntries(
      Object.entries(resposta)
        .filter(([k]) => !CAMPOS_PESSOAIS.test(k))
        .map(([k, v]) => [k, paraCacheCnpj(v)]),
    );
  }
  return typeof resposta === 'string' ? removerCpf(resposta) : resposta;
}
