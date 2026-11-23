/**
 * Porta `EmissorNFe` (ADR 0002, opção A; desenho docs/desenho/T-0018.md §3.1).
 *
 * O `faturamento` conhece só esta porta; a implementação fica no worker. Ordem da emissão (regra 7):
 * montar → assinar → o CHAMADOR grava os bytes assinados → transmitir → o chamador grava o XML autorizado
 * (`montarNfeProc` do nfe-sefaz) antes de qualquer outra coisa. A porta não grava nada e não lê banco.
 * Cancelamento, CC-e, EPEC e inutilização: a porta monta, assina (`assinarDocumento`) e transmite; a resposta traz também o
 * documento assinado, para o chamador montar o `procEventoNFe` / guardar a inutilização junto com o retorno.
 * O transporte é a porta `SefazTransporte` do `@macuxierp/nfe-sefaz`, obtida do seletor do worker (simulador na F4;
 * SOAP com mTLS, `criarFabricaTransporteSoap`, depois da T-0046).
 */
import type { RespostaAutorizacao, RespostaEvento, RespostaInutilizacao, SefazTransporte, SefazTransporteEpec } from '@macuxierp/nfe-sefaz';
import type { DocumentoAssinado } from './assinatura';
import type { CertificadoA1EmMemoria } from './certificado';
import type { NotaParaEmissaoEntrada } from './entrada';
import type { PedidoCancelamento, PedidoCartaCorrecao, PedidoEpec, PedidoInutilizacaoEmissor } from './eventos';
import type { NFeMontada, OpcoesMontagem } from './montar';

export interface EmissorNFe {
  /** Monta o XML da NF-e 55, leiaute 4.00 + IS/IBS/CBS, sem assinatura. Função pura. */
  montar(nota: NotaParaEmissaoEntrada, opcoes?: OpcoesMontagem): NFeMontada;
  /** Assina com o A1 em memória (XMLDSig enveloped, C14N, RSA-SHA1). */
  assinar(xml: string, a1: CertificadoA1EmMemoria): DocumentoAssinado;
  /** Envia UMA NF-e assinada em lote síncrono pelo transporte do destino. */
  transmitir(xmlAssinado: string, idLote: string, transporte: SefazTransporte): Promise<RespostaAutorizacao>;
  /** Evento 110111: monta, assina (`infEvento`) e transmite. A nota autorizada nunca é editada (regra 7). */
  cancelar(pedido: PedidoCancelamento, a1: CertificadoA1EmMemoria, transporte: SefazTransporte): Promise<RespostaEvento & { assinado: DocumentoAssinado }>;
  /** Evento 110110 (CC-e): monta, assina (`infEvento`) e transmite. */
  cartaCorrecao(pedido: PedidoCartaCorrecao, a1: CertificadoA1EmMemoria, transporte: SefazTransporte): Promise<RespostaEvento & { assinado: DocumentoAssinado }>;
  /**
   * EPEC (110140, ADR 0011): monta o evento da NF-e com tpEmis 4 (`montarEpec`), assina (`infEvento`) e envia ao
   * Ambiente Nacional pelo transporte da EPEC (`criarSeletorEpec`). O chamador guarda o evento assinado e o retorno
   * antes de qualquer outra coisa (RN-FAT-08); a nota só conta como faturada com o evento registrado.
   */
  epec(pedido: PedidoEpec, a1: CertificadoA1EmMemoria, transporte: SefazTransporteEpec): Promise<RespostaEvento & { assinado: DocumentoAssinado }>;
  /** Inutilização da faixa (`infInut`): monta, assina e transmite. Único jeito de abrir buraco na numeração (regra 7). */
  inutilizar(pedido: PedidoInutilizacaoEmissor, a1: CertificadoA1EmMemoria, transporte: SefazTransporte): Promise<RespostaInutilizacao & { assinado: DocumentoAssinado }>;
}
