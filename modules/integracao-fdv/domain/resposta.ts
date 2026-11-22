/**
 * Curva de retentativa do Hub e classificação de resposta HTTP (RN-INF-04, T-0009 seção 5).
 * A curva é própria do módulo (5 s a 15 min); não é a `proximaTentativa` padrão do worker.
 */
import type { RespostaHub } from '@macuxierp/platform-sdk';
import { CampoErro, CodigoErro, type MotivoPausa } from '../contracts';

export type { RespostaHub };

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

export type AcaoResposta =
  | { acao: 'ok' }
  | { acao: 'replay' }
  | { acao: 'retentar'; retryAfterSegundos: number | null; codigo: string }
  /** 413: dividir o lote ao meio, com geração nova. */
  | { acao: 'dividir' }
  | { acao: 'pausar'; motivo: MotivoPausa; codigo: string; todasEntidades: boolean };

/** Código do Hub só entra no banco no formato de identificador (`CodigoErro`); senão `erro_desconhecido`. */
export const codigoDoHub = (c: string): string => {
  const v = CodigoErro.safeParse(c);
  return v.success ? v.data : 'erro_desconhecido';
};

/** Campo do Hub só entra no banco no formato de caminho (`CampoErro`); senão `null`. */
export const campoDoHub = (c: string | null | undefined): string | null => {
  const v = CampoErro.safeParse(c ?? null);
  return v.success ? v.data : null;
};

/**
 * Código vindo do Hub só passa se tiver o formato de identificador (`CodigoErro`); senão vira `http_<status>` (ou `rede`
 * sem status). Evita gravar texto livre do Hub no monitor, no evento ou no banco.
 */
export function codigoSeguro(codigo: string | null | undefined, status: number | null): string {
  if (codigo != null) {
    const v = CodigoErro.safeParse(codigo);
    if (v.success) return v.data;
  }
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
  if (status === 426) return { acao: 'pausar', motivo: 'versao', codigo: codigo ?? 'versao_conector_nao_suportada', todasEntidades: false };
  if (status === 409 && codigo === 'chave_idempotencia_reutilizada') {
    return { acao: 'pausar', motivo: 'idempotencia', codigo, todasEntidades: false };
  }
  if (status === 422 && codigo === 'entidade_de_outro_conector') {
    return { acao: 'pausar', motivo: 'topologia', codigo, todasEntidades: false };
  }
  // Demais recusas (envelope inválido, 400, 404, 409 de outro tipo): defeito do ERP, sem retentativa.
  return { acao: 'pausar', motivo: 'envelope', codigo: codigo ?? `http_${status}`, todasEntidades: false };
}

/**
 * Espera até a próxima consulta de um lote aceito (T-0009 seção 4): 5 s no primeiro minuto, depois dobra até 60 s.
 * `decorridoSegundos` = tempo desde o envio do lote.
 */
export function esperaConsultaSegundos(decorridoSegundos: number): number {
  const d = Math.max(0, decorridoSegundos);
  if (d <= 60) return 5;
  if (d <= 120) return 10;
  if (d <= 240) return 20;
  if (d <= 480) return 40;
  return 60;
}
