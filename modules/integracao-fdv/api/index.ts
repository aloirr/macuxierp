export { AGENDA_CONECTOR_ID, criarAgendaConector, type DepsAgendaConector } from './agenda-conector';
export { CONSUMIDOR_PUBLICAR_CADASTROS, EVENTOS_CADASTROS_PUBLICADOS, criarConsumidorPublicarCadastros, type DepsConsumidorCadastros } from './consumidor-cadastros';
export { AGENDA_BUSCA_PEDIDOS_ID, AGENDA_RETORNO_PEDIDOS_ID, criarAgendasPedidosFdv, type DepsAgendasPedidosFdv } from './agendas-pedidos';
export { criarConsumidorRetornoPedido } from './retorno-pedidos';
export { AGENDA_BUSCA_CLIENTES_ID, AGENDA_RETORNO_CLIENTES_ID, criarAgendasClientesFdv, type DepsAgendasClientesFdv } from './agendas-clientes';
export { ROTINA_EXPURGO_PRE_CADASTRO, expurgarPreCadastro, type DepsExpurgoPreCadastro, type ResumoExpurgoPreCadastro } from './expurgo-pre-cadastro';
export { criarConsultaVendedorFdv } from './consulta-vendedor';
export { criarPluginIntegracaoFdv } from './plugin';
export type { ResolvedorChaveErp, RecebedorPedidoFdv, CriadorClienteFdv, Alertar } from './portas';
export {
  criarPluginPlataformaIntegracaoFdv, paraPlataforma, repositorioPortalSql,
  type DependenciasPlataformaIntegracaoFdv, type EstadoPortal, type RepositorioPortalIntegracaoFdv,
} from './plataforma';
