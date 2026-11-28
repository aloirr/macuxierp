/**
 * Páginas do BKO do fiscal (T-0127), como dados: rota, menu, API, colunas, filtros na URL, CSV e permissão. O shell desenha; a proteção real é da
 * API (RN-CORE-02). Sem React nem Node: serve ao `web` e à `api` (a rota `GET /v1/fiscal/regras/exportar` usa o mesmo descritor).
 */
import type { PaginaBase } from '@macuxierp/platform-sdk/paginas';
import { definirPaginaLista, type ColunaLista } from '@macuxierp/platform-sdk/listas';
import { formatarDataCivil } from '@macuxierp/platform-sdk/formatar';
import { z } from 'zod';
import { CatalogoLinha, RegraLinha, SituacaoRegra, TributoRegra } from '../contracts';
import { Uf } from '@macuxierp/cadastros/contracts';

export const ROTULO_TRIBUTO: Readonly<Record<TributoRegra, string>> = { icms: 'ICMS', ipi: 'IPI', pis: 'PIS', cofins: 'COFINS', ibs_cbs: 'IBS/CBS', is: 'IS' };
export const ROTULO_SITUACAO: Readonly<Record<SituacaoRegra, string>> = { vigente: 'Vigente', futura: 'Futura', encerrada: 'Encerrada' };
export const TOM_SITUACAO: Readonly<Record<SituacaoRegra, 'ok' | 'aviso' | 'neutro'>> = { vigente: 'ok', futura: 'aviso', encerrada: 'neutro' };
export const ROTULO_CRT: Readonly<Record<number, string>> = { 1: '1 Simples', 2: '2 Sublimite', 3: '3 Normal', 4: '4 MEI' };
const ROTULO_CLIENTE: Readonly<Record<string, string>> = { contribuinte: 'Contribuinte', isento: 'Isento', nao_contribuinte: 'Não contribuinte' };

/** Percentual de 4 casas (180000 = 18%): sem zeros à direita. */
export function textoPercentual(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  const inteiro = Math.trunc(n / 10_000);
  const frac = String(n % 10_000).padStart(4, '0').replace(/0+$/, '');
  return `${inteiro}${frac ? `,${frac}` : ''}%`;
}

const ou = (t: string | null | undefined): string => (t && t.trim() !== '' ? t : 'Todos');
const vazio = (t: string | null | undefined): string => t ?? '';

/** Tipo da coluna para o shell (o `ColunaLista` do sdk ainda não tem `tipo`). */
export type ColunaFiscal<L> = ColunaLista<L> & { tipo?: 'texto' | 'numero' | 'dinheiro' | 'data' | 'status'; selos?: (l: L) => readonly { texto: string; tom: 'ok' | 'aviso' | 'erro' | 'neutro' }[] };

const colunasRegras: readonly ColunaFiscal<RegraLinha>[] = [
  { id: 'tributo', titulo: 'Tributo', valor: (r) => ROTULO_TRIBUTO[r.tributo] },
  { id: 'ncm_prefixo', titulo: 'NCM', valor: (r) => ou(r.ncm_prefixo) },
  { id: 'cfop', titulo: 'CFOP', valor: (r) => ou(r.cfop) },
  { id: 'uf_origem', titulo: 'UF origem', valor: (r) => ou(r.uf_origem) },
  { id: 'uf_destino', titulo: 'UF destino', valor: (r) => ou(r.uf_destino) },
  { id: 'tipo_cliente', titulo: 'Cliente', valor: (r) => (r.tipo_cliente ? (ROTULO_CLIENTE[r.tipo_cliente] ?? r.tipo_cliente) : 'Todos') },
  { id: 'crt', titulo: 'CRT', tipo: 'numero', valor: (r) => (r.crt === null ? 'Todos' : String(r.crt)) },
  { id: 'codigo', titulo: 'CST/CSOSN', tipo: 'numero', valor: (r) => vazio(r.codigo) },
  { id: 'aliquota_icms', titulo: 'ICMS', tipo: 'numero', valor: (r) => textoPercentual(r.aliquota_icms) },
  { id: 'mva_original', titulo: 'MVA', tipo: 'numero', valor: (r) => textoPercentual(r.mva_original) },
  { id: 'fonte', titulo: 'Fonte', valor: (r) => (r.fonte ? `${r.fonte.tipo} ${r.fonte.referencia}` : '') },
  { id: 'versao', titulo: 'Versão', valor: (r) => r.versao },
  { id: 'vigencia_inicio', titulo: 'Início', tipo: 'data', valor: (r) => formatarDataCivil(r.vigencia_inicio) },
  { id: 'vigencia_fim', titulo: 'Fim', tipo: 'data', valor: (r) => (r.vigencia_fim ? formatarDataCivil(r.vigencia_fim) : '') },
  { id: 'situacao', titulo: 'Situação', tipo: 'status', valor: (r) => ROTULO_SITUACAO[r.situacao], selos: (r) => [{ texto: ROTULO_SITUACAO[r.situacao], tom: TOM_SITUACAO[r.situacao] }] },
];

const SIM_CRT = z.enum(['1', '2', '3', '4']);

export const paginaRegras = definirPaginaLista({
  id: 'regras-fiscais',
  api: '/v1/fiscal/regras',
  item: RegraLinha,
  busca: true,
  filtros: {
    tributo: TributoRegra.optional(),
    uf_origem: Uf.optional(),
    uf_destino: Uf.optional(),
    crt: SIM_CRT.optional(),
    situacao: SituacaoRegra.optional(),
  },
  colunas: colunasRegras,
  csv: { arquivo: 'regras-fiscais.csv' },
  vazio: { semFiltro: 'Nenhuma regra cadastrada. Aplique o catálogo base ou cadastre a primeira regra.', comFiltro: 'Nenhuma regra com esses filtros.' },
});
export type ItemListaRegra = RegraLinha;

const colunasCatalogo: readonly ColunaFiscal<CatalogoLinha>[] = [
  { id: 'chave', titulo: 'Chave', valor: (c) => c.chave },
  { id: 'descricao', titulo: 'Descrição', valor: (c) => c.descricao },
  { id: 'tributo', titulo: 'Tributo', valor: (c) => ROTULO_TRIBUTO[c.tributo] },
  { id: 'ncm_prefixo', titulo: 'NCM', valor: (c) => ou(c.ncm_prefixo) },
  { id: 'uf_destino', titulo: 'UF destino', valor: (c) => ou(c.uf_destino) },
  { id: 'crt', titulo: 'CRT', tipo: 'numero', valor: (c) => (c.crt === null ? 'Todos' : String(c.crt)) },
  { id: 'codigo', titulo: 'CST/CSOSN', tipo: 'numero', valor: (c) => vazio(c.codigo) },
  { id: 'fonte', titulo: 'Fonte', valor: (c) => (c.fonte ? `${c.fonte.tipo} ${c.fonte.referencia}` : '') },
  { id: 'versao', titulo: 'Versão', valor: (c) => c.versao },
  {
    id: 'aplicavel', titulo: 'Situação', tipo: 'status', valor: (c) => (c.aplicavel ? 'Pronta para aplicar' : (c.motivo_nao_aplicavel ?? 'Não aplicável')),
    selos: (c) => [c.aplicavel ? { texto: 'Pronta', tom: 'ok' as const } : { texto: 'Bloqueada', tom: 'erro' as const }],
  },
];

export const paginaCatalogo = definirPaginaLista({
  id: 'catalogo-fiscal',
  api: '/v1/fiscal/catalogo',
  item: CatalogoLinha,
  busca: true,
  filtros: { tributo: TributoRegra.optional() },
  colunas: colunasCatalogo,
  csv: { arquivo: 'catalogo-fiscal.csv' },
  vazio: { semFiltro: 'O catálogo base ainda não tem modelos validados.', comFiltro: 'Nenhum modelo com esses filtros.' },
});

export type TipoPaginaFiscal = 'lista' | 'catalogo' | 'nova' | 'detalhe';
export interface PaginaFiscal extends PaginaBase {
  readonly id: string;
  readonly tipo: TipoPaginaFiscal;
}

export const ROTA_REGRAS = '/fiscal/regras-fiscais';
/** Fixas antes de `/:id`: a rota exata vence o parâmetro. */
export const PAGINAS_FISCAL: readonly PaginaFiscal[] = [
  { id: 'regras-fiscais', tipo: 'lista', menu: 'Regras fiscais', titulo: 'Regras fiscais', rota: ROTA_REGRAS, ver: 'fiscal.ver' },
  { id: 'catalogo-fiscal', tipo: 'catalogo', menu: 'Regras fiscais', titulo: 'Catálogo base', rota: `${ROTA_REGRAS}/catalogo`, ver: 'fiscal.ver' },
  { id: 'nova', tipo: 'nova', menu: 'Regras fiscais', titulo: 'Nova regra', rota: `${ROTA_REGRAS}/nova`, ver: 'fiscal.regra.editar', ocultaNoMenu: true },
  { id: 'detalhe', tipo: 'detalhe', menu: 'Regras fiscais', titulo: 'Regra fiscal', rota: `${ROTA_REGRAS}/:id`, ver: 'fiscal.ver', ocultaNoMenu: true },
];
