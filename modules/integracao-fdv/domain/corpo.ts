/**
 * Corpo do sinal de vida (T-0009 seção 6). Sem I/O. Os cabeçalhos HTTP são do ClienteHub do SDK.
 */
import { VERSAO_CONTRATO_HUB, type CorpoSinal, type EntidadeHub, type MotivoPausa } from '../contracts';

/**
 * Nível de compatibilidade de Conector que o ERP implementa (P-2, opção A, decidida pelo dono do produto em 21/11/2026).
 * A versão real do ERP (0.x) NUNCA vai neste nível: cairia em `abaixo_da_minima` (426). Quem põe o cabeçalho é o ClienteHub do SDK.
 */
export const VERSAO_CONECTOR_HUB = '1.4.0';

export interface EntradaSinal {
  conectorId: string;
  em: string;
  /** Registros pendentes por entidade. */
  pendentes: Readonly<Partial<Record<EntidadeHub, number>>>;
  entidades: ReadonlyArray<{ entidade: EntidadeHub; ultimo_envio_em: string | null; pausada_motivo: MotivoPausa | null }>;
  paradoPorVersao?: boolean;
}

/** Corpo do `POST /sinal`: contagens, datas e situação por entidade. Nenhum dado pessoal nem identificador de registro. */
export function montarCorpoSinal(e: EntradaSinal): CorpoSinal {
  return {
    versao_contrato: VERSAO_CONTRATO_HUB,
    conector_id: e.conectorId,
    versao_conector: VERSAO_CONECTOR_HUB,
    em: e.em,
    fila: e.entidades.map((x) => ({ entidade: x.entidade, pendentes: e.pendentes[x.entidade] ?? 0 })),
    entidades: e.entidades.map((x) => ({
      entidade: x.entidade,
      ultimo_envio_em: x.ultimo_envio_em,
      situacao: x.pausada_motivo ? ('pausada' as const) : ('ok' as const),
    })),
    ...(e.paradoPorVersao ? { parado_por_versao: true } : {}),
  };
}
