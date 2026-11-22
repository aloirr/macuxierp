/**
 * Corpos do sinal de vida e da reconciliação diária (T-0009 seção 6; formato conferido no FDV, P-1, L2a). Sem I/O.
 * Os cabeçalhos HTTP são do ClienteHub do SDK.
 */
import { VERSAO_CONECTOR_HUB } from '@macuxierp/platform-sdk';
import { VERSAO_CONTRATO_HUB, type CorpoReconciliacao, type CorpoSinal, type EntidadeHub, type MotivoPausa } from '../contracts';
import { limiteRegistrosDoLote } from './lote';

/** Nível de compatibilidade de Conector (P-2, opção A): a constante é do SDK, que também põe o cabeçalho; reexportada aqui. */
export { VERSAO_CONECTOR_HUB };

export interface EntradaSinal {
  conectorId: string;
  em: string;
  /** Registros do espelho ainda por enviar, por entidade, com o `alterado_em` do mais antigo. */
  pendentes: Readonly<Partial<Record<EntidadeHub, { registros: number; maisAntigo: string | null }>>>;
  /** Lotes em voo (montado, enviando, aceito) por entidade e os registros deles. */
  emVoo: Readonly<Partial<Record<EntidadeHub, { lotes: number; registros: number }>>>;
  entidades: ReadonlyArray<{ entidade: EntidadeHub; ultimo_sucesso_em: string | null; completa: boolean; pausada_motivo: MotivoPausa | null }>;
  paradoPorVersao?: boolean;
  /** Teto de registros por lote da credencial: base da estimativa de lotes pendentes (sem ele, o do contrato). */
  limiteRegistrosLote?: number;
}

/** Instante mais antigo (ISO UTC); `null` se nenhum. */
function maisAntigo(datas: ReadonlyArray<string | null>): string | null {
  const v = datas.filter((d): d is string => d !== null).sort();
  return v[0] ?? null;
}

/**
 * Corpo do `POST /sinal`: contagens, datas e situação por entidade. Nenhum dado pessoal nem identificador de registro.
 * `fila` tem uma linha por estado (`pendente` = no espelho por enviar; `em_voo` = lote já montado), só se houver algo.
 */
export function montarCorpoSinal(e: EntradaSinal): CorpoSinal {
  const pend = Object.values(e.pendentes).filter((p): p is { registros: number; maisAntigo: string | null } => p !== undefined && p.registros > 0);
  const voo = Object.values(e.emVoo).filter((p): p is { lotes: number; registros: number } => p !== undefined && p.lotes > 0);
  const limite = limiteRegistrosDoLote(e.limiteRegistrosLote);
  const fila: CorpoSinal['fila'] = [];
  if (pend.length > 0) {
    fila.push({
      estado: 'pendente',
      lotes: pend.reduce((s, p) => s + Math.ceil(p.registros / limite), 0),
      linhas: pend.reduce((s, p) => s + p.registros, 0),
      maisAntigo: maisAntigo(pend.map((p) => p.maisAntigo)),
    });
  }
  if (voo.length > 0) {
    fila.push({ estado: 'em_voo', lotes: voo.reduce((s, p) => s + p.lotes, 0), linhas: voo.reduce((s, p) => s + p.registros, 0), maisAntigo: null });
  }
  return {
    versao_contrato: VERSAO_CONTRATO_HUB,
    conector_id: e.conectorId,
    versao_conector: VERSAO_CONECTOR_HUB,
    em: e.em,
    fila,
    entidades: e.entidades.map((x) => ({
      entidade: x.entidade,
      fase: x.completa ? ('completo' as const) : ('delta' as const),
      ultimo_sucesso: x.ultimo_sucesso_em,
      bloqueada: x.pausada_motivo !== null,
      lotes_na_fila: e.emVoo[x.entidade]?.lotes ?? 0,
    })),
    ...(e.paradoPorVersao ? { parado_por_versao: true } : {}),
  };
}

/** Corpo do `POST /reconciliacoes` (uma entidade por chamada): contagem de ativos do espelho, `soma` nula na v1. */
export function montarCorpoReconciliacao(entidade: EntidadeHub, dataReferencia: string, contagem: number): CorpoReconciliacao {
  return { versao_contrato: VERSAO_CONTRATO_HUB, entidade, data_referencia: dataReferencia, contagem, soma: null };
}

/** Próxima reconciliação: 06h00 UTC (02h00 de Manaus) do dia seguinte ao instante dado. */
export function proximaReconciliacaoEm(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1, 6, 0, 0, 0));
}

/** Data civil (UTC) de referência da reconciliação do instante dado: `AAAA-MM-DD`. */
export function dataReferenciaReconciliacao(agora: Date): string {
  return agora.toISOString().slice(0, 10);
}
