/**
 * Curva de retentativa do Hub e classificação de resposta HTTP (RN-INF-04, T-0009 seção 5).
 * A curva é própria do módulo (5 s a 15 min); não é a `proximaTentativa` padrão do worker.
 */
import type { MotivoPausa } from '../contracts';

export const ATRASO_INICIAL_S = 5;
export const ATRASO_MAXIMO_S = 15 * 60;
/** Teto para um `Retry-After` do Hub: respeitamos, mas nunca esperamos mais que 1 hora. */
export const RETRY_AFTER_MAXIMO_S = 60 * 60;

/** `tentativa` conta a partir de 1 (a falha que acabou de acontecer): 5 s, 10 s, 20 s… até 15 min. */
export function atrasoRetentativaSegundos(tentativa: number, retryAfterSegundos?: number | null): number {
  const n = Math.max(1, Math.floor(tentativa));
  const curva = Math.min(ATRASO_INICIAL_S * 2 ** Math.min(n - 1, 20), ATRASO_MAXIMO_S);
  if (retryAfterSegundos == null || !Number.isFinite(retryAfterSegundos) || retryAfterSegundos <= 0) return curva;
  return Math.max(curva, Math.min(Math.ceil(retryAfterSegundos), RETRY_AFTER_MAXIMO_S));
}

/**
 * Espelha o `RespostaHub` do SDK (C-9); trocar por import quando o SDK entrar.
 * `recusa` não traz corpo nem mensagem: só status e `codigo` (identificador).
 */
export type RespostaHub =
  | { tipo: 'ok'; status: number; corpo: unknown; replay: boolean }
  | { tipo: 'retentavel'; status: number | null; codigo: string | null; retryAfterMs: number | null }
  | { tipo: 'recusa'; status: number; codigo: string | null };

export type AcaoResposta =
  | { acao: 'ok' }
  | { acao: 'replay' }
  | { acao: 'retentar'; retryAfterSegundos: number | null; codigo: string }
  /** 413: dividir o lote ao meio, com geração nova. */
  | { acao: 'dividir' }
  | { acao: 'pausar'; motivo: MotivoPausa; codigo: string; todasEntidades: boolean };

const FORMATO_CODIGO = /^[a-z][a-z0-9_]{0,59}$/;

/**
 * Código vindo do Hub só passa se tiver o formato de identificador (`CodigoErro`); senão vira `http_<status>` (ou `rede`
 * sem status). Evita gravar texto livre do Hub no monitor, no evento ou no banco.
 */
export function codigoSeguro(codigo: string | null | undefined, status: number | null): string {
  if (codigo != null && FORMATO_CODIGO.test(codigo)) return codigo;
  return status ? `http_${status}` : 'rede';
}

/** Classifica a resposta do SDK em ação. */
export function classificarResposta(r: RespostaHub): AcaoResposta {
  if (r.tipo === 'ok') return r.replay ? { acao: 'replay' } : { acao: 'ok' };
  if (r.tipo === 'retentavel') {
    return {
      acao: 'retentar',
      retryAfterSegundos: r.retryAfterMs == null ? null : Math.ceil(r.retryAfterMs / 1000),
      codigo: codigoSeguro(r.codigo, r.status),
    };
  }
  const { status } = r;
  const codigo = r.codigo == null ? null : codigoSeguro(r.codigo, status);
  /** 413 e 422 `acima_do_limite`: o ERP divide o lote e reenvia, com geração nova. */
  if (status === 413 || (status === 422 && codigo === 'acima_do_limite')) return { acao: 'dividir' };
  if (status === 401) return { acao: 'pausar', motivo: 'credencial', codigo: codigo ?? 'credencial_invalida', todasEntidades: true };
  if (status === 403) {
    if (codigo === 'modulo_inativo') return { acao: 'pausar', motivo: 'licenca_fdv', codigo, todasEntidades: true };
    return { acao: 'pausar', motivo: 'credencial', codigo: codigo ?? 'credencial_revogada', todasEntidades: true };
  }
  if (status === 426) return { acao: 'pausar', motivo: 'versao', codigo: codigo ?? 'abaixo_da_minima', todasEntidades: false };
  if (status === 409 && codigo === 'chave_idempotencia_reutilizada') {
    return { acao: 'pausar', motivo: 'idempotencia', codigo, todasEntidades: false };
  }
  if (status === 422 && codigo === 'entidade_de_outro_conector') {
    return { acao: 'pausar', motivo: 'topologia', codigo, todasEntidades: false };
  }
  // Demais recusas (envelope inválido, 400, 404, 409 de outro tipo): defeito do ERP, sem retentativa.
  return { acao: 'pausar', motivo: 'envelope', codigo: codigo ?? `http_${status}`, todasEntidades: false };
}
