/** Constantes da sessão do portal /config (sem Next: o proxy também importa). */
export const COOKIE_CONFIG_WEB = 'mx_config';
export const PATH_CONFIG = '/config';
/** Login único (T-0076): sem sessão de superadmin, vai a /login com destino=/config, que preenche o código da plataforma (R-20261127-061730); /config/entrar só redireciona para cá. */
export const ROTA_ENTRAR = '/login?destino=%2Fconfig';
export const ROTA_ENCERRAR = '/config/sessao/encerrar';
export const ROTA_SENHA = '/config/senha';

