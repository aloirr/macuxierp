/**
 * `@macuxierp/nfe-emissor`: a porta `EmissorNFe` (ADR 0002, opção A) e só o que o faturamento e o worker usam
 * (desenho docs/desenho/T-0018.md §3.1). O resto do pacote é interno.
 */
export type { EmissorNFe } from './porta';
export { criarEmissorNFe } from './emissor';
export { ErroMontagemNFe } from './montar';
export type { NFeMontada, OpcoesMontagem } from './montar';
export { NotaParaEmissao } from './entrada';
export type { NotaParaEmissaoEntrada, ItemNota } from './entrada';
export { assinarDocumento, assinarNFe, ErroAssinaturaNFe } from './assinatura';
export type { DocumentoAssinado } from './assinatura';
export { montarCancelamento, montarCartaCorrecao, montarEpec, montarInutilizacao, PedidoCancelamento, PedidoCartaCorrecao, PedidoEpec, PedidoInutilizacaoEmissor } from './eventos';
export { abrirA1, ErroCertificadoA1 } from './certificado';
export type { CertificadoA1EmMemoria } from './certificado';
export { criarFabricaTransporteEpecSoap, criarFabricaTransporteSoap } from './transporte';
export type { OpcoesTransporteSoap } from './transporte';
