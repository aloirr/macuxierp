/**
 * Login único na raiz (v0.3.27, decisão 42 = A): a tela de login é "/" quando não há sessão. '/login' segue como redirect
 * 308 para '/' (next.config.ts). Sem laço: '/' nunca redireciona a si mesmo. Desde a ADR 0021 o login não tem código da
 * empresa: o /config sem sessão volta a "/" sem fragmento.
 */
export const ROTA_LOGIN = '/';
