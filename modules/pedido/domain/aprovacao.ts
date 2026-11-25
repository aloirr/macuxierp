import type { Pendencia } from '../contracts';

/** RN-PED-03: só pedido manual: sem pendência aprova sozinho; com qualquer uma vai para análise. */
export const decisaoAutomatica = (pendencias: readonly Pendencia[]): 'aprovado' | 'em_analise' => (pendencias.length === 0 ? 'aprovado' : 'em_analise');

const PRAZO: ReadonlySet<string> = new Set(['prazo_incompleto', 'prazo_acima_do_cliente']);

export type DecisaoAprovacao =
  | { ok: true; pendencias_aceitas: Pendencia[]; pendencias_gravar: Pendencia[]; justificativa: string | null }
  | { ok: false; tipo: 'regra'; rn: 'RN-PED-03'; bloqueantes: Pendencia[]; mensagem: string }
  | { ok: false; tipo: 'entrada'; campo: 'justificativa'; mensagem: string };

/**
 * RN-PED-03: aprovação humana. Bloqueante impede (422); não bloqueante exige justificativa (400) e é gravada
 * como pendência aceita. A API revalida antes de chamar.
 */
export function decidirAprovacao(pendencias: readonly Pendencia[], justificativa?: string | null, origem: 'manual' | 'fdv' = 'manual'): DecisaoAprovacao {
  // RN-PED-07 (emenda de 24/11, migração 0056): no pedido do FDV, a pendência de prazo (bloqueante no recebimento) pode ser aceita
  // pelo analista, com justificativa: vira não bloqueante e é a única pendência gravada no aprovado (CHECK pedido_fdv_sem_pendencia).
  const aceitaPrazo = origem === 'fdv';
  const efetivas = aceitaPrazo ? pendencias.map((p) => (PRAZO.has(p.codigo) ? { ...p, bloqueante: false } : p)) : [...pendencias];
  const bloqueantes = efetivas.filter((p) => p.bloqueante);
  if (bloqueantes.length > 0) {
    return { ok: false, tipo: 'regra', rn: 'RN-PED-03', bloqueantes, mensagem: 'Pedido com pendência bloqueante não pode ser aprovado' };
  }
  const texto = justificativa?.trim() || null;
  if (efetivas.length > 0 && !texto) {
    return { ok: false, tipo: 'entrada', campo: 'justificativa', mensagem: 'A justificativa é obrigatória para aprovar com pendência' };
  }
  return { ok: true, pendencias_aceitas: efetivas, pendencias_gravar: aceitaPrazo ? efetivas.filter((p) => PRAZO.has(p.codigo)) : efetivas, justificativa: texto };
}
