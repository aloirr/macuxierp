/** Constantes da sessão do portal /config (sem Next: o proxy também importa). */
export const COOKIE_CONFIG_WEB = 'mx_config';
export const PATH_CONFIG = '/config';
/** O login é único (T-0076): quem não tem sessão de superadmin volta a `/login` (`/config/entrar` só redireciona para lá). */
export const ROTA_ENTRAR = '/login';
export const ROTA_ENCERRAR = '/config/sessao/encerrar';
export const ROTA_SENHA = '/config/senha';

