/** Plugin de rotas do core. A API troca a linha do core em `apps/api/src/modulos.ts` por `criarPluginCore(deps)`. */
export { LeitorPfxTls } from './leitor-pfx';
export { PfxInvalido } from './portas';
export type { DependenciasCore, DadosPfx, LeitorPfx, RepositorioCore } from './portas';
export { RepositorioCoreSql } from './repositorio-sql';
export { criarPluginCore } from './rotas';
export { criarPortaA1 } from './porta-a1';
export { lerChaveA1 } from './cifra';
// RN-CORE-06: usado pelo worker
export { alertaVencimento, diasParaVencer } from '../domain/certificado';
// Adaptadores SQL das portas do worker (T-0035, T-0040): alerta do A1 e exportação LGPD; leitura do selo do /eu
export {
  avisosA1MaisRecentes,
  destinoAvisosSql,
  exportadorCore,
  fonteCertificadosSql,
  fonteTenantsSql,
  registroExportacoesSql,
  type AvisoA1,
  type CertificadoVencendoLinha,
} from './adaptadores-worker';
// A1 decifrado para o worker assinar a NF-e (ADR 0005).
export { lerA1DecifradoDaFilial, type A1DecifradoDaFilial } from './leitura-a1';
