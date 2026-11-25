import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { semNotaEmAberto, semTitulos, type ConsultaCadastrosPedido, type Dependencias } from './portas';
import { criarRotas } from './rotas';
import { repositorioSql } from './sql';

export { exportadorPedido, TABELAS_EXPORTADAS } from './exportador';
export { consumidoresDoPedido, type DependenciasConsumidoresPedido } from './consumidor-nota';
export { criarConsultaParaFaturar, type ConsultaParaFaturar } from './faturar';
export type {
  ConsultaCadastrosPedido, ConsultaTitulosPedido, Dependencias, LogPedido, NotaEmAberto, RepoPedidos,
} from './portas';
export { semNotaEmAberto, semTitulos } from './portas';
export { criarRecebedorFdv, type DependenciasRecebedor, type RecebedorPedidoFdv } from './recebedor';
export { criarRotas } from './rotas';
export { repositorioSql } from './sql';

export function criarPluginPedido(deps: Dependencias): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}

/**
 * Dependências de produção do pedido: adaptador SQL, títulos zerados e nota em autorização falsa (F3). A API e o worker só
 * passam a consulta de cadastros (`criarConsultaParaPedido` do `cadastros/api`).
 */
export const dependenciasDeProducao = (cadastros: ConsultaCadastrosPedido, extras: Partial<Pick<Dependencias, 'titulos' | 'notas' | 'log'>> = {}): Dependencias => ({
  repositorios: repositorioSql,
  cadastros,
  titulos: extras.titulos ?? semTitulos,
  notas: extras.notas ?? semNotaEmAberto,
  ...(extras.log ? { log: extras.log } : {}),
});
export { criarAposZerarPedidosSql, type AposZerarPedidos } from './apos-zerar';
export { criarPluginPlataformaPedidoZerar, type DependenciasZerarPedidos, type UsosFaturamentoPedidos } from './zeragem';
