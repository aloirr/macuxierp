import type { Pendencia } from '../contracts';

/** RN-PED-03: sem pendência aprova sozinho; com qualquer uma vai para análise. */
export const decisaoAutomatica = (pendencias: readonly Pendencia[]): 'aprovado' | 'em_analise' => (pendencias.length === 0 ? 'aprovado' : 'em_analise');

export type DecisaoAprovacao =
  | { ok: true; pendencias_aceitas: Pendencia[]; justificativa: string | null }
  | { ok: false; tipo: 'regra'; rn: 'RN-PED-03'; bloqueantes: Pendencia[]; mensagem: string }
  | { ok: false; tipo: 'entrada'; campo: 'justificativa'; mensagem: string };

/**
 * RN-PED-03: aprovação humana. Bloqueante impede (422); não bloqueante exige justificativa (400) e é gravada
 * como pendência aceita. A API revalida antes de chamar.
 */
export function decidirAprovacao(pendencias: readonly Pendencia[], justificativa?: string | null): DecisaoAprovacao {
  const bloqueantes = pendencias.filter((p) => p.bloqueante);
  if (bloqueantes.length > 0) {
    return { ok: false, tipo: 'regra', rn: 'RN-PED-03', bloqueantes, mensagem: 'Pedido com pendência bloqueante não pode ser aprovado' };
  }
  const texto = justificativa?.trim() || null;
  if (pendencias.length > 0 && !texto) {
    return { ok: false, tipo: 'entrada', campo: 'justificativa', mensagem: 'A justificativa é obrigatória para aprovar com pendência' };
  }
  return { ok: true, pendencias_aceitas: [...pendencias], justificativa: texto };
}
