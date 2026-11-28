/** RN-CAD-10: descrição das tabelas oficiais sem tag HTML (a carga do NCM traz `<i>…</i>` cru); só na saída, o dado fica como veio. */
const ENTIDADES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function limparDescricaoOficial<T extends string | null | undefined>(texto: T): T {
  if (typeof texto !== 'string' || texto === '') return texto;
  const semTag = texto.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');
  const semEntidade = semTag.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (e) => ENTIDADES[e] ?? e);
  return semEntidade.replace(/\s+/g, ' ').trim() as T;
}
