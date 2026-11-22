import type { Perfil } from '@macuxierp/platform-sdk';

/** LGPD (regra 8): o vendedor nunca recebe o documento do cliente (lista, CSV e detalhe usam esta única função). */
export const podeVerDocumentoCliente = (perfil: Perfil): boolean => perfil !== 'vendedor';

/** Devolve o retrato sem o documento para quem não pode vê-lo; os demais perfis recebem o retrato como está. */
export function ocultarDocumento<R extends { documento: string | null }>(retrato: R, perfil: Perfil): R | (Omit<R, 'documento'> & { documento: null }) {
  return podeVerDocumentoCliente(perfil) ? retrato : { ...retrato, documento: null };
}
