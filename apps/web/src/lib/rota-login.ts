import { CODIGO_SUPERADMIN_LOGIN } from '@macuxierp/platform-sdk';

/**
 * Login único na raiz (v0.3.27, decisão 42 = A): a tela de login é "/" quando não há sessão. `ROTA_TELA_LOGIN` do platform-sdk
 * ainda vale '/login' (o engenheiro-software troca para '/' depois deste PR); enquanto isso o web usa esta constante, e '/login'
 * segue como redirect 308 para '/' (next.config.ts), então os dois caminhos chegam ao mesmo lugar. Sem laço: '/' nunca redireciona a si mesmo.
 */
export const ROTA_LOGIN = '/';

/** Login com o código da plataforma já preenchido (fragmento que só o navegador lê): para onde o /config sem sessão volta. */
export const ROTA_LOGIN_SUPERADMIN = `${ROTA_LOGIN}#codigo=${CODIGO_SUPERADMIN_LOGIN}`;
