/**
 * ADR 0014 §3, carga completa (RN-INT-06, copiada do FDV). Funções puras: a API/worker guarda o estado e chama estas funções.
 * Uma sessão ocupa vários lotes (parte 1, 2... e o "último"). Só ao concluir o último, os ativos da entidade NÃO vistos desde o
 * início da sessão são inativados (`deleted_at`, nunca apagados). Sessão incompleta não inativa nada; o registro que veio inválido
 * nunca é inativado (o external_id dele protege). Trava de 30% (`limite_inativacao_pct`): acima dela as inativações param em
 * `aguardando_confirmacao` e a confirmação vale 7 dias (quem confirma é o superadmin no /config; fora do domain).
 * O plano (quem sai, quantos em uso, ativos sem chave) é o `planoSubstituicao` da carga (RN-CAD-10), sem repetir o cálculo.
 */
import type { EntidadeCarga } from '../../contracts';
import { planoSubstituicao, type ExistenteSubstituicao } from '../carga/substituicao';
import { ENTIDADE_DA_CARGA, type EntidadeEntrada } from './adaptar';

export const LIMITE_INATIVACAO_PCT_PADRAO = 30;
export const VALIDADE_CONFIRMACAO_DIAS = 7;

export interface SessaoCarga {
  id: string;
  entidade: EntidadeEntrada;
  /** UTC ISO: o que não for visto desde aqui é candidato a inativar. */
  iniciada_em: string;
  ultima_parte: number;
  ultimo_recebido: boolean;
  /** `external_id` (da entidade da carga) vistos em qualquer parte, válidos ou inválidos. */
  vistos: readonly string[];
}

export function iniciarSessao(p: { id: string; entidade: EntidadeEntrada; iniciada_em: string }): SessaoCarga {
  return { ...p, ultima_parte: 0, ultimo_recebido: false, vistos: [] };
}

export type ResultadoParte =
  | { ok: true; sessao: SessaoCarga; repetida: boolean }
  | { ok: false; codigo: 'parte_fora_de_ordem' | 'sessao_encerrada' };

/**
 * Registra a parte `n` (a próxima na ordem). Parte já registrada é idempotente (reenvio do Conector); parte que pula número é
 * `parte_fora_de_ordem`; depois do "último" vale `sessao_encerrada`. `externos` = ids válidos da parte; `protegidos` = ids inválidos.
 */
export function registrarParte(s: SessaoCarga, p: { parte: number; ultimo: boolean; externos: readonly string[]; protegidos: readonly string[] }): ResultadoParte {
  if (p.parte >= 1 && p.parte <= s.ultima_parte) return { ok: true, sessao: s, repetida: true };
  if (s.ultimo_recebido) return { ok: false, codigo: 'sessao_encerrada' };
  if (p.parte !== s.ultima_parte + 1) return { ok: false, codigo: 'parte_fora_de_ordem' };
  const vistos = [...new Set([...s.vistos, ...p.externos, ...p.protegidos])];
  return { ok: true, repetida: false, sessao: { ...s, ultima_parte: p.parte, ultimo_recebido: p.ultimo, vistos } };
}

/** Entidade da carga cujos ativos a sessão inativa; `null` = a sessão não inativa nada (forma sozinha e endereço não têm linha própria). */
export function alvoDaInativacao(entidade: EntidadeEntrada): EntidadeCarga | null {
  return entidade === 'forma_pagamento' || entidade === 'cliente_endereco' ? null : ENTIDADE_DA_CARGA[entidade];
}

export type ResultadoSessao =
  | { estado: 'incompleta'; inativar: [] }
  | { estado: 'concluida'; inativar: string[]; mantidos_em_uso: number; sem_chave: number }
  | { estado: 'aguardando_confirmacao'; inativar: string[]; mantidos_em_uso: number; sem_chave: number; percentual_pct: number; limite_pct: number; expira_em: string };

const MS_DIA = 86_400_000;

/**
 * Fecha a sessão. `existentes` = os cadastros da entidade no tenant; `limite_inativacao_pct` de 0 a 100 (padrão 30).
 * A trava compara as contagens (`inativar * 100 > limite * ativos com chave`), sem o percentual arredondado do plano da carga.
 */
export function concluirSessao(p: {
  sessao: SessaoCarga;
  existentes: readonly ExistenteSubstituicao[];
  em_uso: ReadonlySet<string>;
  limite_inativacao_pct?: number;
  agora: string;
}): ResultadoSessao {
  const limite = p.limite_inativacao_pct ?? LIMITE_INATIVACAO_PCT_PADRAO;
  if (!(limite >= 0 && limite <= 100)) throw new RangeError('limite_inativacao_pct de 0 a 100');
  if (!p.sessao.ultimo_recebido) return { estado: 'incompleta', inativar: [] };
  const plano = planoSubstituicao({ modo: 'substituir_tudo', entidade: p.sessao.entidade, externos_do_arquivo: p.sessao.vistos, existentes: p.existentes, em_uso: p.em_uso });
  const base = { inativar: plano.inativar, mantidos_em_uso: plano.mantidos_em_uso, sem_chave: plano.sem_chave };
  const ativosComChave = p.existentes.filter((e) => !e.inativo && e.external_id !== null).length;
  if (plano.inativar.length * 100 <= limite * ativosComChave) return { estado: 'concluida', ...base };
  return {
    estado: 'aguardando_confirmacao', ...base,
    percentual_pct: Math.round((plano.inativar.length / ativosComChave) * 10_000) / 100,
    limite_pct: limite,
    expira_em: new Date(Date.parse(p.agora) + VALIDADE_CONFIRMACAO_DIAS * MS_DIA).toISOString(),
  };
}

/** Confirmação da trava: vale até `expira_em` (exclusive); depois, as inativações não saem e a carga completa precisa ser repetida. */
export function confirmarInativacao(pendente: { inativar: readonly string[]; expira_em: string }, agora: string): { ok: true; inativar: string[] } | { ok: false; codigo: 'confirmacao_expirada' } {
  return Date.parse(agora) < Date.parse(pendente.expira_em) ? { ok: true, inativar: [...pendente.inativar] } : { ok: false, codigo: 'confirmacao_expirada' };
}
