/** Ambiente fiscal por filial emissora (RN-CORE-08): produção só com o recado de aprovação registrado. */
import { PADRAO_RECADO_APROVACAO } from '../contracts';

export type Ambiente = 'homologacao' | 'producao';

export type AvaliacaoAmbiente =
  | { ok: true; ambiente: Ambiente; recado: string | null }
  | { ok: false; mensagem: string };

export interface TrocaAmbiente {
  /** `null` = sem linha (vale homologação). */
  atual: Ambiente | null;
  novo: Ambiente;
  recado: string | null;
}

export function avaliarTrocaAmbiente(t: TrocaAmbiente): AvaliacaoAmbiente {
  if (t.novo === 'homologacao') return { ok: true, ambiente: 'homologacao', recado: null };
  if (!t.recado || !PADRAO_RECADO_APROVACAO.test(t.recado)) {
    return { ok: false, mensagem: 'Produção fiscal exige o id do recado de aprovação (formato R-AAAAMMDD-HHMMSS-<aprovador>)' };
  }
  return { ok: true, ambiente: 'producao', recado: t.recado };
}
