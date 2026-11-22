/**
 * Leitor mínimo do `nfeProc` guardado (XML da própria SEFAZ/emissor: sem DTD, sem CDATA relevante). Serve só ao DANFE (RF-FAT-03):
 * árvore de elementos com atributos e texto; ignora declaração, comentários e a assinatura não é lida. Função pura.
 */
export interface NoXml {
  nome: string;
  atributos: Record<string, string>;
  filhos: NoXml[];
  texto: string;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
    return ENTIDADES[e] ?? m;
  });

export function lerXml(xml: string): NoXml {
  const raiz: NoXml = { nome: '#raiz', atributos: {}, filhos: [], texto: '' };
  const pilha: NoXml[] = [raiz];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const atual = pilha[pilha.length - 1]!;
    if (m[1] !== undefined) atual.texto += m[1];
    else if (m[2] !== undefined) {
      if (pilha.length === 1 || atual.nome !== m[2]) throw new Error(`XML mal formado: </${m[2]}> inesperado`);
      pilha.pop();
    } else if (m[3] !== undefined) {
      const no: NoXml = { nome: m[3], atributos: {}, filhos: [], texto: '' };
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) no.atributos[a[1]!] = decodificar(a[2] ?? a[3] ?? '');
      atual.filhos.push(no);
      if (m[5] !== '/') pilha.push(no);
    } else if (m[6] !== undefined) atual.texto += decodificar(m[6]);
  }
  if (pilha.length !== 1 || !raiz.filhos[0]) throw new Error('XML mal formado: elemento sem fechamento');
  return raiz.filhos[0];
}

/** Descendente por caminho de nomes (primeiro de cada nível). */
export function achar(no: NoXml | undefined, ...caminho: string[]): NoXml | undefined {
  let atual = no;
  for (const nome of caminho) {
    atual = atual?.filhos.find((f) => f.nome === nome);
    if (!atual) return undefined;
  }
  return atual;
}
export const textoDe = (no: NoXml | undefined, ...caminho: string[]): string => achar(no, ...caminho)?.texto.trim() ?? '';
export const todos = (no: NoXml | undefined, nome: string): NoXml[] => no?.filhos.filter((f) => f.nome === nome) ?? [];
