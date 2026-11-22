/**
 * Envelopes dos documentos assinados, sem reescrever nenhum byte deles (a assinatura continua conferível):
 * - `nfeProc`: a NF-e assinada com o `protNFe` da autorização, o XML que se guarda antes de qualquer outra coisa
 *   (regra 7; desenho T-0045 §3.1, item 4). Valide com `validarXsd(proc, 'procNFe')`;
 * - `enviNFe`: o lote de autorização; `envEvento`: o lote de um evento (cancelamento ou CC-e).
 * Quem chama já validou o pedido no contrato (`validarPedidoSefaz`); aqui não se repete a regra do Zod.
 */
import type { PedidoAutorizacao } from './porta';
import { NS_NFE } from './xmldsig';

const DECLARACAO = /^\uFEFF?\s*<\?xml[^?]*\?>\s*/;

/** Tira a declaração `<?xml ...?>` (e o BOM) do início, para embutir o documento em outro. */
export function semDeclaracaoXml(xml: string): string {
  return xml.replace(DECLARACAO, '');
}

export function montarNfeProc(nfeAssinada: string, protNFe: string): string {
  return `<nfeProc xmlns="${NS_NFE}" versao="4.00">${semDeclaracaoXml(nfeAssinada)}${semDeclaracaoXml(protNFe)}</nfeProc>`;
}

/** `<enviNFe>` do pedido (já validado em `PedidoAutorizacao`). Valide com `validarXsd(lote, 'enviNFe')`. */
export function montarEnviNFe(p: PedidoAutorizacao): string {
  const nfes = p.nfes.map(semDeclaracaoXml).join('');
  return `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${p.idLote}</idLote><indSinc>${p.sincrono ? 1 : 0}</indSinc>${nfes}</enviNFe>`;
}

/** `<envEvento>` com um `<evento>` assinado. Valide com `validarXsd(lote, 'envEventoCancNFe' | 'envCCe')`. */
export function montarEnvEvento(idLote: string, eventoAssinado: string): string {
  return `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${idLote}</idLote>${semDeclaracaoXml(eventoAssinado)}</envEvento>`;
}
