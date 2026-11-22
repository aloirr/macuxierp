/**
 * Texto de exibição do BKO, num lugar só para os módulos e o shell (RD-0741). Sem dependência de Node e sem import:
 * o shell (`apps/web`) usa por `@macuxierp/platform-sdk/texto` (ou pelo índice do pacote).
 */

/**
 * O número com a palavra no singular ou no plural: 1 → "1 caractere"; 0 e 2 → "0 caracteres" e "2 caracteres" (em
 * português o zero vai no plural; −1 vai no singular). Devolve o número junto porque é o uso dos módulos ("N dias",
 * "N arquivos", "N caracteres a mais"); o verbo que concorda ("falta"/"faltam") fica com quem monta a frase.
 */
export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${Math.abs(n) === 1 ? singular : plural}`;
}
