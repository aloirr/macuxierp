/**
 * Envelopes dos documentos de evento que se guardam em `nota_xml` (RN-FAT-03), sem reescrever nenhum byte dos documentos (a assinatura segue
 * conferível), como o `montarNfeProc` do `@macuxierp/nfe-sefaz` faz com a NF-e. O XML do evento e da inutilização é montado e assinado pela
 * porta `EmissorNFe`; aqui só se junta o documento assinado com o retorno da SEFAZ.
 */
import { NS_NFE, semDeclaracaoXml } from '@macuxierp/nfe-sefaz';

/** `procEventoNFe` (leiaute 1.00): o `<evento>` assinado e o `<retEvento>`. */
export const montarProcEvento = (eventoAssinado: string, retEvento: string): string =>
  `<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${semDeclaracaoXml(eventoAssinado)}${semDeclaracaoXml(retEvento)}</procEventoNFe>`;

/** `ProcInutNFe` (leiaute 4.00): o `<inutNFe>` assinado e o `<retInutNFe>`. */
export const montarProcInutilizacao = (inutAssinada: string, retInut: string): string =>
  `<ProcInutNFe xmlns="${NS_NFE}" versao="4.00">${semDeclaracaoXml(inutAssinada)}${semDeclaracaoXml(retInut)}</ProcInutNFe>`;

/** Trecho `<procEventoNFe>` do evento `tpEvento` dentro do `retConsSitNFe` (a consulta devolve o evento completo, com a assinatura e o protocolo). */
export function procEventoDaConsulta(xmlConsulta: string, tpEvento: string): string | null {
  for (const m of xmlConsulta.matchAll(/<procEventoNFe\b[\s\S]*?<\/procEventoNFe>/g)) {
    if (m[0].includes(`<tpEvento>${tpEvento}</tpEvento>`)) return m[0].replace(/^<procEventoNFe\b([^>]*)>/, (_, a: string) => (a.includes('xmlns=') ? `<procEventoNFe${a}>` : `<procEventoNFe xmlns="${NS_NFE}"${a}>`));
  }
  return null;
}

/** `xJust` do `<detEvento>` (texto do cancelamento) de um `procEventoNFe`. */
export const justificativaDoProc = (proc: string): string | null => /<xJust>([^<]+)<\/xJust>/.exec(proc)?.[1] ?? null;
