/**
 * Estado em memória do simulador. Um `RegistroSimulador` guarda um estado por DESTINO (filial emissora + modo:
 * normal ou SVC-RS) e os contadores de `nProt` e `nRec`, que são únicos no registro inteiro (o guardado de duas
 * filiais nunca repete protocolo). O worker monta um registro na subida (`criarFabricaSimulador`); os testes criam um
 * por cenário. Nada vai a disco: reiniciou, zerou (é homologação simulada).
 */
import type { DestinoSimulador, ProtocoloEvento, ProtocoloNFe } from '@macuxierp/nfe-sefaz';

type SituacaoNota = 'autorizada' | 'denegada' | 'cancelada';

interface EventoNoSimulador {
  readonly protocolo: ProtocoloEvento;
  /** O `<evento>` assinado, como chegou (vai no `procEventoNFe` da consulta). */
  readonly eventoXml: string;
}

export interface NotaNoSimulador {
  readonly chNFe: string;
  readonly cnpj: string;
  readonly serie: number;
  readonly nNF: number;
  readonly dhEmi: Date;
  readonly autorizadaEm: Date;
  readonly protocolo: ProtocoloNFe;
  situacao: SituacaoNota;
  readonly eventos: EventoNoSimulador[];
}

interface InutilizacaoNoSimulador {
  readonly cnpj: string;
  readonly serie: number;
  readonly ano: string;
  readonly nNFIni: number;
  readonly nNFFin: number;
  readonly nProt: string;
}

interface LoteNoSimulador {
  readonly nRec: string;
  readonly dhRecbto: string;
  /** Instante (ms) a partir do qual o recibo responde 104 (`tMed` depois do recebimento). */
  readonly prontoEm: number;
  readonly protocolos: readonly ProtocoloNFe[];
}

/** Operações que o apoio de teste (`@macuxierp/sefaz-simulador/teste`) sabe rejeitar no próximo envio. */
/** Operações em que o apoio de teste pode forçar a rejeição do próximo envio. */
export const OPERACOES_REJEITAVEIS = ['autorizar', 'consultarRecibo', 'cancelar', 'cartaCorrecao', 'inutilizar'] as const;
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

export interface EstadoDestino {
  readonly notas: Map<string, NotaNoSimulador>;
  /** `cnpj|serie|nNF` → chave: a base do 539 (mesmo número com outra chave). */
  readonly numeros: Map<string, string>;
  readonly inutilizacoes: InutilizacaoNoSimulador[];
  readonly lotes: Map<string, LoteNoSimulador>;
  readonly controles: ControlesNoEstado;
}

export interface RegistroSimulador {
  /** Estado do destino (criado no primeiro uso). */
  estadoDe(destino: DestinoSimulador): EstadoDestino;
  /** Próximo sequencial de protocolo (`nProt`) ou de recibo (`nRec`). */
  proximo(tipo: 'nProt' | 'nRec'): number;
}

export function criarRegistroSimulador(): RegistroSimulador {
  const estados = new Map<string, EstadoDestino>();
  const seq = { nProt: 0, nRec: 0 };
  return {
    estadoDe(d) {
      const chave = `${d.filial_id}|${d.modo}`;
      let e = estados.get(chave);
      if (!e) {
        e = {
          notas: new Map(),
          numeros: new Map(),
          inutilizacoes: [],
          lotes: new Map(),
          controles: { paralisacao: null, recibosAtrasados: 0, falhas: { restantes: 0, aposProcessar: false }, denegados: new Map(), rejeicoes: new Map() },
        };
        estados.set(chave, e);
      }
      return e;
    },
    proximo(tipo) {
      seq[tipo] += 1;
      return seq[tipo];
    },
  };
}

export const chaveNumero = (cnpj: string, serie: number, nNF: number) => `${cnpj}|${serie}|${nNF}`;

/** `[nProt:...][dhAut:...]`: a referência à autorização no `xMotivo` do 204/205/218/539 (como a SEFAZ devolve). */
export const refAutorizacao = (n: NotaNoSimulador) => `[nProt:${n.protocolo.nProt}][dhAut:${n.protocolo.dhRecbto}]`;
