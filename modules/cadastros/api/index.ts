import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { fontesHttp } from './fontes-http';
import type { Dependencias, PortaCertificados } from './portas';
import { criarRotas } from './rotas';
import { repositoriosSql } from './sql';

export { criarConsumidorCargaInicial, criarExecutorCargaInicial } from './carga-inicial';
export { criarExecutorConsultaIe, type PortaConsultaCadastro } from './executor-ie';
export { exportadorCadastros } from './exportador';
export { fontesHttp } from './fontes-http';
export type { Dependencias, FonteExterna, Fontes, PortaCertificados, Repositorios } from './portas';
export { criarRotas } from './rotas';
export { repositoriosSql } from './sql';

/** Enquanto o core não entrega a porta do A1 (pedido da T-0007), nenhuma filial tem A1 válido: a IE responde 422 RN-CORE-06. */
const semCertificados: PortaCertificados = { filialTemA1Valido: async () => false };

export function criarPluginCadastros(deps: Dependencias): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}

/** Plugin de produção: adaptador SQL na transação do tenant e fontes HTTP reais. A API monta este plugin em `/v1/cadastros`. */
export const plugin: PluginModulo = criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados: semCertificados });
