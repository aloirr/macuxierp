/** Filtros na URL: a tela lê e escreve a query string, então recarregar ou compartilhar mantém o filtro. */

/** Só as chaves permitidas da página, sem vazio e sem repetição (a primeira vence). */
export function lerFiltros(busca: string | URLSearchParams, permitidos: readonly string[]): Record<string, string> {
  const p = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const saida: Record<string, string> = {};
  for (const k of permitidos) {
    const v = p.get(k)?.trim();
    if (v) saida[k] = v;
  }
  return saida;
}

/** Query string estável (chaves em ordem), pronta para a rota e para a API. */
export function paraQuery(filtros: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(filtros).sort()) {
    const v = filtros[k];
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
