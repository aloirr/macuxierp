/** Plugin de rotas do core. A API troca a linha do core em `apps/api/src/modulos.ts` por `criarPluginCore(deps)`. */
import { lerChaveMestra } from '@macuxierp/platform-sdk';

export { LeitorPfxTls } from './leitor-pfx';
export { PfxInvalido } from './portas';
export type { DependenciasCore, DadosPfx, LeitorPfx, RepositorioCore } from './portas';
export { RepositorioCoreSql } from './repositorio-sql';
export { criarPluginCore } from './rotas';
export { cifrarColunasA1 } from './colunas-a1';
export { criarPortaA1 } from './porta-a1';
export const lerChaveA1 = (valor: string | undefined): Buffer => lerChaveMestra('MACUXIERP_CHAVE_A1', valor);
// RN-CORE-06: usado pelo worker
export { alertaVencimento, diasParaVencer } from '../domain/certificado';
// RN-CORE-13: usado pela rota "esqueci a senha" da apps/api
export { avaliarPedidoSenhaEsquecida, expiraEm, temporariaValida } from '../domain/senha-esquecida';
// RN-CORE-15: conta bloqueada (a apps/api não importa o domain).
export { avaliarEntrada, RESPOSTA_CONTA_BLOQUEADA, TEXTO_CONTA_DESBLOQUEADA, type ResultadoEntrada } from '../domain/conta-bloqueada';
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
// RN-CORE-14 (T-0100): consumidor de `cadastros.filial.alterada@1`, ligado no worker
export { criarConsumidorEmpresaDaFilial, EVENTO_FILIAL_ALTERADA, ID_CONSUMIDOR_EMPRESA_DA_FILIAL } from './consumidor-empresa-da-filial';
// Plugin de plataforma do portal /config (ADR 0012)
export { criarPluginPlataformaCore, type ConsultaNfeProducao, type DependenciasPlataformaCore, type RepositorioPlataforma } from './plataforma';
export { RepositorioPlataformaSql } from './repositorio-plataforma-sql';
