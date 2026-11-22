/**
 * @macuxierp/sefaz-simulador — simulador da SEFAZ-AM, SÓ HOMOLOGAÇÃO (T-0045; decisão de 21/11/2026, ADR 0008).
 * Implementa a porta `SefazTransporte` in-process. Serviços, controles e protocolo: ADR 0008 §1. Ordem das
 * conferências: o cabeçalho de cada arquivo desta pasta. Trava da regra 7 (três camadas): desenho T-0045 §2.2; aqui,
 * a fábrica chama `garantirDestinoSimulador` e as respostas saem com o tpAmb do destino (2).
 */
import {
  PedidoAutorizacao,
  PedidoConsultaProtocolo,
  PedidoConsultaRecibo,
  PedidoEvento,
  PedidoInutilizacao,
  TIPO_EVENTO,
  garantirDestinoSimulador,
  validarPedidoSefaz,
  type DestinoSimulador,
  type FabricaTransporteSimulador,
  type SefazTransporte,
} from '@macuxierp/nfe-sefaz';
import { autorizar, consultarRecibo } from './autorizacao';
import { consultarProtocolo, statusServico } from './consultas';
import { conversa, type Contexto } from './contexto';
import { criarRegistroSimulador, type RegistroSimulador } from './estado';
import { registrarEvento } from './eventos';
import { inutilizar } from './inutilizacao';

export { CSTAT_DO_SIMULADOR, MOTIVO, PREFIXO_NUMERO_SIMULADOR, VER_APLIC_SIMULADOR, type CStatSimulador } from './contexto';
export { criarRegistroSimulador, type RegistroSimulador } from './estado';

export interface OpcoesSimulador {
  /** Relógio do simulador (os testes passam um fixo). Padrão: o relógio do sistema. */
  agora?: () => Date;
  /** Tempo médio (s) devolvido no status e no recibo; o recibo só fica pronto depois dele. Padrão: 1. */
  tMed?: number;
  /** Estado compartilhado entre instâncias (o worker usa um só). Padrão: um registro novo, só desta instância. */
  registro?: RegistroSimulador;
}

/** Controles de teste (desenho §4). Valem para o destino inteiro (todas as instâncias do mesmo registro). */
export interface ControlesSimulador {
  /** 108/109 no `statusServico`; as outras operações falham como rede. `null` volta ao normal. */
  paralisar(cStat: '108' | '109' | null): void;
  /** As próximas `n` consultas de recibo respondem 105, mesmo depois do `tMed`. */
  atrasarRecibo(n: number): void;
  /**
   * As próximas `n` operações (exceto `statusServico`) lançam `FalhaTransporteSefaz` retentável. Com
   * `aposProcessar`, o simulador processa e só então falha: a resposta "se perde" e o worker precisa consultar.
   */
  falharTransporte(n: number, o?: { aposProcessar?: boolean }): void;
  /** Uso denegado: o CNPJ do emitente dá 301; o CNPJ/CPF do destinatário dá 302. */
  denegar(documento: string, quem: 'emitente' | 'destinatario'): void;
}

/** O simulador é um `SefazTransporte` com destino de simulador (o tipo já impede produção). */
export interface SimuladorSefaz extends SefazTransporte {
  readonly destino: DestinoSimulador;
  readonly controles: ControlesSimulador;
}

/**
 * Cria o simulador para um destino de homologação (o que `escolherDestinoSefaz(..., { transporte: 'simulador' })`
 * devolve).
 *
 * @throws SimuladorEmProducaoErro se o destino não for de simulador em homologação.
 */
export function criarSimuladorSefaz(destino: DestinoSimulador, opcoes: OpcoesSimulador = {}): SimuladorSefaz {
  const d = garantirDestinoSimulador(destino);
  const registro = opcoes.registro ?? criarRegistroSimulador();
  const tMed = opcoes.tMed ?? 1;
  if (!Number.isInteger(tMed) || tMed < 0) throw new RangeError('criarSimuladorSefaz: tMed deve ser inteiro >= 0');
  const ctx: Contexto = { d, estado: registro.estadoDe(d), registro, agora: opcoes.agora ?? (() => new Date()), tMed };
  const c = ctx.estado.controles;
  const contagem = (n: number) => {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('controle do simulador: n deve ser inteiro >= 0');
    return n;
  };

  return Object.freeze({
    destino: d,
    controles: Object.freeze({
      paralisar: (cStat: '108' | '109' | null) => {
        c.paralisacao = cStat;
      },
      atrasarRecibo: (n: number) => {
        c.recibosAtrasados = contagem(n);
      },
      falharTransporte: (n: number, o: { aposProcessar?: boolean } = {}) => {
        c.falhas.restantes = contagem(n);
        c.falhas.aposProcessar = o.aposProcessar ?? false;
      },
      denegar: (documento: string, quem: 'emitente' | 'destinatario') => {
        c.denegados.set(documento, quem === 'emitente' ? '301' : '302');
      },
    }),
    async statusServico() {
      return statusServico(ctx);
    },
    async autorizar(pedido: PedidoAutorizacao) {
      const p = validarPedidoSefaz(PedidoAutorizacao, pedido);
      return conversa(ctx, 'autorizacao', () => autorizar(ctx, p));
    },
    async consultarRecibo(pedido: PedidoConsultaRecibo) {
      const p = validarPedidoSefaz(PedidoConsultaRecibo, pedido);
      return conversa(ctx, 'retAutorizacao', async () => consultarRecibo(ctx, p.nRec));
    },
    async consultarProtocolo(pedido: PedidoConsultaProtocolo) {
      const p = validarPedidoSefaz(PedidoConsultaProtocolo, pedido);
      return conversa(ctx, 'consultaProtocolo', async () => consultarProtocolo(ctx, p.chNFe));
    },
    async cancelar(pedido: PedidoEvento) {
      const p = validarPedidoSefaz(PedidoEvento, pedido);
      return conversa(ctx, 'recepcaoEvento', () => registrarEvento(ctx, TIPO_EVENTO.cancelamento, p.idLote, p.eventoAssinado));
    },
    async cartaCorrecao(pedido: PedidoEvento) {
      const p = validarPedidoSefaz(PedidoEvento, pedido);
      return conversa(ctx, 'recepcaoEvento', () => registrarEvento(ctx, TIPO_EVENTO.cartaCorrecao, p.idLote, p.eventoAssinado));
    },
    async inutilizar(pedido: PedidoInutilizacao) {
      const p = validarPedidoSefaz(PedidoInutilizacao, pedido);
      return conversa(ctx, 'inutilizacao', () => inutilizar(ctx, p.inutilizacaoAssinada));
    },
  });
}

/**
 * A `FabricaTransporteSimulador` do seletor, com UM registro para todas as filiais: o worker monta na subida
 * (`criarSeletorTransporte({ transporte: 'simulador', simulador: criarFabricaSimulador() })`) e cada chamada do
 * seletor recebe um simulador que enxerga o mesmo estado do destino (notas, eventos, recibos e inutilizações).
 */
export function criarFabricaSimulador(opcoes: OpcoesSimulador = {}): FabricaTransporteSimulador {
  const registro = opcoes.registro ?? criarRegistroSimulador();
  return (destino) => criarSimuladorSefaz(destino, { ...opcoes, registro });
}
