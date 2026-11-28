/**
 * Tabelas oficiais no BKO (T-0123, v0.3.32): NCM, CEST, CFOP e municípios do IBGE, só leitura (RF-CAD-10). A busca, o filtro de vigência e a
 * paginação por cursor são do servidor (`/v1/cadastros/oficiais/:tabela`); a API devolve o que está vigente na data (padrão: hoje).
 * Quatro seções do mesmo item de menu. Nenhuma regra de negócio aqui.
 */
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { formatarDataCivil } from '@macuxierp/platform-sdk/formatar';
import { z } from 'zod';
import type { FiltroTela, TelaLista } from '../../descritor/tipos';

export const ROTA_OFICIAIS = '/cadastros/oficiais';
export const ROTA_OFICIAIS_NCM = ROTA_OFICIAIS;
export const ROTA_OFICIAIS_CEST = '/cadastros/oficiais/cest';
export const ROTA_OFICIAIS_CFOP = '/cadastros/oficiais/cfop';
export const ROTA_OFICIAIS_IBGE = '/cadastros/oficiais/ibge';
const MENU_OFICIAIS = 'Tabelas oficiais';

const Vigencia = { vigencia_inicio: z.string().nullable().optional(), vigencia_fim: z.string().nullable().optional() };
const ItemCodigo = z.object({ id: z.string().uuid(), codigo: z.string(), descricao: z.string(), ...Vigencia });
const ItemCest = ItemCodigo.extend({ segmento: z.string().nullable().optional() });
const ItemMunicipio = z.object({ id: z.string().uuid(), codigo: z.string(), nome: z.string(), uf: z.string(), ...Vigencia });

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const;

/** NCM em 8 dígitos vira 0000.00.00 e CEST em 7 vira 00.000.00 (só apresentação). Fora do formato volta como está. */
export const formatarNcm = (c: string): string => (/^\d{8}$/.test(c) ? `${c.slice(0, 4)}.${c.slice(4, 6)}.${c.slice(6)}` : c);
export const formatarCest = (c: string): string => (/^\d{7}$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}` : c);

const FILTRO_DATA: FiltroTela = { chave: 'data', rotulo: 'Vigente em', tipo: 'data', colunas: 2 };
const FILTRO_UF: FiltroTela = { chave: 'uf', rotulo: 'UF', tipo: 'selecao', colunas: 1, vazio: 'Todas', opcoes: UFS.map((u) => ({ valor: u, rotulo: u })) };

const data = (v: unknown) => (typeof v === 'string' && v ? formatarDataCivil(v) : '');
const texto = (v: unknown) => (typeof v === 'string' ? v : '');

type Item = Readonly<Record<string, unknown>>;
interface Coluna { id: string; titulo: string; formatar: (item: Item) => string }
const VIGENCIA: Coluna[] = [
  { id: 'vigencia_inicio', titulo: 'Vigência desde', formatar: (i) => data(i.vigencia_inicio) },
  { id: 'vigencia_fim', titulo: 'Vigência até', formatar: (i) => data(i.vigencia_fim) },
];

function tabela(o: { id: string; titulo: string; rota: string; api: string; item: z.ZodType<Record<string, unknown>>; colunas: Coluna[]; rotuloBusca: string; filtros: FiltroTela[]; uf?: boolean }) {
  const pagina = definirPaginaLista({
    id: o.id, api: o.api, item: o.item, busca: true,
    filtros: { data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ...(o.uf ? { uf: z.string().regex(/^[A-Z]{2}$/).optional() } : {}) },
    colunas: o.colunas.map((c) => ({ id: c.id, titulo: c.titulo, valor: (i: Record<string, unknown>) => c.formatar(i) })),
    csv: false,
    vazio: { semFiltro: `Nenhum registro vigente em ${o.titulo}.`, comFiltro: `Nenhum registro de ${o.titulo} com estes filtros.` },
  });
  const lista: TelaLista = {
    tipo: 'lista',
    pagina: pagina as unknown as TelaLista['pagina'],
    rotuloBusca: o.rotuloBusca,
    filtrosTela: o.filtros,
    colunas: () => o.colunas.map((c) => ({ id: c.id, rotulo: c.titulo })),
    linha: (item) => Object.fromEntries(o.colunas.map((c) => [c.id, c.formatar(item)])),
  };
  return { rota: o.rota, titulo: o.titulo, menu: MENU_OFICIAIS, pagina, lista };
}

const DESCRICAO: Coluna = { id: 'descricao', titulo: 'Descrição', formatar: (i) => texto(i.descricao) };

export const TABELAS_OFICIAIS_TELA = [
  tabela({
    id: 'oficiais-ncm', titulo: 'NCM', rota: ROTA_OFICIAIS_NCM, api: '/v1/cadastros/oficiais/ncm', item: ItemCodigo,
    colunas: [{ id: 'codigo', titulo: 'Código', formatar: (i) => formatarNcm(texto(i.codigo)) }, DESCRICAO, ...VIGENCIA],
    rotuloBusca: 'Código ou descrição do NCM', filtros: [FILTRO_DATA],
  }),
  tabela({
    id: 'oficiais-cest', titulo: 'CEST', rota: ROTA_OFICIAIS_CEST, api: '/v1/cadastros/oficiais/cest', item: ItemCest,
    colunas: [{ id: 'codigo', titulo: 'Código', formatar: (i) => formatarCest(texto(i.codigo)) }, { id: 'segmento', titulo: 'Segmento', formatar: (i) => texto(i.segmento) }, DESCRICAO, ...VIGENCIA],
    rotuloBusca: 'Código ou descrição do CEST', filtros: [FILTRO_DATA],
  }),
  tabela({
    id: 'oficiais-cfop', titulo: 'CFOP', rota: ROTA_OFICIAIS_CFOP, api: '/v1/cadastros/oficiais/cfop', item: ItemCodigo,
    colunas: [{ id: 'codigo', titulo: 'Código', formatar: (i) => texto(i.codigo) }, DESCRICAO, ...VIGENCIA],
    rotuloBusca: 'Código ou descrição do CFOP', filtros: [FILTRO_DATA],
  }),
  tabela({
    id: 'oficiais-ibge', titulo: 'Municípios (IBGE)', rota: ROTA_OFICIAIS_IBGE, api: '/v1/cadastros/oficiais/municipios', item: ItemMunicipio, uf: true,
    colunas: [{ id: 'codigo', titulo: 'Código IBGE', formatar: (i) => texto(i.codigo) }, { id: 'nome', titulo: 'Município', formatar: (i) => texto(i.nome) }, { id: 'uf', titulo: 'UF', formatar: (i) => texto(i.uf) }, ...VIGENCIA],
    rotuloBusca: 'Código ou nome do município', filtros: [FILTRO_UF, FILTRO_DATA],
  }),
] as const;
