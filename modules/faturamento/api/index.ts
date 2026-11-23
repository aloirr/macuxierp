import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import { criarRotas, type DepsRotas } from './rotas';

/** Só o que o README liga no apps/api e no apps/worker; o resto é interno do módulo. */
export { criarConsumidorPedidoAprovado } from './consumidor';
export type {
  A1DaFilial, AmbienteFiscalDaFilial, CalculoFiscal, ClienteDestinatario, CondicaoDoPedido, ConsultaA1Ativo, ConsultaCadastrosFaturamento,
  EntradaCalculoFiscal, EventoRegistro, FilialEmissora, PortaDanfe, InutilizacaoRegistro, NotaEmAberto, PedidosAprovados, RepositorioEventos, RepositorioNotas, ResultadoA1Ativo,
  ConfiguracaoFaturamento, EpecPendenteRegistro, RepositorioContingencia, RepositorioTitulos, ResultadoCalculoFiscal, SituacaoPedidoDoPedido,
} from './portas';
export { verificarAtivosDanfe, type ResultadoAtivosDanfe } from './ativos-marca';
export { repositoriosSql } from './sql';
export { consultaTitulosPedido, criarServicoTitulos, criarVarreduraTitulos, gerarTitulosDaNota, gerarTitulosSeguro, cancelarTitulosDaNotaCancelada, type LogFaturamento } from './titulos';
export { criarProcessadorEventos, type DepsProcessadorEventos, type ResultadoConsultaNota, type ResultadoEventoProcessado, type ResultadoInutilizacaoProcessada } from './processador-eventos';
export { criarTransmissor, type DepsTransmissor, type ResultadoTransmissao } from './transmissor';

/**
 * FÁBRICA DA API (apps/api). Dependências do plugin: as portas da emissão (adaptadores de pedido, cadastros, fiscal, `repositoriosSql`), o `emissor` só para
 * `montar`, `certificado.temA1Ativo` (veredito sobre metadados, `A1ValidoDaFilial` do core, também nos eventos) e `eventos` (pedidos `pendente`). NÃO tem `lerA1`
 * nem assinatura: o `macuxierp_app` não lê o A1 decifrado (ADR 0005 item 4). As fábricas do WORKER são `criarTransmissor` e `criarProcessadorEventos` (acima),
 * com `lerA1`, o emissor completo e o seletor de transporte.
 */
export type DependenciasFaturamento = DepsRotas;

export function criarPluginFaturamento(deps: DependenciasFaturamento): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}
