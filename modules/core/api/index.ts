/** Plugin de rotas do core. A API troca a linha do core em `apps/api/src/modulos.ts` por `criarPluginCore(deps)`. */
export { LeitorPfxTls } from './leitor-pfx';
export { PfxInvalido } from './portas';
export type { DependenciasCore, DadosPfx, LeitorPfx, RepositorioCore } from './portas';
export { RepositorioCoreSql } from './repositorio-sql';
export { criarPluginCore } from './rotas';
