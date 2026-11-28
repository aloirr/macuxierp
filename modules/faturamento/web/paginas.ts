/**
 * Páginas do BKO do faturamento, descritas como dados (rota, menu, API, colunas, filtros na URL, CSV e permissão). O shell desenha;
 * a proteção real é da API (RN-CORE-02). O vendedor não vê nada daqui (a API responde 403): `perfilVeFaturamento`.
 */
import { FUSO_PADRAO, pode, type Perfil, type PaginaBase } from '@macuxierp/platform-sdk';
import { definirPaginaLista, filtrosDaUrl, paraCsv, urlDaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import { formatarCentavos, formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import {
  DataCivil, EpecPendente, FiltroEpecPendentes, FiltroNotas, FiltroPedidosAFaturar, FiltroRejeicoes, FiltroTitulos, NotaResumo, PedidoAFaturarResumo, RejeicaoNota, TituloResumo,
} from '../contracts';
import { BASE_API, ROTULO_STATUS_NOTA, ROTULO_STATUS_PEDIDO, numeroSerie, seloDoAmbiente, seloDoPedido, textoDoAmbiente, type Selo } from './notas';
import { ROTULO_PRAZO_EPEC } from './contingencia';
import { hojeCivil, situacaoDoTitulo } from './titulos';

/** Local até o sdk ter `formatarDataCivil` (RD-0590): AAAA-MM-DD vira DD/MM/AAAA. */
const dataCivil = (d: string): string => (DataCivil.safeParse(d).success ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
/** Formata um instante ISO no fuso do tenant (`DD/MM/AAAA HH:mm`); vazio para nulo ou ausente. */
export const hora = (fuso: string) => (iso: string | null | undefined): string => (iso ? formatarDataHora(iso, fuso) : '');
const valor = (c: number | null | undefined): string => (c === null || c === undefined ? '' : formatarCentavos(c));
const ou = (t: string | null | undefined): string => (t && t.trim() !== '' ? t : '—');

/** Tipos de coluna do `TabelaDensa` do packages/ui (o `ColunaLista` do sdk ainda não tem `tipo`): `dinheiro` e `numero` alinham à direita. */
type TipoColuna = 'texto' | 'numero' | 'dinheiro' | 'data' | 'status';
/** `selos`: o que a tela desenha como selo na célula (o CSV usa só o `valor`, em texto curto). */
export type ColunaFaturamento<L> = ColunaLista<L> & { tipo?: TipoColuna; selos?: (linha: L) => readonly Selo[] };
type Fabrica<L> = (fuso: string) => readonly ColunaFaturamento<L>[];

const SEM_SELO: readonly Selo[] = [];
const seloDe = (a: Parameters<typeof seloDoAmbiente>[0]): readonly Selo[] => {
  const s = seloDoAmbiente(a);
  return s ? [s] : SEM_SELO;
};

/** Número/Série: primeira coluna das listas de nota e de rejeição. */
const colunaNumeracao = <L extends { numero: number | null; serie: number }>(): ColunaFaturamento<L> => ({ id: 'numero', titulo: 'Número/Série', tipo: 'numero', valor: (l) => numeroSerie(l) });
const colunaAmbiente = <L extends { ambiente: Parameters<typeof textoDoAmbiente>[0] }>(): ColunaFaturamento<L> => ({
  id: 'ambiente', titulo: 'Ambiente', valor: (l) => textoDoAmbiente(l.ambiente), selos: (l) => seloDe(l.ambiente),
});

const colunasPedidos: Fabrica<PedidoAFaturarResumo> = (fuso) => [
  { id: 'numero', titulo: 'Pedido', tipo: 'numero', valor: (p) => p.numero },
  { id: 'cliente', titulo: 'Cliente', valor: (p) => ou(p.cliente_razao_social) },
  { id: 'total', titulo: 'Total', tipo: 'dinheiro', valor: (p) => valor(p.total_centavos) },
  { id: 'status', titulo: 'Situação', tipo: 'status', valor: (p) => ROTULO_STATUS_PEDIDO[p.status], selos: (p) => [seloDoPedido(p.status)] },
  colunaAmbiente(),
  // O contrato só tem `recebido_em` (a fila grava quando recebe o evento de aprovação); não há `aprovado_em`.
  { id: 'recebido_em', titulo: 'Recebido em', tipo: 'data', valor: (p) => hora(fuso)(p.recebido_em) },
];

const colunasNotas: Fabrica<NotaResumo> = (fuso) => [
  colunaNumeracao(),
  { id: 'pedido', titulo: 'Pedido', tipo: 'numero', valor: (n) => ou(n.pedido_numero == null ? null : String(n.pedido_numero)) },
  { id: 'filial', titulo: 'Filial', valor: (n) => ou(n.filial_nome) },
  { id: 'cliente', titulo: 'Cliente', valor: (n) => ou(n.cliente_razao_social) },
  { id: 'status', titulo: 'Situação', tipo: 'status', valor: (n) => ROTULO_STATUS_NOTA[n.status].texto, selos: (n) => [ROTULO_STATUS_NOTA[n.status]] },
  colunaAmbiente(),
  { id: 'total', titulo: 'Total', tipo: 'dinheiro', valor: (n) => valor(n.total_centavos) },
  { id: 'emitida_em', titulo: 'Emitida em', tipo: 'data', valor: (n) => hora(fuso)(n.emitida_em) },
];

const colunasRejeicoes: Fabrica<RejeicaoNota> = (fuso) => [
  colunaNumeracao(),
  { id: 'acao', titulo: 'O que fazer', valor: (r) => (r.acao_sugerida.trim() === '' ? 'Fale com o fiscal' : r.acao_sugerida) },
  { id: 'codigo', titulo: 'Código da SEFAZ', valor: (r) => r.codigo },
  { id: 'mensagem', titulo: 'Motivo da SEFAZ', valor: (r) => r.mensagem },
  colunaAmbiente(),
  { id: 'rejeitada_em', titulo: 'Rejeitada em', tipo: 'data', valor: (r) => hora(fuso)(r.rejeitada_em) },
];

const colunasTitulos: Fabrica<TituloResumo> = () => {
  const hoje = hojeCivil();
  return [
    { id: 'cliente', titulo: 'Cliente', valor: (t) => ou(t.cliente_razao_social) },
    // O título só traz o número da nota (sem série no contrato): fica o número.
    { id: 'nota', titulo: 'Nota', tipo: 'numero', valor: (t) => String(t.numero) },
    { id: 'parcela', titulo: 'Parcela', tipo: 'numero', valor: (t) => `${t.parcela}/${t.total_parcelas}` },
    { id: 'vencimento', titulo: 'Vencimento', tipo: 'data', valor: (t) => dataCivil(t.vencimento) },
    { id: 'valor', titulo: 'Valor', tipo: 'dinheiro', valor: (t) => valor(t.valor_centavos) },
    { id: 'saldo', titulo: 'Saldo', tipo: 'dinheiro', valor: (t) => valor(t.saldo_centavos) },
    { id: 'status', titulo: 'Status', tipo: 'status', valor: (t) => situacaoDoTitulo(t, hoje).texto, selos: (t) => [situacaoDoTitulo(t, hoje)] },
    colunaAmbiente(),
  ];
};

const colunasEpecPendentes: Fabrica<EpecPendente> = (fuso) => [
  colunaNumeracao(),
  { id: 'status', titulo: 'Situação da nota', tipo: 'status', valor: (n) => ROTULO_STATUS_NOTA[n.status].texto, selos: (n) => [ROTULO_STATUS_NOTA[n.status]] },
  { id: 'epec_protocolo', titulo: 'Protocolo do EPEC', valor: (n) => n.epec_protocolo },
  { id: 'epec_autorizada_em', titulo: 'EPEC autorizado em', tipo: 'data', valor: (n) => hora(fuso)(n.epec_autorizada_em) },
  { id: 'prazo_ate', titulo: 'Enviar até', tipo: 'data', valor: (n) => hora(fuso)(n.prazo_ate) },
  { id: 'situacao_prazo', titulo: 'Prazo', tipo: 'status', valor: (n) => ROTULO_PRAZO_EPEC[n.situacao_prazo].texto, selos: (n) => [ROTULO_PRAZO_EPEC[n.situacao_prazo]] },
  colunaAmbiente(),
];

interface LinhaDa {
  'pedidos-a-faturar': PedidoAFaturarResumo;
  notas: NotaResumo;
  rejeicoes: RejeicaoNota;
  titulos: TituloResumo;
  'epec-pendentes': EpecPendente;
}
export type IdLista = keyof LinhaDa;

const SEM_CURSOR = { cursor: true, limite: true } as const;

export const paginaPedidosAFaturar = definirPaginaLista({
  id: 'pedidos-a-faturar', api: `${BASE_API}/pedidos-a-faturar`, item: PedidoAFaturarResumo,
  filtros: FiltroPedidosAFaturar.omit(SEM_CURSOR).shape, colunas: colunasPedidos(FUSO_PADRAO), csv: { arquivo: 'pedidos-a-faturar.csv' },
  vazio: { semFiltro: 'Nenhum pedido aprovado esperando nota.', comFiltro: 'Nenhum pedido com estes filtros.' },
});

/** Filtros `serie`, `numero` e `pedido_id` permitem a busca por número (e por pedido) na URL. */
export const paginaNotas = definirPaginaLista({
  id: 'notas', api: `${BASE_API}/notas`, item: NotaResumo,
  filtros: FiltroNotas.omit(SEM_CURSOR).shape, colunas: colunasNotas(FUSO_PADRAO), csv: { arquivo: 'notas-fiscais.csv' },
  vazio: { semFiltro: 'Nenhuma nota emitida ainda.', comFiltro: 'Nenhuma nota com estes filtros.' },
});

export const paginaRejeicoes = definirPaginaLista({
  id: 'rejeicoes', api: `${BASE_API}/rejeicoes`, item: RejeicaoNota, filtros: FiltroRejeicoes.omit(SEM_CURSOR).shape, colunas: colunasRejeicoes(FUSO_PADRAO), csv: { arquivo: 'rejeicoes.csv' },
  vazio: { semFiltro: 'Nenhuma nota rejeitada.', comFiltro: 'Nenhuma rejeição com estes filtros.' },
});

export const paginaTitulos = definirPaginaLista({
  id: 'titulos', api: `${BASE_API}/titulos`, item: TituloResumo,
  filtros: FiltroTitulos.omit(SEM_CURSOR).shape, colunas: colunasTitulos(FUSO_PADRAO), csv: { arquivo: 'titulos-a-receber.csv' },
  vazio: { semFiltro: 'Nenhum título ainda.', comFiltro: 'Nenhum título com estes filtros.' },
});

export const paginaEpecPendentes = definirPaginaLista({
  id: 'epec-pendentes', api: `${BASE_API}/contingencia/epec-pendentes`, item: EpecPendente,
  filtros: FiltroEpecPendentes.omit(SEM_CURSOR).shape, colunas: colunasEpecPendentes(FUSO_PADRAO), csv: { arquivo: 'epec-pendentes.csv' },
  vazio: { semFiltro: 'Nenhuma nota EPEC esperando envio.', comFiltro: 'Nenhuma nota EPEC com estes filtros.' },
});

const rotuloNota = (n: { numero: number | null; serie: number }): string => `Abrir nota ${numeroSerie(n) || 'sem número'}`;

/** `rotuloLinha` (aria-label da linha clicável) de cada lista, tipado pela linha da própria lista. */
export const ROTULO_LINHA: { readonly [K in IdLista]: (linha: LinhaDa[K]) => string } = {
  'pedidos-a-faturar': (p) => `Emitir nota do pedido ${p.numero ?? ''}`.trim(),
  notas: rotuloNota,
  rejeicoes: rotuloNota,
  'epec-pendentes': (n) => `Abrir a nota ${numeroSerie(n) || 'sem número'} em contingência`,
  titulos: (t) => `Abrir o título ${t.numero} (parcela ${t.parcela}/${t.total_parcelas})`,
};

const FABRICAS: { readonly [K in IdLista]: Fabrica<LinhaDa[K]> } = { 'pedidos-a-faturar': colunasPedidos, notas: colunasNotas, rejeicoes: colunasRejeicoes, titulos: colunasTitulos, 'epec-pendentes': colunasEpecPendentes };

/** O id vem de fora (rota da tela): o único ponto que perde o tipo da linha. */
const fabricaDe = (id: string): Fabrica<unknown> | undefined => (Object.hasOwn(FABRICAS, id) ? (FABRICAS[id as IdLista] as unknown as Fabrica<unknown>) : undefined);

/** CSV da lista que o usuário está vendo, com as datas no fuso do tenant e proteção contra fórmula (RF-FAT-08). */
export function csvDaPagina(pagina: { id: string }, linhas: readonly unknown[], fuso: string): string {
  return paraCsv(paginaNoFuso(pagina as { id: string; colunas: readonly ColunaLista<never>[] }, fuso).colunas as readonly ColunaLista<unknown>[], linhas);
}

/**
 * A página com as colunas de data e hora no fuso do tenant (a API usa nas rotas `/exportar` de notas, pedidos e rejeições; títulos têm data civil).
 * O `colunas` do descritor fica no `FUSO_PADRAO` do SDK (serve só a `definirPaginaLista`); o shell usa `colunasDaPagina(id, fuso)` e `csvDaPagina(pagina, linhas, fuso)`
 * com `eu.empresa.fuso`. Não dá para usar o 4º argumento do `csvDaLista` (RD-0788): as colunas já formatam a data na fábrica, e o SDK só converte ISO cru.
 */
export function paginaNoFuso<P extends { id: string; colunas: readonly ColunaLista<never>[] }>(pagina: P, fuso: string): P {
  const fabrica = fabricaDe(pagina.id);
  if (!fabrica) throw new Error(`página sem colunas: ${pagina.id}`);
  return { ...pagina, colunas: fabrica(fuso) as unknown as P['colunas'] };
}

/** Colunas da tabela no fuso do tenant (o shell chama com `eu.empresa.fuso`). */
export const colunasDaPagina = (id: string, fuso: string): readonly ColunaFaturamento<unknown>[] => fabricaDe(id)?.(fuso) ?? [];

/** URL da API para a consulta que está na URL da tela: só as chaves da página, na ordem estável. */
export const enderecoDaConsulta = (pagina: { api: string; chaves: readonly string[] }, url: URLSearchParams): string => urlDaLista(pagina.api, filtrosDaUrl(pagina, url));

export interface PaginaFaturamento extends PaginaBase {
  readonly id: string;
  readonly tipo: 'lista' | 'detalhe';
  /** Rota da lista na API (`/v1/faturamento/...`). */
  readonly api?: string;
}

const VER = 'faturamento.ver' as const;

/**
 * EPEC desligada na v0.3.0 (`EPEC_LIGADA`): a página `epec-pendentes` (`paginaEpecPendentes`) fica fora desta lista, logo fora do registro e do menu; volta quando a EPEC ligar:
 * `{ id: 'epec-pendentes', tipo: 'lista', menu: 'Notas fiscais', titulo: 'EPEC pendentes', rota: '/faturamento/epec-pendentes', api: paginaEpecPendentes.api, ver: VER }`.
 * Ordem: o item de menu leva à primeira página visível do menu. `/notas/:id` abre pela lista e fica fora do menu. */
export const PAGINAS_FATURAMENTO: readonly PaginaFaturamento[] = [
  { id: 'pedidos-a-faturar', tipo: 'lista', menu: 'Pedidos a faturar', titulo: 'Pedidos a faturar', rota: '/faturamento/pedidos-a-faturar', api: paginaPedidosAFaturar.api, ver: VER },
  { id: 'notas', tipo: 'lista', menu: 'Notas fiscais', titulo: 'Notas fiscais', rota: '/faturamento/notas', api: paginaNotas.api, ver: VER },
  { id: 'nota', tipo: 'detalhe', menu: 'Notas fiscais', titulo: 'Nota fiscal', rota: '/faturamento/notas/:id', ver: VER, ocultaNoMenu: true },
  { id: 'rejeicoes', tipo: 'lista', menu: 'Rejeições', titulo: 'Rejeições', rota: '/faturamento/rejeicoes', api: paginaRejeicoes.api, ver: VER },
  { id: 'titulos', tipo: 'lista', menu: 'Títulos a receber', titulo: 'Títulos a receber', rota: '/faturamento/titulos', api: paginaTitulos.api, ver: VER },
  /** Detalhe do título (baixa e estorno: `acoesDoTitulo`, `formularioBaixa`, `dialogoEstornar`, `situacaoDoTitulo`): abre pela lista. */
  { id: 'titulo', tipo: 'detalhe', menu: 'Títulos a receber', titulo: 'Título a receber', rota: '/faturamento/titulos/:id', ver: VER, ocultaNoMenu: true },
];

/** `vendedor` não acessa o faturamento na v1 (a API devolve 403): a tela e o menu também o escondem. */
export const perfilVeFaturamento = (perfil: Perfil): boolean => perfil !== 'vendedor' && pode(perfil, VER);
