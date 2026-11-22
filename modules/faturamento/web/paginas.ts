/**
 * Páginas do BKO do faturamento, descritas como dados (rota, menu, API, colunas, filtros na URL, CSV e permissão). O shell desenha;
 * a proteção real é da API (RN-CORE-02). O vendedor não vê nada daqui (a API responde 403): `perfilVeFaturamento`.
 */
import { pode, type Perfil, type PaginaBase } from '@macuxierp/platform-sdk';
import { definirPaginaLista, filtrosDaUrl, paraCsv, urlDaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import { formatarCentavos, formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import {
  DataCivil, FiltroNotas, FiltroPedidosAFaturar, FiltroRejeicoes, FiltroTitulos, NotaResumo, PedidoAFaturarResumo, RejeicaoNota, TituloResumo,
} from '../contracts';
import { BASE_API, ROTULO_STATUS_NOTA, ROTULO_STATUS_PEDIDO, numeroSerie, textoDoAmbiente } from './notas';
import { hojeCivil, situacaoDoTitulo } from './titulos';

/** Local até o sdk ter formatarDataCivil/FUSO_PADRAO (RD-0590). Reserva: o shell sempre passa o fuso do tenant (`eu.empresa.fuso`). */
export const FUSO_PADRAO = 'America/Manaus';

/** Local até o sdk ter formatarDataCivil/FUSO_PADRAO (RD-0590). */
const dataCivil = (d: string): string => (DataCivil.safeParse(d).success ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
const hora = (fuso: string) => (iso: string | null | undefined): string => (iso ? formatarDataHora(iso, fuso) : '');
const valor = (c: number | null | undefined): string => (c === null || c === undefined ? '' : formatarCentavos(c));
const ou = (t: string | null | undefined): string => (t && t.trim() !== '' ? t : '—');

/** Tipos de coluna do `TabelaDensa` do packages/ui: `dinheiro` e `numero` alinham à direita. */
export type TipoColuna = 'texto' | 'numero' | 'dinheiro' | 'data' | 'status';
export type ColunaFaturamento<L> = ColunaLista<L> & { tipo?: TipoColuna };
type Fabrica<L> = (fuso: string) => readonly ColunaFaturamento<L>[];

const colunasPedidos: Fabrica<PedidoAFaturarResumo> = (fuso) => [
  { id: 'numero', titulo: 'Pedido', valor: (p) => p.numero },
  { id: 'cliente', titulo: 'Cliente', valor: (p) => ou(p.cliente_razao_social) },
  { id: 'total', titulo: 'Total', tipo: 'dinheiro', valor: (p) => valor(p.total_centavos) },
  { id: 'status', titulo: 'Status', tipo: 'status', valor: (p) => ROTULO_STATUS_PEDIDO[p.status] },
  { id: 'recebido_em', titulo: 'Aprovado em', tipo: 'data', valor: (p) => hora(fuso)(p.recebido_em) },
];

const colunasNotas: Fabrica<NotaResumo> = (fuso) => [
  { id: 'numero', titulo: 'Número/Série', valor: (n) => numeroSerie(n) },
  { id: 'filial', titulo: 'Filial', valor: (n) => ou(n.filial_nome) },
  { id: 'pedido', titulo: 'Pedido', valor: (n) => (n.pedido_numero === null || n.pedido_numero === undefined ? '—' : n.pedido_numero) },
  { id: 'cliente', titulo: 'Cliente', valor: (n) => ou(n.cliente_razao_social) },
  { id: 'status', titulo: 'Status', tipo: 'status', valor: (n) => ROTULO_STATUS_NOTA[n.status].texto },
  { id: 'ambiente', titulo: 'Ambiente', valor: (n) => textoDoAmbiente(n.ambiente) },
  { id: 'total', titulo: 'Total', tipo: 'dinheiro', valor: (n) => valor(n.total_centavos) },
  { id: 'emitida_em', titulo: 'Emitida em', tipo: 'data', valor: (n) => hora(fuso)(n.emitida_em) },
];

const colunasRejeicoes: Fabrica<RejeicaoNota> = (fuso) => [
  { id: 'numero', titulo: 'Número/Série', valor: (r) => numeroSerie(r) },
  { id: 'filial', titulo: 'Filial', valor: (r) => ou(r.filial_nome) },
  { id: 'pedido', titulo: 'Pedido', valor: (r) => (r.pedido_numero === null || r.pedido_numero === undefined ? '—' : r.pedido_numero) },
  { id: 'codigo', titulo: 'Código', valor: (r) => r.codigo },
  { id: 'mensagem', titulo: 'Motivo da SEFAZ', valor: (r) => r.mensagem },
  { id: 'acao', titulo: 'O que fazer', valor: (r) => r.acao_sugerida },
  { id: 'rejeitada_em', titulo: 'Rejeitada em', tipo: 'data', valor: (r) => hora(fuso)(r.rejeitada_em) },
];

const colunasTitulos: Fabrica<TituloResumo> = (fuso) => {
  const hoje = hojeCivil(fuso);
  return [
    { id: 'cliente', titulo: 'Cliente', valor: (t) => ou(t.cliente_razao_social) },
    { id: 'nota', titulo: 'Nota', valor: (t) => numeroSerie(t) },
    { id: 'parcela', titulo: 'Parcela', valor: (t) => `${t.parcela}/${t.total_parcelas}` },
    { id: 'vencimento', titulo: 'Vencimento', tipo: 'data', valor: (t) => dataCivil(t.vencimento) },
    { id: 'valor', titulo: 'Valor', tipo: 'dinheiro', valor: (t) => valor(t.valor_centavos) },
    { id: 'saldo', titulo: 'Saldo', tipo: 'dinheiro', valor: (t) => valor(t.saldo_centavos) },
    { id: 'status', titulo: 'Status', tipo: 'status', valor: (t) => situacaoDoTitulo(t, hoje).texto },
  ];
};

const SEM_CURSOR = { cursor: true, limite: true } as const;

export const paginaPedidosAFaturar = definirPaginaLista({
  id: 'pedidos-a-faturar', api: `${BASE_API}/pedidos-a-faturar`, item: PedidoAFaturarResumo,
  filtros: FiltroPedidosAFaturar.omit(SEM_CURSOR).shape, colunas: colunasPedidos(FUSO_PADRAO), csv: { arquivo: 'pedidos-a-faturar.csv' },
});

/** Filtros `serie`, `numero` e `pedido_id` permitem a busca por número (e por pedido) na URL. */
export const paginaNotas = definirPaginaLista({
  id: 'notas', api: `${BASE_API}/notas`, item: NotaResumo,
  filtros: FiltroNotas.omit(SEM_CURSOR).shape, colunas: colunasNotas(FUSO_PADRAO), csv: { arquivo: 'notas-fiscais.csv' },
});

export const paginaRejeicoes = definirPaginaLista({
  id: 'rejeicoes', api: `${BASE_API}/rejeicoes`, item: RejeicaoNota, filtros: FiltroRejeicoes.omit(SEM_CURSOR).shape, colunas: colunasRejeicoes(FUSO_PADRAO), csv: { arquivo: 'rejeicoes.csv' },
});

/** Rota do lote 5 (ainda não existe na API): ver `titulos.ts`. */
export const paginaTitulos = definirPaginaLista({
  id: 'titulos', api: `${BASE_API}/titulos`, item: TituloResumo,
  filtros: FiltroTitulos.omit(SEM_CURSOR).shape, colunas: colunasTitulos(FUSO_PADRAO), csv: { arquivo: 'titulos-a-receber.csv' },
});

/** `textoVazio` da `TabelaDensa` de cada lista: o problema e a ação. */
export const TEXTO_VAZIO: Readonly<Record<string, string>> = {
  'pedidos-a-faturar': 'Nenhum pedido a faturar. Pedidos aprovados aparecem aqui.',
  rejeicoes: 'Nenhuma rejeição. As notas estão passando.',
  notas: 'Nenhuma nota neste filtro. Limpe os filtros.',
  titulos: 'Títulos a receber ainda não estão disponíveis.',
};

/** `rotuloLinha` (aria-label da linha clicável) de cada lista. */
export const ROTULO_LINHA: Readonly<Record<string, (linha: never) => string>> = {
  'pedidos-a-faturar': ((p: PedidoAFaturarResumo) => `Emitir nota do pedido ${p.numero ?? ''}`.trim()) as (l: never) => string,
  notas: ((n: NotaResumo) => `Abrir nota ${numeroSerie(n) || 'sem número'}`) as (l: never) => string,
  rejeicoes: ((r: RejeicaoNota) => `Abrir nota ${numeroSerie(r) || 'sem número'}`) as (l: never) => string,
  titulos: ((t: TituloResumo) => `Abrir nota ${numeroSerie(t)}`) as (l: never) => string,
};

const FABRICAS: Readonly<Record<string, Fabrica<never>>> = {
  'pedidos-a-faturar': colunasPedidos as Fabrica<never>, notas: colunasNotas as Fabrica<never>, rejeicoes: colunasRejeicoes as Fabrica<never>, titulos: colunasTitulos as Fabrica<never>,
};

/** CSV da lista que o usuário está vendo, com as datas no fuso do tenant e proteção contra fórmula (RF-FAT-08). */
export function csvDaPagina(pagina: { id: string }, linhas: readonly unknown[], fuso: string): string {
  const fabrica = FABRICAS[pagina.id];
  if (!fabrica) throw new Error(`página sem colunas: ${pagina.id}`);
  return paraCsv(fabrica(fuso) as readonly ColunaLista<unknown>[], linhas);
}

/** Colunas da tabela no fuso do tenant (o shell chama com `eu.empresa.fuso`). */
export const colunasDaPagina = (id: string, fuso: string): readonly ColunaFaturamento<unknown>[] => (FABRICAS[id]?.(fuso) ?? []) as readonly ColunaFaturamento<unknown>[];

/** URL da API para a consulta que está na URL da tela: só as chaves da página, na ordem estável. */
export const enderecoDaConsulta = (pagina: { api: string; chaves: readonly string[] }, url: URLSearchParams): string => urlDaLista(pagina.api, filtrosDaUrl(pagina, url));

export interface PaginaFaturamento extends PaginaBase {
  readonly id: string;
  readonly tipo: 'lista' | 'detalhe';
  /** Rota da lista na API (`/v1/faturamento/...`). */
  readonly api?: string;
}

const VER = 'faturamento.ver' as const;

/** Ordem: o item de menu leva à primeira página visível do menu. `/notas/:id` abre pela lista e fica fora do menu. */
export const PAGINAS_FATURAMENTO: readonly PaginaFaturamento[] = [
  { id: 'pedidos-a-faturar', tipo: 'lista', menu: 'Pedidos a faturar', titulo: 'Pedidos a faturar', rota: '/faturamento/pedidos-a-faturar', api: paginaPedidosAFaturar.api, ver: VER },
  { id: 'notas', tipo: 'lista', menu: 'Notas fiscais', titulo: 'Notas fiscais', rota: '/faturamento/notas', api: paginaNotas.api, ver: VER },
  { id: 'nota', tipo: 'detalhe', menu: 'Notas fiscais', titulo: 'Nota fiscal', rota: '/faturamento/notas/:id', ver: VER, ocultaNoMenu: true },
  { id: 'rejeicoes', tipo: 'lista', menu: 'Notas fiscais', titulo: 'Rejeições', rota: '/faturamento/rejeicoes', api: paginaRejeicoes.api, ver: VER },
  { id: 'titulos', tipo: 'lista', menu: 'Títulos a receber', titulo: 'Títulos a receber', rota: '/faturamento/titulos', api: paginaTitulos.api, ver: VER, aviso: 'Títulos a receber chegam no lote 5 da T-0021 (T-0040). Até lá a lista fica vazia.' },
];

/** `vendedor` não acessa o faturamento na v1 (a API devolve 403): a tela e o menu também o escondem. */
export const perfilVeFaturamento = (perfil: Perfil): boolean => perfil !== 'vendedor' && pode(perfil, VER);
