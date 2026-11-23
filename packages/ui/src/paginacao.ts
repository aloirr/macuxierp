/** Soma a página às linhas atuais sem duplicar pela chave; mantém a ordem e, em chave repetida, a versão nova substitui a antiga na mesma posição. Não muta as entradas. */
export function acumularPagina<T>(atuais: T[], pagina: T[], chave: (l: T) => string): T[] {
  const resultado = [...atuais];
  const posicao = new Map<string, number>();
  resultado.forEach((l, i) => posicao.set(chave(l), i));
  for (const l of pagina) {
    const k = chave(l);
    const i = posicao.get(k);
    if (i === undefined) {
      posicao.set(k, resultado.length);
      resultado.push(l);
    } else {
      resultado[i] = l;
    }
  }
  return resultado;
}
