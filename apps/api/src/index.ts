/** API do Macuxi ERP (Fastify, monólito modular). Entrada do servidor (main) entra com os adaptadores PostgreSQL. */
export { COOKIE_REFRESH, criarApp, type DependenciasApp } from './app';
export { CONFIG_AUTH_PADRAO, ServicoAuth, type ConfigAuth } from './auth/servico';
export type { FilialAuth, RepositorioAuth, SessaoRefresh, TenantAuth, UsuarioAuth } from './auth/portas';
export { gerarHashSenha } from './auth/senha';
export { MODULOS_MONTADOS } from './modulos';
