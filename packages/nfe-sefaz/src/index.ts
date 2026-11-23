/**
 * @macuxierp/nfe-sefaz — contrato de uso da SEFAZ (T-0045). Dono: engenheiro-software.
 * Desenho: docs/desenho/T-0045.md. Consumidores: worker (fila da SEFAZ), faturamento (T-0021), testes (T-0022),
 * simulador (`@macuxierp/sefaz-simulador`) e emissor real (T-0018).
 */
export {
  AmbienteFiscal,
  CUF,
  C_ORGAO_AN,
  ModalidadeContingencia,
  ModoEmissao,
  PRAZO_TRANSMISSAO_EPEC_HORAS,
  TP_AMB,
  TP_EMIS,
  TP_EMIS_ACEITOS,
  TP_EMIS_CONTINGENCIA,
  TP_EMIS_EPEC,
  TpAmb,
  TpEmis,
  Uf,
  XNOME_HOMOLOGACAO,
} from './ambiente';
export { DESLOCAMENTO_MANAUS_MIN, aammSefaz, dataHoraSefaz, ehDataHoraSefaz } from './datas';
export {
  FilialEmissoraEpec,
  FilialEmissoraSefaz,
  TransporteHomologacao,
  escolherDestinoEpec,
  escolherDestinoSefaz,
  garantirDestinoSimulador,
  garantirTpEmisDoDestino,
  tpEmisAceito,
  type DestinoEpec,
  type DestinoSefaz,
  type DestinoSefazReal,
  type DestinoSimulador,
} from './destino';
export {
  AUTORIZADOR_DA_UF,
  Autorizador,
  ENDERECOS_EPEC,
  ENDERECOS_SEFAZ,
  EPEC_DA_UF,
  SVC_DA_UF,
  ServicoSefaz,
  modalidadesContingencia,
  type EnderecoEpec,
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
  type SefazTransporteEpec,
} from './porta';
export {
  criarSeletorEpec,
  criarSeletorTransporte,
  type CredencialA1EmMemoria,
  type FabricaTransporteEpec,
  type FabricaTransporteSefaz,
  type FabricaTransporteSimulador,
  type OpcoesSeletorEpec,
  type OpcoesSeletorTransporte,
  type SeletorEpec,
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
// Contingência (T-0021, ADR 0011)
export { dadosEpecDaNFe, dadosEpecDoEvento, divergenciasEpec, tpEmisDaNFe, type DadosEpec, type DocumentoDestEpec } from './epec';
