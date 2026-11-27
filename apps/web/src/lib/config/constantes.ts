/** Constantes da sessão do portal /config (sem Next). */
import { ROTA_LOGIN } from '../rota-login';

export const COOKIE_CONFIG_WEB = 'mx_config';
export const PATH_CONFIG = '/config';
/** Sem sessão de superadmin, o login é a raiz (v0.3.27, decisão 42 = A); /config/entrar e /login só redirecionam (308) para lá. */
export const ROTA_ENTRAR = ROTA_LOGIN;
export const ROTA_ENCERRAR = '/config/sessao/encerrar';
export const ROTA_SENHA = '/config/senha';

