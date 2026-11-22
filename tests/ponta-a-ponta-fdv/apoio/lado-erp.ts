/**
 * T-0012: a porta "lado ERP" do arnês. Os cenários só falam com `LadoErp`; o adaptador decide como o ERP monta os lotes
 * (`Montador`) e como chama o Hub (`Transporte`). O laço comum (enviar, repetir respeitando o `Retry-After`, consultar o
 * lote até o estado final, log sem dado pessoal) fica aqui, uma vez só.
 *
 * Adaptadores (`MACUXI_HUB_LADO_ERP`):
 *  - `conector` (padrão): o código do ERP já no `main` — `montarLotes`, `classificarResposta` e
 *    `atrasoRetentativaSegundos` do domain do `integracao-fdv` (T-0011, PR #78) e a porta `criarClienteHub` do
 *    platform-sdk (T-0011, PR #77). Ver `adaptador-conector.ts`.
 *  - `emissor-minimo`: emissor mínimo do contrato, só do arnês (`emissor-minimo.ts`), para separar defeito do ERP de
 *    defeito do arnês.
 * Quando o envio do worker (espelho, cursor, agenda) entrar, entra um terceiro adaptador sem mudar os cenários.
 */
import {
  ESTADOS_FINAIS,
  type CursorHub,
  type EntidadeHub,
  type LoteAceito,
  type LoteResultado,
  type ModoLote,
  type RegistroHub,
} from './contrato-hub';
import type { Relogio } from './relogio';

export interface PublicacaoEntrada {
  entidade: EntidadeHub;
  modo: ModoLote;
  registros: readonly RegistroHub[];
  /** Remontagem explícita (M6 do desenho T-0009): geração nova = `Idempotency-Key` nova para o mesmo conteúdo. */
  geracao?: number;
}

export interface TentativaHttp {
  status: number | null;
  codigo: string | null;
  retryAfterMs: number | null;
  esperouMs: number;
}

export interface LoteEnviado {
  entidade: EntidadeHub;
  modo: ModoLote;
  /** Parte da sessão (carga completa) ou `null` no delta. */
  parte: number | null;
  ultimo: boolean | null;
  registros: number;
  chave: string;
  /** Corpo congelado (JSON): toda retentativa e todo reenvio mandam exatamente este conteúdo (M6). */
  corpo: string;
  loteId: string | null;
  replay: boolean;
  http: number | null;
  /** Respostas retentáveis (429, 5xx, rede) antes da resposta final, com a espera feita. */
  tentativas: TentativaHttp[];
  resultado: LoteResultado | null;
  /**
   * 426 (`versao`): a entidade fica pausada (só ela). 422 `entidade_de_outro_conector` (`topologia`): a entidade é de
   * outro Conector no FDV; o arnês para inteiro, sem insistir em nenhuma entidade (`parado`).
   */
  pausada: MotivoPausaArnes | null;
  /** Recusa do envelope (4xx): status e código, nunca a mensagem do Hub. */
  recusa: { status: number; codigo: string | null } | null;
}

export interface LadoErp {
  readonly nome: NomeLadoErp;
  /** Envia a entidade em lotes de até 5.000 (sessão com partes na carga completa) e espera cada lote terminar. */
  publicar(entrada: PublicacaoEntrada): Promise<LoteEnviado[]>;
  /** Reenvia o MESMO corpo com a MESMA `Idempotency-Key`. */
  reenviar(lote: LoteEnviado): Promise<LoteEnviado>;
  consultarCursor(entidade: EntidadeHub): Promise<CursorHub | null>;
  readonly pausadas: ReadonlySet<EntidadeHub>;
  /** Motivo da parada geral do arnês (`topologia`): depois dela, nada mais vai ao Hub. */
  readonly parado: MotivoPausaArnes | null;
}

export type MotivoPausaArnes = 'versao' | 'topologia';

export const LADOS_ERP = ['conector', 'emissor-minimo'] as const;
export type NomeLadoErp = (typeof LADOS_ERP)[number];

/** Linha de log do arnês: só identificadores, contagens e códigos; nunca valor de campo nem a chave. */
export type EventoLog = Record<string, string | number | boolean | null>;
export type LogArnes = (evento: EventoLog) => void;

// ---------------------------------------------------------------- o que cada adaptador fornece -------------------------

export interface LoteParaEnviar {
  parte: number | null;
  ultimo: boolean | null;
  registros: number;
  chave: string;
  corpo: unknown;
}

export type RespostaTransporte =
  | { tipo: 'ok'; status: number; corpo: unknown; replay: boolean }
  | { tipo: 'retentar'; status: number | null; codigo: string | null; retryAfterMs: number | null }
  /** 426 (`versao`): só a entidade pausa; 422 `entidade_de_outro_conector` (`topologia`): o arnês para. */
  | { tipo: 'pausar_entidade'; status: number; codigo: string | null; motivo: MotivoPausaArnes }
  | { tipo: 'recusa'; status: number; codigo: string | null };

export interface Montador {
  montar(e: PublicacaoEntrada, enviadoEm: string): LoteParaEnviar[];
  /** Quanto esperar antes da tentativa `n + 1` (nunca menos que o `Retry-After`). */
  esperaMs(tentativa: number, retryAfterMs: number | null): number;
}

export interface Transporte {
  chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
    chave?: string,
  ): Promise<RespostaTransporte>;
}

export interface OpcoesLado {
  relogio: Relogio;
  log: LogArnes;
  /** Intervalo entre consultas do lote (padrão 2 s). */
  consultaMs?: number;
  /** Prazo total da consulta de um lote (padrão 10 min). */
  prazoConsultaMs?: number;
  maxTentativas?: number;
}

export class ErroLadoErp extends Error {
  override readonly name = 'ErroLadoErp';
}

export function criarLadoErp(
  nome: NomeLadoErp,
  montador: Montador,
  transporte: Transporte,
  o: OpcoesLado,
): LadoErp {
  const consultaMs = o.consultaMs ?? 2000;
  const prazoConsultaMs = o.prazoConsultaMs ?? 600_000;
  const maxTentativas = o.maxTentativas ?? 6;
  const pausadas = new Set<EntidadeHub>();
  let parado: MotivoPausaArnes | null = null;

  /** Uma chamada, repetida em `retentar` com o mesmo pedido, respeitando o `Retry-After`. */
  async function chamar(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown, chave?: string) {
    const tentativas: TentativaHttp[] = [];
    for (let n = 1; ; n++) {
      const r = await transporte.chamar(metodo, caminho, corpo, chave);
      if (r.tipo !== 'retentar') return { r, tentativas };
      if (n >= maxTentativas)
        throw new ErroLadoErp(`Hub indisponível após ${n} tentativas (último HTTP ${r.status ?? 'rede'}).`);
      const espera = montador.esperaMs(n, r.retryAfterMs);
      tentativas.push({
        status: r.status,
        codigo: r.codigo,
        retryAfterMs: r.retryAfterMs,
        esperouMs: espera,
      });
      o.log({
        evento: 'retentativa',
        caminho: caminho.split('/')[1] ?? '',
        http: r.status,
        retry_after_ms: r.retryAfterMs,
        espera_ms: espera,
      });
      await o.relogio.dormir(espera);
    }
  }

  async function aguardar(loteId: string): Promise<LoteResultado> {
    const limite = o.relogio.agora().getTime() + prazoConsultaMs;
    for (;;) {
      const { r } = await chamar('GET', `/lotes/${loteId}?limite_erros=5500`);
      if (r.tipo !== 'ok')
        throw new ErroLadoErp(`GET /lotes respondeu HTTP ${r.status} (${r.codigo ?? 'sem código'}).`);
      const res = r.corpo as LoteResultado;
      if (ESTADOS_FINAIS.includes(res.status)) return res;
      if (o.relogio.agora().getTime() > limite)
        throw new ErroLadoErp(`Lote ${loteId} sem estado final no prazo.`);
      await o.relogio.dormir(consultaMs);
    }
  }

  async function enviar(entidade: EntidadeHub, modo: ModoLote, l: LoteParaEnviar): Promise<LoteEnviado> {
    const { r, tentativas } = await chamar('POST', '/lotes', l.corpo, l.chave);
    const lote: LoteEnviado = {
      entidade,
      modo,
      parte: l.parte,
      ultimo: l.ultimo,
      registros: l.registros,
      chave: l.chave,
      corpo: JSON.stringify(l.corpo),
      loteId: null,
      replay: false,
      http: r.status,
      tentativas,
      resultado: null,
      pausada: null,
      recusa: null,
    };
    if (r.tipo === 'pausar_entidade') {
      pausadas.add(entidade);
      lote.pausada = r.motivo;
      if (r.motivo === 'topologia') parado = 'topologia';
      o.log({ evento: 'entidade_pausada', entidade, motivo: r.motivo, http: r.status });
      return lote;
    }
    if (r.tipo !== 'ok') {
      lote.recusa = { status: r.status ?? 0, codigo: r.codigo };
      o.log({ evento: 'lote_recusado', entidade, http: r.status, codigo: r.codigo });
      return lote;
    }
    const aceito = r.corpo as LoteAceito;
    lote.loteId = aceito.lote_id;
    lote.replay = r.replay;
    o.log({
      evento: 'lote_aceito',
      entidade,
      modo,
      parte: l.parte,
      registros: l.registros,
      lote_id: aceito.lote_id,
      replay: r.replay,
      http: r.status,
    });
    lote.resultado = await aguardar(aceito.lote_id);
    const c = lote.resultado.contagens;
    o.log({
      evento: 'lote_concluido',
      entidade,
      lote_id: aceito.lote_id,
      status: lote.resultado.status,
      recebidas: c.recebidas,
      com_erro: c.com_erro,
      novas: c.novas,
      atualizadas: c.atualizadas,
      inalteradas: c.inalteradas,
    });
    // só o índice da linha no lote e o código: o `external_id` do kit pode ser CPF ou CNPJ (LGPD), não sai em log
    for (const e of lote.resultado.erros) {
      o.log({
        evento: 'linha_com_erro',
        entidade,
        lote_id: aceito.lote_id,
        indice: e.indice,
        codigo: e.codigo,
        campo: e.campo,
        reprocessavel: e.reprocessavel,
      });
    }
    return lote;
  }

  return {
    nome,
    pausadas,
    get parado() {
      return parado;
    },
    async publicar(entrada) {
      if (parado || pausadas.has(entrada.entidade)) return [];
      const enviados: LoteEnviado[] = [];
      for (const l of montador.montar(entrada, o.relogio.agora().toISOString())) {
        const lote = await enviar(entrada.entidade, entrada.modo, l);
        enviados.push(lote);
        if (lote.pausada || lote.recusa) break;
      }
      return enviados;
    },
    reenviar(lote) {
      if (parado) return Promise.reject(new ErroLadoErp(`Arnês parado (${parado}): nada mais vai ao Hub.`));
      return enviar(lote.entidade, lote.modo, {
        parte: lote.parte,
        ultimo: lote.ultimo,
        registros: lote.registros,
        chave: lote.chave,
        corpo: JSON.parse(lote.corpo) as unknown,
      });
    },
    async consultarCursor(entidade) {
      const { r } = await chamar('GET', `/cursores/${entidade}`);
      if (r.tipo !== 'ok') throw new ErroLadoErp(`GET /cursores respondeu HTTP ${r.status}.`);
      return (r.corpo as { cursor: CursorHub | null }).cursor;
    },
  };
}
