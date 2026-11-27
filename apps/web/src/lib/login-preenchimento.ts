import { CODIGO_SUPERADMIN_LOGIN, CodigoEmpresaLogin, EmailUsuario } from '@macuxierp/platform-sdk';

/**
 * Valores iniciais da tela de login única (v0.3.20). Só no navegador; nada vai à URL do servidor nem a log.
 * - B (R-20261127-061730): quem chega pelo /config (`destino` em `/config`) vê o código da plataforma, nunca o último código do
 *   BKO guardado no navegador; sem isso, o mesmo e-mail entrava de novo no BKO.
 * - C2 (decisão 44 B): o link do e-mail traz `#codigo=…&email=…` no FRAGMENTO, que o navegador não envia ao servidor
 *   (nem ao Cloudflare nem à VM). A senha nunca vem no link; se vier, é ignorada.
 */
export interface PreenchimentoLogin { codigo?: string; email?: string }

/** Lê o fragmento do link do e-mail. Valor fora do formato do SDK não entra. */
// Troca pelo `lerPreenchimentoLogin` do SDK quando o PR do engenheiro entrar (mesmo formato).
export function lerFragmentoLogin(hash: string): PreenchimentoLogin {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const codigo = CodigoEmpresaLogin.safeParse(p.get('codigo') ?? '');
  const email = EmailUsuario.safeParse(p.get('email') ?? '');
  return { ...(codigo.success ? { codigo: codigo.data } : {}), ...(email.success ? { email: email.data } : {}) };
}

/** Ordem: o fragmento do e-mail; depois, o destino /config (código da plataforma); por fim, o código salvo do BKO. */
export function valoresIniciaisLogin(e: { destino: string; salvo: string | undefined; fragmento: string }): { empresa: string; email: string } {
  const f = lerFragmentoLogin(e.fragmento);
  const paraConfig = e.destino === '/config' || e.destino.startsWith('/config/');
  return { empresa: f.codigo ?? (paraConfig ? CODIGO_SUPERADMIN_LOGIN : (e.salvo ?? '')), email: f.email ?? '' };
}
