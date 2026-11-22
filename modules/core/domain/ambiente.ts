/**
 * Ambiente fiscal por filial emissora (RN-CORE-08, ADR 0006): pelo tenant, só se volta (ou fica) em homologação;
 * a ida para produção é do operador, com o recado de aprovação conferido.
 */
export type Ambiente = 'homologacao' | 'producao';

export type AvaliacaoAmbienteTenant =
  | { ok: true; ambiente: 'homologacao'; muda: boolean }
  | { ok: false; mensagem: string };

export const MENSAGEM_PRODUCAO_DO_OPERADOR = 'A troca para produção fiscal é feita pela Macuxi, com a aprovação do Alexandre';

export function avaliarTrocaAmbienteTenant(t: {
  /** `null` = sem linha (vale homologação). */
  atual: Ambiente | null;
  novo: Ambiente;
}): AvaliacaoAmbienteTenant {
  if (t.novo === 'producao') return { ok: false, mensagem: MENSAGEM_PRODUCAO_DO_OPERADOR };
  return { ok: true, ambiente: 'homologacao', muda: t.atual !== 'homologacao' };
}
