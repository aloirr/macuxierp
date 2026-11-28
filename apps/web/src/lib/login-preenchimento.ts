import { lerPreenchimentoLogin } from '@macuxierp/platform-sdk';

/**
 * Valor inicial da tela de login única na raiz (ADR 0021): só o e-mail. Só no navegador; nada vai à URL do servidor nem a log.
 * O fragmento `#email=…` vem do link do e-mail (`urlEntrarPreenchida` do SDK); o navegador não o envia ao servidor e quem
 * lê é o `lerPreenchimentoLogin` do SDK. A senha nunca vem no link.
 */
export function valoresIniciaisLogin(e: { fragmento: string }): { email: string } {
  return { email: lerPreenchimentoLogin(e.fragmento).email ?? '' };
}
