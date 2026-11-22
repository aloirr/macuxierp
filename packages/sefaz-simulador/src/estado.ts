/**
 * Estado do simulador (T-0045, lote B). Duas partes:
 * - a MEMÓRIA DA SEFAZ (notas, eventos, inutilizações, recibos e os contadores de `nProt`/`nRec`), atrás da porta
 *   assíncrona `EstadoSimuladorRepo`. Duas implementações: em memória (`criarEstadoSimuladorMemoria`, padrão e testes)
 *   e PostgreSQL (`criarEstadoSimuladorPg`, `./estado-pg`, schema `sefaz_simulador` da 0025), para o `nProt` não repetir
 *   quando o worker reinicia nem a nota de antes "sumir" (217) no cancelamento, na CC-e e no recibo;
 * - os CONTROLES DE TESTE (paralisação, recibo atrasado, falha de transporte, denegação e rejeição forçada), que ficam
 *   sempre em memória, por destino, no `RegistroSimulador`.
 * Tudo é por DESTINO (filial emissora + modo: normal ou SVC-RS). Os contadores são únicos no repositório inteiro (no
 * Postgres, as sequências globais `seq_nprot` e `seq_nrec`): duas filiais nunca repetem protocolo.
 * Nada destas estruturas vai a log: o `<evento>` da CC-e traz o `xCorrecao`, texto livre.
 */
import {
  ErroSefaz,
  type DestinoSimulador,
  type ProtocoloEvento,
  type ProtocoloNFe,
} from '@macuxierp/nfe-sefaz';

export type SituacaoNotaSimulada = 'autorizada' | 'denegada' | 'cancelada';

/** O pedaço do destino que separa o estado: a filial emissora e o modo (normal ou SVC-RS). */
export type DestinoDoEstado = Pick<DestinoSimulador, 'filial_id' | 'modo'>;

export interface NotaSimulada {
  readonly chNFe: string;
  readonly cnpj: string;
  readonly serie: number;
  readonly nNF: number;
  readonly dhEmi: Date;
  readonly autorizadaEm: Date;
  readonly protocolo: ProtocoloNFe;
  readonly situacao: SituacaoNotaSimulada;
}

export interface EventoSimulado {
  readonly protocolo: ProtocoloEvento;
  /** O `<evento>` assinado, como chegou (vai no `procEventoNFe` da consulta). */
  readonly eventoXml: string;
}

export interface FaixaSimulada {
  readonly cnpj: string;
  readonly serie: number;
  /** Ano com 2 dígitos. */
  readonly ano: string;
  readonly nNFIni: number;
  readonly nNFFin: number;
}

export interface InutilizacaoSimulada extends FaixaSimulada {
  readonly nProt: string;
}

export interface ReciboSimulado {
  readonly nRec: string;
  readonly dhRecbto: string;
  /** A partir de quando o recibo responde 104 (`tMed` depois do recebimento). */
  readonly prontoEm: Date;
  readonly protocolos: readonly ProtocoloNFe[];
}

export type TipoNumeroSimulador = 'nProt' | 'nRec';

/** Maior sequencial de `nProt`/`nRec` (9 dígitos; `MAXVALUE` das sequências da 0025). Depois dele, o simulador para. */
export const SEQUENCIAL_MAXIMO_SIMULADOR = 999_999_999;

/**
 * A sequência do `nProt` ou do `nRec` chegou ao fim (no Postgres, o 2200H do `nextval`; as sequências não têm CYCLE).
 * Erro PERMANENTE: repetir não muda nada e o worker não retenta (código `SEFAZ_SIMULADOR_ESGOTADO`).
 */
export class SequenciaSimuladorEsgotadaErro extends ErroSefaz {
  override readonly name = 'SequenciaSimuladorEsgotadaErro';
  readonly retentavel = false;
  constructor(readonly tipo: TipoNumeroSimulador) {
    super(
      'SEFAZ_SIMULADOR_ESGOTADO',
      `simulador da SEFAZ: a sequência do ${tipo} chegou ao fim (${SEQUENCIAL_MAXIMO_SIMULADOR})`,
    );
  }
}

/**
 * Porta da memória do simulador. Uma instância vale para UMA unidade de trabalho: no Postgres, a transação do tenant
 * (`criarEstadoSimuladorPg(tx)`); em memória, o processo. Cada operação do simulador (uma autorização, um evento, uma
 * inutilização, uma consulta) roda inteira numa instância só: as leituras e as gravações dela saem na mesma transação.
 */
export interface EstadoSimuladorRepo {
  notaPorChave(d: DestinoDoEstado, chNFe: string): Promise<NotaSimulada | null>;
  /**
   * A nota, travada até o fim da unidade de trabalho (no Postgres, `SELECT ... FOR UPDATE`): o evento lê por aqui,
   * e dois eventos da mesma nota (dois cancelamentos, CC-e e cancelamento) passam um de cada vez. Em memória, igual
   * a `notaPorChave`.
   */
  notaPorChaveParaAtualizar(d: DestinoDoEstado, chNFe: string): Promise<NotaSimulada | null>;
  /** A nota com o mesmo número (a base do 539: mesmo número, outra chave). */
  notaPorNumero(d: DestinoDoEstado, cnpj: string, serie: number, nNF: number): Promise<NotaSimulada | null>;
  /**
   * Grava a nota e devolve `null`. Se outra unidade de trabalho já gravou a mesma chave ou o mesmo número (autorização
   * concorrente; no Postgres, o 23505 com `ROLLBACK TO SAVEPOINT`), não grava e devolve essa nota (204 ou 539).
   */
  gravarNota(d: DestinoDoEstado, nota: NotaSimulada): Promise<NotaSimulada | null>;
  mudarSituacao(d: DestinoDoEstado, chNFe: string, situacao: SituacaoNotaSimulada): Promise<void>;
  /** Eventos da nota, na ordem em que foram registrados. */
  eventosDaNota(d: DestinoDoEstado, chNFe: string): Promise<EventoSimulado[]>;
  gravarEvento(d: DestinoDoEstado, chNFe: string, evento: EventoSimulado): Promise<void>;
  /** O número está numa faixa inutilizada do CNPJ e da série (206)? */
  numeroInutilizado(d: DestinoDoEstado, cnpj: string, serie: number, nNF: number): Promise<boolean>;
  /**
   * Trava a faixa (CNPJ, série e ano do destino) até o fim da unidade de trabalho. No Postgres,
   * `pg_advisory_xact_lock` por (tenant_id, filial_id, modo, cnpj, serie, ano): o `FOR UPDATE` não trava faixa que
   * ainda não existe. Quem confere e grava a faixa chama antes (`inutilizacao.ts`), e a autorização também, antes do
   * 206 (a inutilização e a nota do mesmo número nunca passam as duas).
   */
  travarFaixa(d: DestinoDoEstado, f: Pick<FaixaSimulada, 'cnpj' | 'serie' | 'ano'>): Promise<void>;
  /** Já existe a MESMA faixa (563)? */
  faixaRepetida(d: DestinoDoEstado, f: FaixaSimulada): Promise<boolean>;
  /** Alguma faixa do mesmo CNPJ, série e ano cruza esta (256)? */
  faixaSobreposta(d: DestinoDoEstado, f: FaixaSimulada): Promise<boolean>;
  /** Alguma nota do CNPJ e da série usou um número da faixa (241)? */
  numeroUsadoNaFaixa(d: DestinoDoEstado, f: FaixaSimulada): Promise<boolean>;
  gravarInutilizacao(d: DestinoDoEstado, inutilizacao: InutilizacaoSimulada): Promise<void>;
  gravarRecibo(d: DestinoDoEstado, recibo: ReciboSimulado): Promise<void>;
  recibo(d: DestinoDoEstado, nRec: string): Promise<ReciboSimulado | null>;
  /**
   * Próximo sequencial de `nProt` ou `nRec` (único no repositório inteiro).
   *
   * @throws SequenciaSimuladorEsgotadaErro depois de `SEQUENCIAL_MAXIMO_SIMULADOR` (erro permanente, sem retry).
   */
  proximo(tipo: TipoNumeroSimulador): Promise<number>;
}

/**
 * Onde o simulador acha a porta em cada operação: abre a unidade de trabalho, entrega a porta e fecha (commit) ao fim.
 * No worker: `estadoSimuladorPorTenant(banco).fonte`. Em memória, a mesma porta sempre.
 */
export type FonteEstadoSimulador = <R>(fn: (estado: EstadoSimuladorRepo) => Promise<R>) => Promise<R>;

/** A fonte que entrega sempre a mesma porta (memória, ou uma porta já presa a uma transação aberta). */
export function fonteFixa(estado: EstadoSimuladorRepo): FonteEstadoSimulador {
  return (fn) => fn(estado);
}

const chaveDestino = (d: DestinoDoEstado) => `${d.filial_id}|${d.modo}`;
const chaveNumero = (cnpj: string, serie: number, nNF: number) => `${cnpj}|${serie}|${nNF}`;

interface DestinoNaMemoria {
  readonly notas: Map<string, NotaSimulada>;
  /** `cnpj|serie|nNF` → chave. */
  readonly numeros: Map<string, string>;
  readonly eventos: Map<string, EventoSimulado[]>;
  readonly inutilizacoes: InutilizacaoSimulada[];
  readonly recibos: Map<string, ReciboSimulado>;
}

export interface OpcoesEstadoMemoria {
  /** Último sequencial já usado (padrão 0). Só para o teste do esgotamento. */
  ultimo?: Partial<Record<TipoNumeroSimulador, number>>;
}

interface Memoria {
  repo: EstadoSimuladorRepo;
  proximo(tipo: TipoNumeroSimulador): number;
}

function criarMemoria(o: OpcoesEstadoMemoria): Memoria {
  const destinos = new Map<string, DestinoNaMemoria>();
  const seq = { nProt: o.ultimo?.nProt ?? 0, nRec: o.ultimo?.nRec ?? 0 };
  const de = (d: DestinoDoEstado): DestinoNaMemoria => {
    let e = destinos.get(chaveDestino(d));
    if (!e) {
      e = { notas: new Map(), numeros: new Map(), eventos: new Map(), inutilizacoes: [], recibos: new Map() };
      destinos.set(chaveDestino(d), e);
    }
    return e;
  };
  const mesmaSerie = (i: FaixaSimulada, f: Pick<FaixaSimulada, 'cnpj' | 'serie' | 'ano'>) =>
    i.cnpj === f.cnpj && i.serie === f.serie && i.ano === f.ano;
  const proximo = (tipo: TipoNumeroSimulador): number => {
    if (seq[tipo] >= SEQUENCIAL_MAXIMO_SIMULADOR) throw new SequenciaSimuladorEsgotadaErro(tipo);
    seq[tipo] += 1;
    return seq[tipo];
  };

  const repo: EstadoSimuladorRepo = {
    async notaPorChave(d, chNFe) {
      return de(d).notas.get(chNFe) ?? null;
    },
    async notaPorChaveParaAtualizar(d, chNFe) {
      return de(d).notas.get(chNFe) ?? null;
    },
    async notaPorNumero(d, cnpj, serie, nNF) {
      const e = de(d);
      const chave = e.numeros.get(chaveNumero(cnpj, serie, nNF));
      return (chave && e.notas.get(chave)) || null;
    },
    async gravarNota(d, nota) {
      const e = de(d);
      const numero = chaveNumero(nota.cnpj, nota.serie, nota.nNF);
      const outraChave = e.numeros.get(numero);
      const existente = e.notas.get(nota.chNFe) ?? (outraChave ? e.notas.get(outraChave) : undefined);
      if (existente) return existente;
      e.notas.set(nota.chNFe, nota);
      e.numeros.set(numero, nota.chNFe);
      return null;
    },
    async mudarSituacao(d, chNFe, situacao) {
      const e = de(d);
      const n = e.notas.get(chNFe);
      if (!n) throw new Error('simulador: nota inexistente no destino');
      e.notas.set(chNFe, { ...n, situacao });
    },
    async eventosDaNota(d, chNFe) {
      return [...(de(d).eventos.get(chNFe) ?? [])];
    },
    async gravarEvento(d, chNFe, evento) {
      const e = de(d);
      if (!e.notas.has(chNFe)) throw new Error('simulador: evento de nota inexistente no destino');
      const lista = e.eventos.get(chNFe) ?? [];
      const { tpEvento, nSeqEvento } = evento.protocolo;
      if (lista.some((x) => x.protocolo.tpEvento === tpEvento && x.protocolo.nSeqEvento === nSeqEvento))
        throw new Error('simulador: evento já gravado');
      e.eventos.set(chNFe, [...lista, evento]);
    },
    async numeroInutilizado(d, cnpj, serie, nNF) {
      return de(d).inutilizacoes.some(
        (i) => i.cnpj === cnpj && i.serie === serie && nNF >= i.nNFIni && nNF <= i.nNFFin,
      );
    },
    async travarFaixa() {
      // Em memória não há transação nem outro processo: nada a travar.
    },
    async faixaRepetida(d, f) {
      return de(d).inutilizacoes.some(
        (i) => mesmaSerie(i, f) && i.nNFIni === f.nNFIni && i.nNFFin === f.nNFFin,
      );
    },
    async faixaSobreposta(d, f) {
      return de(d).inutilizacoes.some(
        (i) => mesmaSerie(i, f) && f.nNFIni <= i.nNFFin && f.nNFFin >= i.nNFIni,
      );
    },
    async numeroUsadoNaFaixa(d, f) {
      for (const n of de(d).notas.values())
        if (n.cnpj === f.cnpj && n.serie === f.serie && n.nNF >= f.nNFIni && n.nNF <= f.nNFFin) return true;
      return false;
    },
    async gravarInutilizacao(d, inutilizacao) {
      de(d).inutilizacoes.push(inutilizacao);
    },
    async gravarRecibo(d, recibo) {
      de(d).recibos.set(recibo.nRec, recibo);
    },
    async recibo(d, nRec) {
      return de(d).recibos.get(nRec) ?? null;
    },
    async proximo(tipo) {
      return proximo(tipo);
    },
  };
  return { repo, proximo };
}

/** A porta em memória: some quando o processo termina (o padrão do simulador e os testes de unidade). */
export function criarEstadoSimuladorMemoria(o: OpcoesEstadoMemoria = {}): EstadoSimuladorRepo {
  return criarMemoria(o).repo;
}

/** Operações em que o apoio de teste pode forçar a rejeição do próximo envio. */
export const OPERACOES_REJEITAVEIS = [
  'autorizar',
  'consultarRecibo',
  'cancelar',
  'cartaCorrecao',
  'inutilizar',
] as const;
export type OperacaoRejeitavel = (typeof OPERACOES_REJEITAVEIS)[number];

/** Controles de teste (desenho §4): paralisação, recibo atrasado, falha de transporte, denegação e rejeição forçada. */
interface ControlesNoEstado {
  paralisacao: '108' | '109' | null;
  recibosAtrasados: number;
  falhas: { restantes: number; aposProcessar: boolean };
  /** CNPJ/CPF → 301 (emitente irregular) ou 302 (destinatário irregular). */
  readonly denegados: Map<string, '301' | '302'>;
  /** Rejeição forçada do próximo envio de cada operação (só o apoio de teste grava; some ao ser usada). */
  readonly rejeicoes: Map<OperacaoRejeitavel, string>;
}

/** O que fica no registro por destino: só os controles de teste (a memória da SEFAZ está na porta). */
export interface EstadoDestino {
  readonly controles: ControlesNoEstado;
}

export interface RegistroSimulador {
  /** Controles de teste do destino (criados no primeiro uso). Valem para todas as instâncias do registro. */
  estadoDe(destino: DestinoSimulador): EstadoDestino;
  /** A porta em memória do registro: o estado de quem não passa `estado` à fábrica ou ao simulador. */
  readonly memoria: EstadoSimuladorRepo;
  /** Próximo sequencial da porta em memória do registro (o simulador numera pela porta em uso). */
  proximo(tipo: TipoNumeroSimulador): number;
}

export function criarRegistroSimulador(): RegistroSimulador {
  const estados = new Map<string, EstadoDestino>();
  const memoria = criarMemoria({});
  return {
    memoria: memoria.repo,
    estadoDe(d) {
      let e = estados.get(chaveDestino(d));
      if (!e) {
        e = {
          controles: {
            paralisacao: null,
            recibosAtrasados: 0,
            falhas: { restantes: 0, aposProcessar: false },
            denegados: new Map(),
            rejeicoes: new Map(),
          },
        };
        estados.set(chaveDestino(d), e);
      }
      return e;
    },
    proximo: memoria.proximo,
  };
}

/** `[nProt:...][dhAut:...]`: a referência à autorização no `xMotivo` do 204/205/218/539 (como a SEFAZ devolve). */
export const refAutorizacao = (n: NotaSimulada) =>
  `[nProt:${n.protocolo.nProt}][dhAut:${n.protocolo.dhRecbto}]`;
