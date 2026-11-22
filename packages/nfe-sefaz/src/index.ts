/**
 * @macuxierp/nfe-sefaz — contrato de uso da SEFAZ (T-0045). Dono: engenheiro-software.
 * Desenho: docs/desenho/T-0045.md. Consumidores: worker (fila da SEFAZ), faturamento (T-0021), testes (T-0022),
 * simulador (`@macuxierp/sefaz-simulador`) e emissor real (T-0018).
 */
export { AmbienteFiscal, CUF, ModoEmissao, TP_AMB, TP_EMIS, TpAmb, Uf, XNOME_HOMOLOGACAO } from './ambiente';
export { DESLOCAMENTO_MANAUS_MIN, aammSefaz, dataHoraSefaz, ehDataHoraSefaz } from './datas';
export {
  FilialEmissoraSefaz,
  TransporteHomologacao,
  escolherDestinoSefaz,
  garantirDestinoSimulador,
  type DestinoSefaz,
  type DestinoSefazReal,
  type DestinoSimulador,
} from './destino';
export {
  AUTORIZADOR_DA_UF,
  Autorizador,
  ENDERECOS_SEFAZ,
  SVC_DA_UF,
  ServicoSefaz,
  type EnderecosAutorizador,
  type UrlsSefaz,
} from './enderecos';
export { ErroSefaz, FalhaTransporteSefaz, SimuladorEmProducaoErro, type CodigoErroSefaz } from './erros';
export {
  CStat,
  ChaveNFe,
  DataHoraSefaz,
  DigVal,
  IdLote,
  NProt,
  NRec,
  PedidoAutorizacao,
  PedidoConsultaProtocolo,
  PedidoConsultaRecibo,
  PedidoEvento,
  PedidoInutilizacao,
  ProtocoloEvento,
  ProtocoloNFe,
  Recibo,
  RespostaAutorizacao,
  RespostaConsultaProtocolo,
  RespostaConsultaRecibo,
  RespostaEvento,
  RespostaInutilizacao,
  RespostaStatusServico,
  TAMANHO_MAXIMO_XML_SEFAZ,
  TIPO_EVENTO,
  TipoEvento,
  XmlTexto,
  validarPedidoSefaz,
  type SefazTransporte,
} from './porta';
export {
  criarSeletorTransporte,
  type CredencialA1EmMemoria,
  type FabricaTransporteSefaz,
  type FabricaTransporteSimulador,
  type OpcoesSeletorTransporte,
  type SeletorTransporte,
} from './seletor';
// Etapas 2 a 4 (acréscimos; a API da etapa 1 não muda)
export { chaveNFeComDvValido, dvChaveNFe, lerChaveNFe, montarChaveNFe, type CamposChaveNFe } from './chave';
export { ESQUEMAS_XSD, PACOTE_SCHEMAS, validarXsd, type EsquemaXsd, type ResultadoXsd } from './xsd';
export {
  ALGORITMOS_XMLDSIG_NFE,
  CSTAT_FALHA_ASSINATURA,
  NS_NFE,
  NS_XMLDSIG,
  filhoNfe,
  lerXml,
  textoNfe,
  verificarAssinaturaNFe,
  verificarAssinaturaXml,
  type CertificadoDaAssinatura,
  type ElementoAssinado,
  type FalhaAssinatura,
  type OpcoesVerificacao,
  type ResultadoAssinatura,
} from './xmldsig';
export { DESC_EVENTO, X_COND_USO_CCE, garantirTipoEvento, idEvento, idInutilizacao, type CamposIdInutilizacao } from './eventos';
export { montarEnvEvento, montarEnviNFe, montarNfeProc, semDeclaracaoXml } from './proc';
