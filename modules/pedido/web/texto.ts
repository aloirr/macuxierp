/**
 * Inversos de `interpretarCentavos`/`interpretarQuantidade` para preencher o campo do formulário. Ficam aqui porque o SDK
 * (`@macuxierp/platform-sdk/formatar`) só tem o formato de exibição; estes são do formulário do pedido (sem R$ nem milhar).
 */
import { formatarCentavos } from '@macuxierp/platform-sdk/formatar';

/** `123456` → `1.234,56` (sem o R$). */
export const textoCentavos = (c: number): string => semPrefixoMoeda(formatarCentavos(c));

/** Tira o `R$` e o espaço que o segue (comum, U+00A0 ou U+202F, conforme o ICU), preservando o sinal negativo. */
export function semPrefixoMoeda(s: string): string {
  const m = /^(-?)\s*(-?)R\$\s*/.exec(s);
  if (!m) return s;
  return `${m[1] || m[2]}${s.slice(m[0].length)}`;
}

/** `125000` → `12,5`, sem separador de milhar. */
export function textoQuantidade(q: number): string {
  const frac = String(q % 10_000).padStart(4, '0').replace(/0+$/, '');
  return `${Math.trunc(q / 10_000)}${frac ? `,${frac}` : ''}`;
}
