/** Rótulos da lista genérica (parte pura). Filtros e links vêm do SDK e de `lib/listas-url.ts`. */

/** Troca o valor da célula pelo rótulo da opção quando a coluna tem o mesmo id de um filtro de cadastro (filial, vendedor): o UUID não aparece na tela. */
export function rotuloDaCelula(texto: string, opcoes: ReadonlyMap<string, string> | undefined): string {
  return opcoes?.get(texto) ?? texto;
}

/** Rótulos de filtro de gênero feminino (o shell escolhe "Todas" × "Todos" pelo primeiro termo do rótulo; os demais ficam "Todos"). */
const FILTROS_FEMININOS = new Set(['filial', 'origem', 'condição', 'condicao', 'série', 'serie', 'situação', 'situacao', 'rejeição', 'rejeicao', 'natureza', 'empresa', 'carteira']);
export function textoTodos(rotulo: string): 'Todas' | 'Todos' {
  const primeiro = rotulo.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return FILTROS_FEMININOS.has(primeiro) ? 'Todas' : 'Todos';
}
