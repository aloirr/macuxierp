/** Plugin de rotas do core. A API troca a linha do core em `apps/api/src/modulos.ts` por `criarPluginCore(deps)`. */
export { LeitorPfxTls } from './leitor-pfx';
export { PfxInvalido } from './portas';
export type { DependenciasCore, DadosPfx, LeitorPfx, RepositorioCore } from './portas';
export { RepositorioCoreSql } from './repositorio-sql';
export { criarPluginCore } from './rotas';
export { criarPortaA1 } from './porta-a1';
export { lerChaveA1 } from './cifra';
// Validade e alerta do A1: o worker usa exatamente estas funções (RN-CORE-06, RF-CORE-04).
export { alertaVencimento, diasParaVencer } from '../domain/certificado';
