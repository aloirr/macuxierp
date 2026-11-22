import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';
import { manifest } from '../manifest';
import type { DepsEmissao } from './emissao';
import { criarRotas } from './rotas';

/** Só o que o README liga no apps/api e no apps/worker; o resto é interno do módulo. */
export { criarConsumidorPedidoAprovado } from './consumidor';
export type {
  A1DaFilial, AmbienteFiscalDaFilial, CalculoFiscal, ClienteDestinatario, CondicaoDoPedido, ConsultaA1Ativo, ConsultaCadastrosFaturamento,
  EntradaCalculoFiscal, FilialEmissora, NotaEmAberto, PedidosAprovados, RepositorioNotas, ResultadoA1Ativo, ResultadoCalculoFiscal, SituacaoPedidoDoPedido,
} from './portas';
export { repositoriosSql } from './sql';
export { criarTransmissor, type DepsTransmissor, type ResultadoTransmissao } from './transmissor';

/**
 * FÁBRICA DA API (apps/api). Dependências do plugin: as portas da emissão (adaptadores de pedido, cadastros, fiscal, `repositoriosSql`), o `emissor` só para
 * `montar` e `certificado.temA1Ativo` (metadados). NÃO tem `lerA1` nem assinatura: o `macuxierp_app` não lê o A1 decifrado (ADR 0005 item 4).
 * A fábrica do WORKER é `criarTransmissor` (acima), com `lerA1`, o emissor completo e o seletor de transporte.
 */
export type DependenciasFaturamento = DepsEmissao;

export function criarPluginFaturamento(deps: DependenciasFaturamento): PluginModulo {
  return definirPlugin(manifest, criarRotas(deps));
}
