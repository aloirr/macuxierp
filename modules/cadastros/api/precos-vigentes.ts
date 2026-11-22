/** Preço vigente em lote (RN-CAD-06), comum à rota `GET /precos/vigente` e à consulta do pedido. */
import type { PrecoVigente } from '../contracts';
import { precoVigente } from '../domain';
import type { Repositorios } from './portas';

export type PrecoDoProduto =
  | { produto_id: string; ok: true; preco: PrecoVigente }
  | { produto_id: string; ok: false; motivo: 'fora_da_vigencia' | 'sem_preco' };

export const unicos = (ids: readonly string[]) => [...new Set(ids)];

/** Um resultado por produto (sem repetição). `null` quando a tabela não existe. Preço da filial; sem item nela, o da filial padrão. */
export async function precosVigentesDe(
  r: Repositorios,
  c: { tabela_preco_id: string; filial_id: string; produto_ids: readonly string[]; data: string },
): Promise<PrecoDoProduto[] | null> {
  const tabela = await r.tabelasPreco.obter(c.tabela_preco_id);
  if (!tabela) return null;
  const produto_ids = unicos(c.produto_ids);
  if (produto_ids.length === 0) return [];
  const padrao = (await r.filiais.padrao())?.id ?? c.filial_id;
  const itens = await r.tabelasPreco.itensDosProdutos(tabela.id, produto_ids, unicos([c.filial_id, padrao]));
  return produto_ids.map((produto_id): PrecoDoProduto => {
    const res = precoVigente({
      tabela: { vigencia_inicio: tabela.vigencia_inicio, vigencia_fim: tabela.vigencia_fim, inativa: tabela.inativo },
      itens, produto_id, filial_id: c.filial_id, filial_padrao_id: padrao, data: c.data,
    });
    if (!res.ok) return { produto_id, ok: false, motivo: res.motivo };
    return { produto_id, ok: true, preco: { ...res.item, tabela_preco_id: tabela.id, origem_filial_id: res.origem_filial_id, vigencia_inicio: tabela.vigencia_inicio, vigencia_fim: tabela.vigencia_fim } };
  });
}
