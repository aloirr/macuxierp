import { CODIGO_SUPERADMIN_LOGIN, lerPreenchimentoLogin } from '@macuxierp/platform-sdk';
import { PATH_CONFIG } from '@/lib/config/constantes';

/**
 * Valores iniciais da tela de login única (v0.3.20). Só no navegador; nada vai à URL do servidor nem a log.
 * - B (R-20261127-061730): quem chega pelo /config (`destino` em `/config`) vê o código da plataforma, nunca o último código do
 *   BKO guardado no navegador; sem isso, o mesmo e-mail entrava de novo no BKO.
 * - C2 (decisão 44 B): o link do e-mail traz `#codigo=…&email=…` no FRAGMENTO (`urlEntrarPreenchida` do SDK), que o
 *   navegador não envia ao servidor; quem lê é o `lerPreenchimentoLogin` do SDK. A senha nunca vem no link.
 * Ordem: o fragmento do e-mail; depois, o destino /config (código da plataforma); por fim, o código salvo do BKO.
 */
export function valoresIniciaisLogin(e: { destino: string; salvo: string | undefined; fragmento: string }): { empresa: string; email: string } {
  const f = lerPreenchimentoLogin(e.fragmento);
  const paraConfig = e.destino === PATH_CONFIG || e.destino.startsWith(`${PATH_CONFIG}/`);
  return { empresa: f.codigo ?? (paraConfig ? CODIGO_SUPERADMIN_LOGIN : (e.salvo ?? '')), email: f.email ?? '' };
}
