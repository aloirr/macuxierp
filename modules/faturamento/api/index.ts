import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import type { DepsEmissao } from './emissao';
import { criarRotas } from './rotas';

/** Só o que o README liga no apps/api e no apps/worker; o resto é interno do módulo. */
export { criarConsumidorPedidoAprovado } from './consumidor';
export type {
  A1DaFilial, AmbienteFiscalDaFilial, CalculoFiscal, ClienteDestinatario, CondicaoDoPedido, ConsultaCadastrosFaturamento,
  EntradaCalculoFiscal, FilialEmissora, NotaEmAberto, PedidosAprovados, RepositorioNotas, ResultadoCalculoFiscal, SituacaoPedidoDoPedido,
} from './portas';
export { repositoriosSql } from './sql';
export { criarTransmissor, type DepsTransmissor, type ResultadoTransmissao } from './transmissor';

/** Dependências do plugin: as portas da emissão (a API monta com os adaptadores de pedido, cadastros, fiscal e `repositoriosSql`). */
export type DependenciasFaturamento = DepsEmissao;

export function criarPluginFaturamento(deps: DependenciasFaturamento): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}
