/**
 * Inversos de `interpretarCentavos`/`interpretarQuantidade` para preencher o campo do formulário. Ficam aqui porque o SDK
 * (`@macuxierp/platform-sdk/formatar`) só tem o formato de exibição; estes são do formulário do pedido (sem R$ nem milhar).
 */
import { formatarCentavos } from '@macuxierp/platform-sdk/formatar';

/** `123456` → `1.234,56` (sem o R$). */
export const textoCentavos = (c: number): string => formatarCentavos(c).replace('R$ ', '');

/** `125000` → `12,5`, sem separador de milhar. */
export function textoQuantidade(q: number): string {
  const frac = String(q % 10_000).padStart(4, '0').replace(/0+$/, '');
  return `${Math.trunc(q / 10_000)}${frac ? `,${frac}` : ''}`;
}
