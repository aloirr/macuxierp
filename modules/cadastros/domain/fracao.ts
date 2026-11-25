import { validarFracaoDaQuantidade } from '../contracts';
import { violacao, type Violacao } from './violacao';

/** RN-CAD-17: violação (422 no campo) quando a quantidade ×10^4 é fracionária numa unidade que só aceita inteiros; `null` se passa. */
export function violacaoFracao(campo: string, unidade: string | null | undefined, quantidade: number): Violacao | null {
  const r = validarFracaoDaQuantidade(unidade, quantidade);
  return r.ok ? null : violacao('RN-CAD-17', campo, r.motivo);
}
