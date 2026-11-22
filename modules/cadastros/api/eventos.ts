/**
 * Montagem dos payloads dos eventos `cadastros.*` (validados contra `EVENTOS`). Usada pelas rotas (que publicam pelo
 * `ContextoRota`) e pela carga inicial (que grava na outbox pelo worker): o mesmo evento nos dois caminhos.
 */
import type { ContextoRota } from '@macuxierp/platform-sdk';
import {
  EVENTOS, type Cliente, type Filial, type PrecoItemComChave, type Produto, type TabelaPreco, type NomeEventoCadastros,
} from '../contracts';
import type { Repositorios } from './portas';
import { comNomeMunicipio } from './enderecos';
import { agregadoPreco } from './uuid';

type Dict = Record<string, unknown>;
export interface EventoPronto {
  nome: NomeEventoCadastros;
  agregado_id: string;
  payload: Dict;
}

const pronto = (nome: NomeEventoCadastros, agregado_id: string, payload: unknown): EventoPronto => ({
  nome, agregado_id, payload: EVENTOS[nome].parse(payload) as Dict,
});

/** C-1: nome do município pelo código IBGE (`null` se o código não está na tabela oficial). */
async function nomes(r: Repositorios, codigos: readonly string[]): Promise<(ibge: string) => string | null> {
  const mapa = await r.oficiais.nomesMunicipios([...new Set(codigos)]);
  return (ibge) => mapa.get(ibge) ?? null;
}

export async function eventoFilial(r: Repositorios, f: Filial): Promise<EventoPronto> {
  const nome = await nomes(r, [f.endereco.municipio_ibge]);
  return pronto('cadastros.filial.alterada@1', f.id, { ...f, endereco: { ...f.endereco, municipio_nome: nome(f.endereco.municipio_ibge) }, inativo: f.inativo });
}

/** C-1 e C-3: cada endereço sai com `id` e `municipio_nome`. */
export async function eventoCliente(r: Repositorios, c: Cliente): Promise<EventoPronto> {
  const enderecos = await comNomeMunicipio(r, (c.enderecos ?? []) as readonly { municipio_ibge: string }[]);
  return pronto('cadastros.cliente.alterado@1', c.id, { ...c, enderecos, inativo: c.inativo });
}

export const eventoProduto = async (r: Repositorios, p: Produto): Promise<EventoPronto> =>
  pronto('cadastros.produto.alterado@1', p.id, { ...p, unidades: await r.produtos.unidades.listar(p.id), inativo: p.inativo });

/** C-2 */
export const eventoTabelaPreco = (t: TabelaPreco): EventoPronto => pronto('cadastros.tabela_preco.alterada@1', t.id, { ...t, inativo: t.inativo });

export const eventoPreco = (i: PrecoItemComChave, t: TabelaPreco): EventoPronto =>
  pronto('cadastros.preco.alterado@1', agregadoPreco(i.tabela_preco_id, i.filial_id, i.produto_id), {
    ...i, vigencia_inicio: t.vigencia_inicio, vigencia_fim: t.vigencia_fim, inativo: t.inativo,
  });

/** Evento "simples": o próprio cadastro mais `inativo`. */
export const eventoSimples = (nome: NomeEventoCadastros, e: { id: string; inativo: boolean }): EventoPronto => pronto(nome, e.id, { ...e, inativo: e.inativo });

export const eventoEstoque = (agregado_id: string, s: { filial_id: string; produto_id: string; quantidade: number }): EventoPronto =>
  pronto('cadastros.estoque.alterado@1', agregado_id, s);

/** Grava o evento pronto na outbox da transação (rotas e carga de CSV usam o mesmo caminho). */
export async function publicarPronto(c: ContextoRota, e: EventoPronto): Promise<void> {
  await c.publicar({ nome: e.nome, agregado_id: e.agregado_id, versao: 1, // @deprecated no SDK, ignorada (T-0034), mas ainda exigida pelo tipo
    payload: e.payload });
}

/** ADR 0010, item 3: mudou o external_id (inclusive a adoção, nulo → valor): o evento leva o valor de antes. */
export function comExternalIdAnterior(ev: EventoPronto, e: unknown, antes: unknown): EventoPronto {
  if (!antes) return ev;
  const anterior = ((antes as Dict).external_id as string | null | undefined) ?? null;
  if (anterior === (((e as Dict).external_id as string | null | undefined) ?? null)) return ev;
  return { ...ev, payload: EVENTOS[ev.nome].parse({ ...ev.payload, external_id_anterior: anterior }) as Dict };
}

/** O evento de preço é por item: mudou a vigência ou inativou a tabela, os itens vão de novo à outbox. */
export async function republicarItensDaTabela(c: ContextoRota, r: Repositorios, t: TabelaPreco): Promise<void> {
  let cursor: string | undefined;
  do {
    const pagina = await r.tabelasPreco.itens(t.id, { limite: 1000, cursor });
    for (const i of pagina.itens) await publicarPronto(c, eventoPreco(i, t));
    cursor = pagina.proximo_cursor ?? undefined;
  } while (cursor);
}
