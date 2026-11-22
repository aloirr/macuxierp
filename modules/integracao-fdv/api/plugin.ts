import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { criarRotas, type DependenciasRotas } from './rotas';

export type { DependenciasRotas };

/** Plugin de rotas do módulo. A API monta em `/v1/integracao-fdv` (`apps/api/src/modulos.ts`). */
export function criarPluginIntegracaoFdv(deps: DependenciasRotas): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}
