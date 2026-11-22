/** API do Macuxi ERP (Fastify, monólito modular). A entrada do servidor é `main.ts` (adaptadores PostgreSQL). */
export { COOKIE_REFRESH, criarApp, type DependenciasApp } from './app';
export { CONFIG_AUTH_PADRAO, ServicoAuth, type ConfigAuth } from './auth/servico';
export type { FilialAuth, RepositorioAuth, SessaoRefresh, TenantAuth, UsuarioAuth } from './auth/portas';
export { gerarHashSenha } from './auth/senha';
export { MODULOS_MONTADOS } from './modulos';
