/**
 * Tokens da marca Macuxi (fonte: manual da marca do Macuxi FDV, docs/marca/manual.md §3, aprovado pelo Alexandre em
 * 12/11/2026). O ERP usa a mesma marca; qualquer cor nova passa pelo design-de-marca e só o Alexandre aprova.
 */
export const cores = {
  azulNoite: '#1E3350',
  perola: '#F8F6F1',
  branco: '#FFFFFF',
  solLaranja: '#C2540A',
  solClaro: '#F59A52',
  grafite: '#16202A',
  grafiteMenu: '#2B3743',
  textoSecundario: '#4A5562',
  textoApoio: '#5B6673',
  azulClaro: '#9AA3B0',
} as const;

export type Cor = keyof typeof cores;
