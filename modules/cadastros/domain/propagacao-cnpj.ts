import { normalizarDocumento } from '@macuxierp/platform-sdk';

/**
 * RN-CORE-14 e RN-CORE-16: a filial padrão leva o mesmo CNPJ da empresa. Só grava (e audita e emite) quando o CNPJ muda;
 * o mesmo CNPJ, com ou sem máscara, é no-op.
 */
export function precisaGravarCnpjDaFilialPadrao(atual: string | null, novo: string): boolean {
  return normalizarDocumento(atual ?? '') !== normalizarDocumento(novo);
}
