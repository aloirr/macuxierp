import { lerPreenchimentoLogin } from '@macuxierp/platform-sdk';

/**
 * Valores iniciais da tela de login única na raiz. Só no navegador; nada vai à URL do servidor nem a log.
 * O fragmento `#codigo=…&email=…` vem do link do e-mail (`urlEntrarPreenchida` do SDK) e do /config sem sessão
 * (`ROTA_LOGIN_SUPERADMIN`); o navegador não o envia ao servidor e quem lê é o `lerPreenchimentoLogin` do SDK.
 * A senha nunca vem no link. Ordem: o fragmento; depois, o código salvo do BKO.
 */
export function valoresIniciaisLogin(e: { salvo: string | undefined; fragmento: string }): { empresa: string; email: string } {
  const f = lerPreenchimentoLogin(e.fragmento);
  return { empresa: f.codigo ?? e.salvo ?? '', email: f.email ?? '' };
}
