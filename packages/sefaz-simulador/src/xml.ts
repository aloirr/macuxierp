/**
 * Escrita das respostas do simulador. A leitura dos documentos recebidos é a do `@macuxierp/nfe-sefaz` (`lerXml`, que
 * recusa `<!DOCTYPE`, e `filhoNfe`, que só segue os caminhos do leiaute); aqui fica o texto do filho.
 */
import { filhoNfe } from '@macuxierp/nfe-sefaz';

function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Elemento com texto escapado; `null`/`undefined` omitem a tag (campos opcionais do leiaute). */
export function tag(nome: string, valor: string | number | null | undefined): string {
  return valor === null || valor === undefined ? '' : `<${nome}>${escaparXml(String(valor))}</${nome}>`;
}

/** Texto do filho no caminho (aparado) ou `''`. */
export function texto(el: Element | null | undefined, ...caminho: string[]): string {
  return filhoNfe(el, ...caminho)?.textContent?.trim() ?? '';
}
