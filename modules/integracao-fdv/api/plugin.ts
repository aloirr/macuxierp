import { definirPlugin, lerChaveMestra, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { criarRotas, type DependenciasRotas } from './rotas';

export type { DependenciasRotas };

/** Lê `MACUXIERP_CHAVE_INTEGRACAO` (32 bytes, hex ou base64) no arranque do `apps/api`; o erro cita só o nome da variável. */
export const lerChaveIntegracao = (valor: string | undefined): Buffer => lerChaveMestra('MACUXIERP_CHAVE_INTEGRACAO', valor);

/** Plugin de rotas do módulo. A API monta em `/v1/integracao-fdv` (`apps/api/src/modulos.ts`). */
export function criarPluginIntegracaoFdv(deps: DependenciasRotas): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}
