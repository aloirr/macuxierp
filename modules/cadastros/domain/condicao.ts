import { ehFormaAVista } from '../contracts';
import { violacao, type Violacao } from './violacao';

/** RN-CAD-09: forma à vista não admite prazo maior que 0 (critério em ehAVista, contracts). */
export const MOTIVO_A_VISTA_COM_PRAZO = 'Forma de pagamento à vista exige todos os prazos iguais a 0';

export function validarCondicaoPagamento(c: { forma_tpag: string; prazos_dias: readonly number[] }): Violacao[] {
  const aVista = ehFormaAVista(c.forma_tpag);
  if (aVista && c.prazos_dias.some((p) => p > 0)) {
    return [violacao('RN-CAD-09', 'prazos_dias', MOTIVO_A_VISTA_COM_PRAZO)];
  }
  return [];
}
