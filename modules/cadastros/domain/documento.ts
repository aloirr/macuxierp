import { cnpjValido, cpfValido, normalizarDocumento } from '@macuxierp/platform-sdk';
import { violacao, type Violacao } from './violacao';

export type ResultadoDocumento = { ok: true; documento: string } | { ok: false; violacao: Violacao };

/** RN-CAD-01: CNPJ (PJ) ou CPF (PF) pelo dígito verificador; a regra mora no platform-sdk, sem cópia. */
export function validarDocumentoCliente(tipo: 'PJ' | 'PF', valor: string): ResultadoDocumento {
  const documento = normalizarDocumento(valor);
  const ok = tipo === 'PJ' ? cnpjValido(documento) : cpfValido(documento);
  return ok
    ? { ok: true, documento }
    : { ok: false, violacao: violacao('RN-CAD-01', 'documento', tipo === 'PJ' ? 'CNPJ inválido' : 'CPF inválido') };
}
