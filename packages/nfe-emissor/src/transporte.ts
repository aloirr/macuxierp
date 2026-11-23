/**
 * Transporte SOAP 1.2 com mTLS que implementa a porta `SefazTransporte` do `@macuxierp/nfe-sefaz` (RD-0297). É a
 * fábrica `sefaz` do `criarSeletorTransporte` no worker:
 *
 *   criarSeletorTransporte({ transporte, simulador: criarFabricaSimulador(), sefaz: criarFabricaTransporteSoap() })
 *
 * O destino (URLs, tpAmb, cUF, a trava homologação × produção) vem só do `escolherDestinoSefaz`; aqui não há URL
 * nem ambiente próprios. Semântica do contrato (desenho T-0045 §3.1): pedido fora do schema é
 * `SEFAZ_PEDIDO_INVALIDO` e nada sai; rejeição volta no `cStat`; rede/TLS/tempo/SOAP ilegível é
 * `FalhaTransporteSefaz`. O A1 chega decifrado do worker (ADR 0005), é aberto em memória e não é guardado fora dele.
 */
import {
  ErroSefaz,
  FalhaTransporteSefaz,
  NS_NFE,
  PedidoAutorizacao,
  PedidoConsultaProtocolo,
  PedidoConsultaRecibo,
  PedidoEvento,
  PedidoInutilizacao,
  TIPO_EVENTO,
  garantirTipoEvento,
  garantirTpEmisDoDestino,
  lerXml,
  montarEnvEvento,
  montarEnviNFe,
  semDeclaracaoXml,
  textoNfe,
  tpEmisDaNFe,
  validarPedidoSefaz,
  type DestinoEpec,
  type DestinoSefazReal,
  type FabricaTransporteEpec,
  type FabricaTransporteSefaz,
  type SefazTransporte,
  type SefazTransporteEpec,
  type ServicoSefaz,
  type TipoEvento,
} from '@macuxierp/nfe-sefaz';
import { abrirA1 } from './certificado';
import type { CertificadoA1EmMemoria } from './certificado';
import {
  lerRetornoAutorizacao,
  lerRetornoConsultaProtocolo,
  lerRetornoConsultaRecibo,
  lerRetornoEvento,
  lerRetornoInutilizacao,
  lerRetornoStatusServico,
} from './retornos';
import { montarEnvelope, postarSoap, type ConexaoSoap } from './soap';
import { el, serializar } from './xml';

export type OpcoesTransporteSoap = Omit<ConexaoSoap, 'a1'> & {
  /** Instante da conferência da validade do A1 ao abrir (padrão: agora). */
  agora?: () => Date;
};

/** Pedido de consulta (`consReciNFe`, `consSitNFe`, `consStatServ`), versão 4.00, na forma canônica. */
function consulta(raiz: string, campos: ReadonlyArray<[string, string]>): string {
  return serializar({ nome: raiz, xmlns: NS_NFE, atributos: { versao: '4.00' }, filhos: campos.map(([n, v]) => el(n, v)) });
}

/**
 * Trava homologação × produção no próprio documento: o `tpAmb` do XML tem de ser o do destino, senão nada sai
 * (`SEFAZ_PEDIDO_INVALIDO`). `obrigatorio`: na NF-e a ausência também recusa; nos eventos e na inutilização, só o
 * `tpAmb` presente e diferente (o schema da SEFAZ cuida do resto). A mensagem não copia o XML.
 */
function garantirTpAmb(xml: string, caminho: readonly string[], tpAmb: string, documento: string, obrigatorio: boolean): void {
  const lido = textoNfe(lerXml(xml)?.documentElement, ...caminho);
  if (lido === tpAmb || (!obrigatorio && lido === '')) return;
  throw new ErroSefaz('SEFAZ_PEDIDO_INVALIDO', `${documento}: tpAmb ${lido || '(ausente)'} difere do destino (${tpAmb})`);
}

/**
 * As travas de todo evento antes de sair: o pedido no contrato, o `tpEvento` da operação (`esperado`) e o `tpAmb` do
 * destino (`obrigatorio` como no `garantirTpAmb`). Devolve o `idLote` e o evento sem a declaração XML.
 */
function prepararEvento(
  pedido: PedidoEvento,
  esperado: TipoEvento,
  tpAmb: string,
  rotulo: string,
  obrigatorio: boolean,
): { idLote: string; xml: string } {
  const p = validarPedidoSefaz(PedidoEvento, pedido);
  const xml = semDeclaracaoXml(p.eventoAssinado);
  garantirTipoEvento(xml, esperado);
  garantirTpAmb(xml, ['infEvento', 'tpAmb'], tpAmb, rotulo, obrigatorio);
  return { idLote: p.idLote, xml };
}

/** O transporte de UM destino real (autorizador da UF ou SVC), com o A1 já aberto. */
export function criarTransporteSoap(destino: DestinoSefazReal, a1: CertificadoA1EmMemoria, o: OpcoesTransporteSoap = {}): SefazTransporte {
  if (destino?.tipo !== 'sefaz') throw new ErroSefaz('SEFAZ_TRANSPORTE_NAO_CONFIGURADO', 'O transporte SOAP só atende destino real da SEFAZ');
  const { agora: _agora, ...opcoesConexao } = o;
  const conexao: ConexaoSoap = { ...opcoesConexao, a1 };
  const tpAmb = String(destino.tpAmb);

  async function conversar(servico: ServicoSefaz, corpo: string): Promise<string> {
    const url = destino.urls[servico];
    if (!url) throw new FalhaTransporteSefaz(servico, false, `o autorizador ${destino.autorizador} não oferece o serviço`);
    return postarSoap(conexao, servico, url, montarEnvelope(servico, corpo));
  }

  async function evento(esperado: TipoEvento, pedido: PedidoEvento) {
    const { idLote, xml } = prepararEvento(pedido, esperado, tpAmb, 'evento', false);
    return lerRetornoEvento(await conversar('recepcaoEvento', montarEnvEvento(idLote, xml)));
  }

  return Object.freeze({
    destino,
    async autorizar(pedido: PedidoAutorizacao) {
      const p = validarPedidoSefaz(PedidoAutorizacao, pedido);
      p.nfes.forEach((nfe, i) => {
        garantirTpAmb(nfe, ['infNFe', 'ide', 'tpAmb'], tpAmb, `NF-e ${i + 1} do lote`, true);
        // ADR 0011: nota de SVC no autorizador normal (ou o contrário) não sai; a EPEC (4) vai ao normal na volta.
        garantirTpEmisDoDestino(destino.modo, tpEmisDaNFe(nfe), `NF-e ${i + 1} do lote`);
      });
      return lerRetornoAutorizacao(await conversar('autorizacao', montarEnviNFe(p)));
    },
    async consultarRecibo(pedido: PedidoConsultaRecibo) {
      const p = validarPedidoSefaz(PedidoConsultaRecibo, pedido);
      return lerRetornoConsultaRecibo(await conversar('retAutorizacao', consulta('consReciNFe', [['tpAmb', tpAmb], ['nRec', p.nRec]])));
    },
    async consultarProtocolo(pedido: PedidoConsultaProtocolo) {
      const p = validarPedidoSefaz(PedidoConsultaProtocolo, pedido);
      const corpo = consulta('consSitNFe', [['tpAmb', tpAmb], ['xServ', 'CONSULTAR'], ['chNFe', p.chNFe]]);
      return lerRetornoConsultaProtocolo(await conversar('consultaProtocolo', corpo));
    },
    async statusServico() {
      const corpo = consulta('consStatServ', [['tpAmb', tpAmb], ['cUF', String(destino.cUF)], ['xServ', 'STATUS']]);
      return lerRetornoStatusServico(await conversar('statusServico', corpo));
    },
    cancelar: (pedido: PedidoEvento) => evento(TIPO_EVENTO.cancelamento, pedido),
    cartaCorrecao: (pedido: PedidoEvento) => evento(TIPO_EVENTO.cartaCorrecao, pedido),
    async inutilizar(pedido: PedidoInutilizacao) {
      const p = validarPedidoSefaz(PedidoInutilizacao, pedido);
      const xml = semDeclaracaoXml(p.inutilizacaoAssinada);
      garantirTpAmb(xml, ['infInut', 'tpAmb'], tpAmb, 'inutilização', false);
      return lerRetornoInutilizacao(await conversar('inutilizacao', xml));
    },
  });
}

/**
 * O transporte da EPEC (ADR 0011): o evento 110140 assinado vai ao Ambiente Nacional (`destino.url`, "a conferir"),
 * no `envEvento`, pelo serviço de recepção da EPEC. Mesmas travas dos outros eventos (tpEvento da operação e tpAmb do
 * destino) e mais o `cOrgao` 91. Rejeição volta no `cStat`; rede/TLS/tempo é `FalhaTransporteSefaz`.
 */
export function criarTransporteEpecSoap(destino: DestinoEpec, a1: CertificadoA1EmMemoria, o: OpcoesTransporteSoap = {}): SefazTransporteEpec {
  if (destino?.tipo !== 'epec') throw new ErroSefaz('SEFAZ_TRANSPORTE_NAO_CONFIGURADO', 'O transporte da EPEC só atende o destino do Ambiente Nacional');
  const { agora: _agora, ...opcoesConexao } = o;
  const conexao: ConexaoSoap = { ...opcoesConexao, a1 };
  return Object.freeze({
    destino,
    async epec(pedido: PedidoEvento) {
      const { idLote, xml } = prepararEvento(pedido, TIPO_EVENTO.epec, String(destino.tpAmb), 'EPEC', true);
      const cOrgao = textoNfe(lerXml(xml)?.documentElement, 'infEvento', 'cOrgao');
      if (cOrgao !== String(destino.cOrgao)) throw new ErroSefaz('SEFAZ_PEDIDO_INVALIDO', `EPEC: cOrgao ${cOrgao || '(ausente)'} difere do Ambiente Nacional (${destino.cOrgao})`);
      const envelope = montarEnvelope('recepcaoEpec', montarEnvEvento(idLote, xml));
      return lerRetornoEvento(await postarSoap(conexao, 'recepcaoEpec', destino.url, envelope));
    },
  });
}

/** A `FabricaTransporteEpec` do `criarSeletorEpec`: abre o A1 em memória e devolve o transporte da EPEC. */
export function criarFabricaTransporteEpecSoap(o: OpcoesTransporteSoap = {}): FabricaTransporteEpec {
  return (destino, credencial) => criarTransporteEpecSoap(destino, abrirA1(credencial.pfx, credencial.senha, o.agora?.()), o);
}

/** A `FabricaTransporteSefaz` do seletor: abre o A1 da credencial em memória e devolve o transporte do destino. */
export function criarFabricaTransporteSoap(o: OpcoesTransporteSoap = {}): FabricaTransporteSefaz {
  return (destino, credencial) => criarTransporteSoap(destino, abrirA1(credencial.pfx, credencial.senha, o.agora?.()), o);
}
