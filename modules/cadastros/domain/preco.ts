import { violacao, type Violacao } from './violacao';

export const MAX_ITENS_LOTE = 5000;

export interface ItemPreco {
  filial_id: string;
  produto_id: string;
  preco_centavos: number;
  desconto_maximo_bp: number;
}

export interface TabelaVigencia {
  vigencia_inicio: string; // AAAA-MM-DD
  vigencia_fim: string | null;
  inativa: boolean;
}

export type ResultadoPreco =
  | { ok: true; item: ItemPreco; origem_filial_id: string }
  | { ok: false; motivo: 'fora_da_vigencia' | 'sem_preco' };

/** RN-CAD-06: a tabela vale na data (AAAA-MM-DD) se está ativa e a data cai na vigência, com os limites inclusivos. */
export function tabelaVigente(tabela: TabelaVigencia, data: string): boolean {
  return !tabela.inativa && data >= tabela.vigencia_inicio && (tabela.vigencia_fim === null || data <= tabela.vigencia_fim);
}

/** RN-CAD-06: preço vale por filial e por vigência (datas inclusivas); sem item na filial, cai na filial padrão. */
export function precoVigente(p: {
  tabela: TabelaVigencia;
  itens: readonly ItemPreco[];
  produto_id: string;
  filial_id: string;
  filial_padrao_id: string;
  data: string;
}): ResultadoPreco {
  const { tabela, data } = p;
  if (!tabelaVigente(tabela, data)) {
    return { ok: false, motivo: 'fora_da_vigencia' };
  }
  for (const filial of [p.filial_id, p.filial_padrao_id]) {
    const item = p.itens.find((i) => i.filial_id === filial && i.produto_id === p.produto_id);
    if (item) return { ok: true, item, origem_filial_id: filial };
  }
  return { ok: false, motivo: 'sem_preco' };
}

/** RN-CAD-06: lote do `PUT /tabelas-preco/:id/itens` com até 5.000 itens e um preço por filial e produto. */
export function validarLotePreco(itens: readonly Pick<ItemPreco, 'filial_id' | 'produto_id'>[]): Violacao[] {
  if (itens.length > MAX_ITENS_LOTE) return [violacao('RN-CAD-06', 'itens', `Lote com no máximo ${MAX_ITENS_LOTE} itens`)];
  const vistos = new Set<string>();
  const v: Violacao[] = [];
  itens.forEach((i, n) => {
    const chave = `${i.filial_id}|${i.produto_id}`;
    if (vistos.has(chave)) v.push(violacao('RN-CAD-06', `itens.${n}`, 'Produto repetido na mesma filial'));
    vistos.add(chave);
  });
  return v;
}

/** RN-CAD-06: o fim da vigência da tabela não pode ser anterior ao início (datas AAAA-MM-DD). */
export function validarVigenciaTabela(inicio: string, fim: string | null): { ok: true } | { ok: false; violacao: Violacao } {
  return fim !== null && fim < inicio
    ? { ok: false, violacao: violacao('RN-CAD-06', 'vigencia_fim', 'O fim da vigência não pode ser anterior ao início') }
    : { ok: true };
}
