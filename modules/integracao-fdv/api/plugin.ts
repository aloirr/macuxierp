import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { criarRotas } from './rotas';

/** Plugin de rotas do módulo (só leitura no BKO). A API monta em `/v1/integracao-fdv` (`apps/api/src/modulos.ts`). */
export function criarPluginIntegracaoFdv(): PluginModulo {
  return definirPlugin(manifest, criarRotas());
}
