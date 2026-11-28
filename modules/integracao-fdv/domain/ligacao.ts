/**
 * Ligação ERP → Macuxi FDV na aba Integração da Config (T-0131, opção A do PO; RN-INF-13): contadores Enviados e Aceitos e o
 * cabeçalho do Contato. Funções puras sobre o que o monitor já guarda (`lote_envio`, `sinal`, `credencial`): sem "Gravados".
 */
import { situacaoConectorFdv, type AmbienteIntegracaoFdv, type SituacaoConectorFdv } from '@macuxierp/platform-sdk';

/** Lotes que de fato foram ao Hub (RN-INF-13). `montado`, `falhou` e `recusado` não contam. */
export const ESTADOS_ENVIADOS_AO_HUB = Object.freeze(['enviando', 'aceito', 'concluido', 'concluido_com_erros'] as const);

export function loteContaComoEnviado(l: { estado: string; repetido: boolean }): boolean {
  return !l.repetido && (ESTADOS_ENVIADOS_AO_HUB as readonly string[]).includes(l.estado);
}

export interface GrupoLotes { estado: string; repetido: boolean; registros: number; aceitos: number }
export interface Contadores { enviados: number; aceitos: number }

/** Enviados = soma de `registros`; Aceitos = soma de `aceitos` (limitada a Enviados). O lote repetido não conta duas vezes. */
export function contarLigacao(grupos: readonly GrupoLotes[]): Contadores {
  let enviados = 0;
  let aceitos = 0;
  for (const g of grupos) {
    if (!loteContaComoEnviado(g)) continue;
    enviados += Math.max(0, g.registros);
    aceitos += Math.min(Math.max(0, g.aceitos), Math.max(0, g.registros));
  }
  return { enviados, aceitos };
}

export interface ContatoSaida {
  conector_id: string | null;
  ambiente: AmbienteIntegracaoFdv | null;
  chave_prefixo: string | null;
  situacao: SituacaoConectorFdv;
  ultimo_contato_em: string | null;
}

/** Cabeçalho só de leitura: a situação segue a regra do SDK (`situacaoConectorFdv`); o último contato é o último sinal aceito. */
export function montarContatoSaida(e: {
  credencial: { conector_id: string; ambiente: AmbienteIntegracaoFdv; chave_prefixo: string; habilitadas: number } | null;
  ultimo_aceito_em: string | null;
  agora: Date;
}): ContatoSaida {
  const c = e.credencial;
  return {
    conector_id: c?.conector_id ?? null,
    ambiente: c?.ambiente ?? null,
    chave_prefixo: c?.chave_prefixo ?? null,
    situacao: situacaoConectorFdv({ credencial_ativa: c !== null, habilitadas: c?.habilitadas ?? 0, ultimo_sinal_em: e.ultimo_aceito_em, agora: e.agora }),
    ultimo_contato_em: e.ultimo_aceito_em,
  };
}
