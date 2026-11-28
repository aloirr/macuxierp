/**
 * Adaptador do fiscal (T-0127): transforma os descritores de `@macuxierp/fiscal/web` (regras, catálogo e formulário) nos tipos do renderizador
 * genérico. Nenhuma regra fiscal aqui: colunas, filtros, formulário e validação vêm do módulo (`domain`); a API revalida tudo (RN-CORE-02).
 * A escrita (nova, salvar, excluir e aplicar do catálogo) só aparece com `fiscal.regra.editar`. Sem dado pessoal em log.
 */
import {
  PAGINAS_FISCAL, ROTA_REGRAS, ROTULO_CRT, ROTULO_SITUACAO, ROTULO_TRIBUTO, paginaCatalogo, paginaRegras, type ColunaFiscal,
} from '@macuxierp/fiscal/web';
import { SituacaoRegra, TributoRegra } from '@macuxierp/fiscal/contracts';
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import type { AcaoVista, EntradaAcao, Escrita, FiltroTela, Linha, ResultadoAcao, TelaDescrita, TelaLista, TelaQuadro } from '../descritor/tipos';
import { novaChave } from './comum';

const rotaDe = (id: string): string => PAGINAS_FISCAL.find((p) => p.id === id)?.rota ?? `${ROTA_REGRAS}/${id}`;
export const ROTA_REGRAS_FISCAIS = rotaDe('regras-fiscais');
export const ROTA_CATALOGO = rotaDe('catalogo-fiscal');
export const ROTA_REGRA_NOVA = rotaDe('nova');
export const ROTA_REGRA = rotaDe('detalhe');

/** Um caminho, uma constante: a escrita permitida e a ação usam o mesmo modelo (`:id` é o UUID do registro). */
export const API_REGRAS = '/v1/fiscal/regras';
export const API_REGRA = `${API_REGRAS}/:id`;
const API_APLICAR = '/v1/fiscal/catalogo/:id/aplicar';

type Pagina = typeof paginaRegras | typeof paginaCatalogo;
const colunasDe = (p: Pagina): readonly ColunaFiscal<unknown>[] => p.colunas as unknown as readonly ColunaFiscal<unknown>[];

/**
 * Rótulo das colunas da lista em português claro (sem sigla solta nem nome de coluna); os campos do formulário já vêm assim do módulo.
 */
export const ROTULO_COLUNA: Readonly<Record<string, string>> = {
  ncm_prefixo: 'NCM (produto)', crt: 'Regime (CRT)', codigo: 'Situação tributária', mva_original: 'Margem ST (MVA)', aliquota_icms: 'Alíquota ICMS',
  tipo_cliente: 'Tipo de cliente', vigencia_inicio: 'Vigência desde', vigencia_fim: 'Vigência até', chave: 'Modelo',
};

const OPCOES_TRIBUTO = TributoRegra.options.map((t) => ({ valor: t, rotulo: ROTULO_TRIBUTO[t] }));
const OPCOES_CRT = Object.entries(ROTULO_CRT).map(([valor, rotulo]) => ({ valor, rotulo }));
const OPCOES_SITUACAO = SituacaoRegra.options.map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s] }));
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map((u) => ({ valor: u, rotulo: u }));

/** Filtros na URL: o mesmo conjunto do descritor da página. */
const FILTROS_REGRAS: readonly FiltroTela[] = [
  { chave: 'tributo', rotulo: 'Tributo', tipo: 'selecao', opcoes: OPCOES_TRIBUTO },
  { chave: 'uf_origem', rotulo: 'UF origem', tipo: 'selecao', opcoes: UFS },
  { chave: 'uf_destino', rotulo: 'UF destino', tipo: 'selecao', opcoes: UFS },
  { chave: 'crt', rotulo: 'Regime (CRT)', tipo: 'selecao', opcoes: OPCOES_CRT },
  { chave: 'situacao', rotulo: 'Situação', tipo: 'selecao', opcoes: OPCOES_SITUACAO },
];
const FILTROS_CATALOGO: readonly FiltroTela[] = [{ chave: 'tributo', rotulo: 'Tributo', tipo: 'selecao', opcoes: OPCOES_TRIBUTO }];

/** Colunas da tela (a lista cabe na largura sem rolar; fonte, versão, fim e tipo de cliente ficam na regra aberta e no CSV, que usa o descritor inteiro). */
const NA_TELA: Readonly<Record<string, readonly string[]>> = {
  'regras-fiscais': ['tributo', 'ncm_prefixo', 'cfop', 'uf_origem', 'uf_destino', 'crt', 'codigo', 'aliquota_icms', 'mva_original', 'situacao'],
  'catalogo-fiscal': ['titulo', 'tributo', 'ncm_prefixo', 'uf_destino', 'codigo', 'aplicavel'],
};
function lista(pagina: Pagina, filtrosTela: readonly FiltroTela[], extra: Partial<TelaLista> = {}): TelaLista {
  const ids = NA_TELA[(pagina as unknown as { id: string }).id];
  const colunas = colunasDe(pagina).filter((c) => !ids || ids.includes(c.id));
  return {
    tipo: 'lista',
    pagina: pagina as unknown as TelaLista['pagina'],
    filtrosTela,
    colunas: () => colunas.map((c) => ({ id: c.id, rotulo: ROTULO_COLUNA[c.id] ?? c.titulo, ...(c.tipo ? { tipo: c.tipo } : {}), ...(c.id === 'titulo' ? { largura: '24rem' } : {}) })),
    linha: (item) => Object.fromEntries(colunas.map((c) => { const v = c.valor(item); return [c.id, v === null || v === undefined ? '' : String(v)]; })),
    selos: (item) => Object.fromEntries(colunas.flatMap((c) => (c.selos ? [[c.id, c.selos(item)] as const] : []))),
    ...extra,
  };
}

export const LISTA_REGRAS: TelaLista = lista(paginaRegras, FILTROS_REGRAS, {
  rotuloBusca: 'NCM ou CFOP',
  novo: { rota: ROTA_REGRA_NOVA, rotulo: 'Nova regra', criar: 'fiscal.regra.editar' },
  rotaDaLinha: (l) => ROTA_REGRA.replace(':id', String(l.id)),
  rotuloDaLinha: (l) => `Abrir regra ${String(l.tributo ?? '').toUpperCase()} ${String(l.ncm_prefixo ?? 'de todos os NCM')}`.trim(),
});

/** "Aplicar" do catálogo: só quem edita regra e só o modelo aplicável (a API recusa o resto); confirma e envia `{ confirmo: true }`. */
function acaoAplicar(l: Linha, perfil: Perfil): AcaoVista | null {
  if (!pode(perfil, 'fiscal.regra.editar') || l.aplicavel !== true) return null;
  return {
    id: 'aplicar', rotulo: 'Aplicar', metodo: 'POST', caminho: API_APLICAR.replace(':id', String(l.id)), entrada: 'confirmar', principal: true,
    tituloDialogo: `Aplicar o modelo ${String(l.chave ?? '')}?`,
    aviso: 'A regra entra em vigor na data de início do modelo e passa a valer nas próximas notas. A alteração fica registrada.',
    rotuloConfirmar: 'Aplicar', textoCarregando: 'Aplicando…',
  };
}
const validarAplicar = (_a: AcaoVista, _e: EntradaAcao): ResultadoAcao => ({ ok: true, corpo: { confirmo: true } });
const POST = (caminho: string): Escrita => ({ metodo: 'POST', caminho });

export const LISTA_CATALOGO: TelaLista = lista(paginaCatalogo, FILTROS_CATALOGO, {
  rotuloBusca: 'Chave ou título',
  acaoDaLinha: { acao: acaoAplicar, validarAcao: validarAplicar, escritas: [POST(API_APLICAR)], novaChave },
});

/** Escritas do formulário da regra (a tela é própria, `FormularioRegra`): criar, salvar (`PUT` com If-Match) e excluir. */
const QUADRO_REGRA: TelaQuadro = {
  tipo: 'quadro',
  validarAcao: () => ({ ok: true }),
  escritas: [POST(API_REGRAS), { metodo: 'PUT', caminho: API_REGRA }, { metodo: 'DELETE', caminho: API_REGRA }],
  novaChave,
};

export const TELAS_FISCAL: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_REGRAS_FISCAIS]: LISTA_REGRAS,
  [ROTA_CATALOGO]: LISTA_CATALOGO,
  [ROTA_REGRA_NOVA]: QUADRO_REGRA,
  [ROTA_REGRA]: QUADRO_REGRA,
};
