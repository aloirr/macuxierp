import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { criarRotasRegras } from './regras';
import type { DependenciasRegras } from './regras-portas';
import { repositorioCatalogoSql, repositorioRegrasSql } from './regras-sql';

/** Dependências de produção: SQL na transação do tenant. */
export const dependenciasRegrasDeProducao: DependenciasRegras = { regras: repositorioRegrasSql, catalogo: repositorioCatalogoSql };

/** Plugin `/v1/fiscal` (T-0127). A apps/api o registra em `modulos.ts` no lugar de `SEM_ROTAS` (pedido ao engenheiro-software). */
export function criarPluginFiscal(deps: DependenciasRegras = dependenciasRegrasDeProducao): PluginModulo {
  return definirPlugin(manifest, criarRotasRegras(deps));
}
