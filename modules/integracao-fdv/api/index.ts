export { AGENDA_CONECTOR_ID, criarAgendaConector, type DepsAgendaConector } from './agenda-conector';
export { CONSUMIDOR_PUBLICAR_CADASTROS, EVENTOS_CADASTROS_PUBLICADOS, criarConsumidorPublicarCadastros, type DepsConsumidorCadastros } from './consumidor-cadastros';
export { AGENDA_BUSCA_PEDIDOS_ID, AGENDA_RETORNO_PEDIDOS_ID, criarAgendasPedidosFdv, type DepsAgendasPedidosFdv } from './agendas-pedidos';
export { criarConsumidorRetornoPedido } from './retorno-pedidos';
export { criarPluginIntegracaoFdv, type DependenciasRotas } from './plugin';
export type { ResolvedorChaveErp, RecebedorPedidoFdv, Alertar } from './portas';
export {
  criarPluginPlataformaIntegracaoFdv, paraPlataforma, repositorioPortalSql,
  type DependenciasPlataformaIntegracaoFdv, type EstadoPortal, type RepositorioPortalIntegracaoFdv,
} from './plataforma';
