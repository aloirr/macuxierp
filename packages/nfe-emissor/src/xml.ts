/**
 * Árvore XML mínima e serialização JÁ na forma canônica (C14N 1.0, REC-xml-c14n-20010315, sem comentários).
 *
 * Como o emissor gera o documento inteiro, ele pode escrever direto na forma canônica: sem declaração XML,
 * sem tag vazia abreviada, sem espaço entre elementos, atributos em ordem (namespace antes, depois o nome) e o
 * escape do C14N. Assim o digest da assinatura é calculado sobre os mesmos bytes que vão para a SEFAZ, sem
 * reserializar (a conferência é o verificador XMLDSig do nfe-sefaz).
 */

export interface Elemento {
  nome: string;
  /** Atributos sem prefixo. `xmlns` (namespace padrão) é tratado à parte, sempre primeiro. */
  atributos?: Readonly<Record<string, string>>;
  xmlns?: string;
  filhos?: ReadonlyArray<No>;
}

export type No = Elemento | { texto: string };

/** Caracteres que não existem em XML 1.0 (controle C0 fora TAB/LF/CR). O leiaute da NF-e também não aceita TAB/LF/CR. */
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

export function textoValidoXml(texto: string): boolean {
  return !CONTROLE.test(texto);
}

/** Escape de texto no C14N: &, <, > (e CR, que o leiaute já recusa). */
function escaparTexto(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Escape de atributo no C14N: &, <, " e os brancos TAB/LF/CR. */
function escaparAtributo(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

/** Elemento com texto (`<nome>texto</nome>`). */
export function el(nome: string, texto: string): Elemento {
  if (!textoValidoXml(texto)) throw new RangeError(`texto com caractere de controle em <${nome}>`);
  return { nome, filhos: [{ texto }] };
}

/** Grupo (`<nome>…</nome>`), ignorando filhos ausentes (undefined/null/false). */
export function grupo(nome: string, filhos: ReadonlyArray<No | undefined | null | false>, atributos?: Record<string, string>): Elemento {
  return { nome, ...(atributos ? { atributos } : {}), filhos: filhos.filter((f): f is No => Boolean(f)) };
}

/** Elemento opcional: só sai quando há valor. */
export function opt(nome: string, texto: string | undefined | null): Elemento | undefined {
  return texto === undefined || texto === null || texto === '' ? undefined : el(nome, texto);
}

/**
 * Serializa na forma canônica. `xmlnsHerdado` é o namespace padrão em vigor no pai: o C14N só escreve a
 * declaração quando ela muda (no recorte de um subdocumento, o chamador passa '' para forçar a declaração).
 */
export function serializar(no: No, xmlnsHerdado = ''): string {
  if ('texto' in no) return escaparTexto(no.texto);
  let abre = `<${no.nome}`;
  let ns = xmlnsHerdado;
  if (no.xmlns !== undefined && no.xmlns !== xmlnsHerdado) {
    abre += ` xmlns="${escaparAtributo(no.xmlns)}"`;
    ns = no.xmlns;
  }
  const attrs = Object.entries(no.atributos ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [nome, valor] of attrs) abre += ` ${nome}="${escaparAtributo(valor)}"`;
  const corpo = (no.filhos ?? []).map((f) => serializar(f, ns)).join('');
  return `${abre}>${corpo}</${no.nome}>`;
}
