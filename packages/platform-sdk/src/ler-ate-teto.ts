/**
 * RD-2346: leitura em páginas por cursor até um teto, para os exports (CSV) que não podem trazer tudo de uma vez. Fonte única do laço
 * que antes ficava no módulo (`lerRecebidosParaExportar` do integracao-fdv).
 * - `ler` devolve até `limite + 1` linhas a partir do `cursor` (a linha a mais só avisa que há próxima página);
 * - passou do teto: devolve só o teto, na ordem da fonte, com `cortado = true` (quem chama avisa no arquivo).
 */
export interface LeituraAteOTeto<L, T> {
  ler(p: { cursor: string | undefined; limite: number }): Promise<readonly L[]>;
  /** O cursor da próxima página a partir da última linha lida. */
  cursorDe(linha: L): string;
  mapear(linha: L): T;
  teto: number;
  pagina: number;
}

export async function lerAteOTeto<L, T>(d: LeituraAteOTeto<L, T>): Promise<{ itens: T[]; cortado: boolean }> {
  const itens: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const linhas = await d.ler({ cursor, limite: d.pagina });
    const daPagina = linhas.slice(0, d.pagina);
    for (const l of daPagina) {
      if (itens.length >= d.teto) return { itens, cortado: true };
      itens.push(d.mapear(l));
    }
    if (linhas.length <= d.pagina) return { itens, cortado: false };
    if (itens.length >= d.teto) return { itens, cortado: true };
    cursor = d.cursorDe(daPagina.at(-1)!);
  }
}
