/**
 * Adaptador do cadastros no BKO (v0.3.28): Clientes, Produtos, Filiais e Tabelas de preço (só o cabeçalho; os itens em lote não têm
 * descritor), cada uma com lista, novo e edição. Nenhuma regra de negócio aqui: colunas, filtros, campos por perfil e modo, validação
 * (RN-CAD-01, RN-CAD-02, RN-CAD-06, RN-FIS-02) e o corpo do POST e do PATCH vêm de `@macuxierp/cadastros/web`; a API revalida
 * perfil, tenant e licença do módulo (regra 6). Sem dado pessoal em log.
 */
import {
  API_CLIENTES, ClienteResumo, ROTA_CLIENTE, ROTA_CLIENTE_NOVO, ROTA_CLIENTES, camposDoCliente, corpoAlterarCliente, corpoCriarCliente, paginaClientes, validarCliente, valoresDoCliente,
  API_FILIAIS, ROTA_FILIAIS, ROTA_FILIAL, ROTA_FILIAL_NOVA, camposDaFilial, corpoAlterarFilial, corpoCriarFilial, paginaFiliais, validarFilialTela, valoresDaFilial,
  API_PRODUTOS, ROTA_PRODUTO, ROTA_PRODUTO_NOVO, ROTA_PRODUTOS, camposDoProduto, corpoAlterarProduto, corpoCriarProduto, paginaProdutos, validarProduto, valoresDoProduto,
  API_TABELAS_PRECO, ROTA_TABELA_PRECO, ROTA_TABELA_PRECO_NOVA, ROTA_TABELAS_PRECO, camposDaTabelaPreco, corpoAlterarTabelaPreco, corpoCriarTabelaPreco, paginaTabelasPreco, validarTabelaPreco, valoresDaTabelaPreco,
  type CampoEdicao, type Modo,
} from '@macuxierp/cadastros/web';
import { colunasDoPerfil } from '@macuxierp/platform-sdk/listas';
import type { Perfil } from '@macuxierp/platform-sdk';
import type { CampoFormulario, FiltroTela, TelaDescrita, TelaFormulario, TelaLista } from '../descritor/tipos';
import { colunasDoModulo, novaChave } from './comum';

export {
  ROTA_CLIENTES, ROTA_CLIENTE_NOVO, ROTA_CLIENTE, ROTA_PRODUTOS, ROTA_PRODUTO_NOVO, ROTA_PRODUTO, ROTA_FILIAIS, ROTA_FILIAL_NOVA, ROTA_FILIAL, ROTA_TABELAS_PRECO, ROTA_TABELA_PRECO_NOVA, ROTA_TABELA_PRECO,
};

const EDITAR = 'cadastros.cliente.editar' as const;
/** Sem o perfil (nunca acontece no shell, que sempre o passa) vale o de menos privilégio. */
const MENOS_PRIVILEGIADO: Perfil = 'vendedor';

type Tipo = 'texto' | 'numero' | 'dinheiro' | 'data' | 'status';
type Valores = Readonly<Record<string, string>>;

// ---- Peças comuns ----

/** Filtro "Situação" que toda lista do cadastros declara (`inativos`); os seletores de cadastro leem do próprio cadastros. */
const FILTRO_INATIVOS: FiltroTela = { chave: 'inativos', rotulo: 'Situação', tipo: 'selecao', vazio: 'Só ativos', opcoes: [{ valor: 'true', rotulo: 'Ativos e inativos' }] };

const SIM_NAO = [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }] as const;

/** Campo do descritor do módulo no campo do formulário genérico (dinheiro digita como número, em reais; sim/não vira seleção). */
const paraCampo = (c: CampoEdicao): CampoFormulario => ({
  nome: c.nome, rotulo: c.rotulo, tipo: c.tipo === 'dinheiro' ? 'numero' : c.tipo === 'booleano' ? 'selecao' : c.tipo,
  ...(c.obrigatorio ? { obrigatorio: true } : {}), ...(c.fonte ? { fonte: c.fonte } : {}), ...(c.ajuda ? { ajuda: c.ajuda } : {}),
  ...(c.tipo === 'booleano' ? { opcoes: SIM_NAO } : c.opcoes ? { opcoes: c.opcoes } : {}), ...(c.mostrarSe ? { mostrarSe: c.mostrarSe } : {}),
});
const camposDe = (campos: (perfil: Perfil, modo: Modo) => CampoEdicao[], modo: Modo) => (perfil: Perfil): readonly CampoFormulario[] => campos(perfil, modo).map(paraCampo);

interface PaginaDoModulo { colunas: readonly { id: string; valor: unknown }[] }

/** Lista do cadastros a partir da página do módulo: colunas, busca e CSV vêm do descritor; o shell liga a rota, o selo de situação e o botão "Novo". */
function listaDe(pagina: PaginaDoModulo, o: { rotuloBusca: string; filtros?: readonly FiltroTela[]; tipos: Readonly<Record<string, Tipo>>; novo: NonNullable<TelaLista['novo']>; rota: string; rotuloLinha: string; campoRotulo: string }): TelaLista {
  return {
    tipo: 'lista',
    pagina: pagina as unknown as TelaLista['pagina'],
    rotuloBusca: o.rotuloBusca,
    filtrosTela: o.filtros ?? [FILTRO_INATIVOS],
    /** Colunas que o perfil vê (o custo só com `cadastros.produto.editar`; o limite do cliente, com `cadastros.cliente.credito`). */
    colunas: (perfil) => colunasDoModulo(colunasDoPerfil(pagina as unknown as Parameters<typeof colunasDoPerfil>[0], perfil), o.tipos),
    linha: (item) => Object.fromEntries(pagina.colunas.map((c) => [c.id, String((c.valor as (l: unknown) => unknown)(item) ?? '')])),
    selos: (item) => ({ inativo: [item.inativo === true ? { texto: 'Inativo', tom: 'neutro' } : { texto: 'Ativo', tom: 'ok' }] }),
    novo: o.novo,
    rotaDaLinha: (l) => o.rota.replace(':id', String(l.id)),
    rotuloDaLinha: (l) => `${o.rotuloLinha} ${String(l[o.campoRotulo] ?? '')}`.trim(),
  };
}

interface Cadastro<R> {
  api: string; voltar: string; salvar: string;
  campos: (perfil: Perfil, modo: Modo) => CampoEdicao[];
  validar: (v: Valores, modo: Modo, perfil: Perfil) => Valores;
  criar: (v: Valores, perfil: Perfil) => unknown;
  abrir: (corpo: unknown) => { valores: Valores; original: R };
  patch: (v: Valores, original: R, perfil: Perfil) => unknown;
}

/** Novo (POST) e edição (PATCH só do que mudou, em `api/:id`; a rota é declarada em `escritaDeclarada`) do mesmo cadastro. */
function formularios<R>(f: Cadastro<R>): { novo: TelaFormulario; editar: TelaFormulario } {
  const base = { api: f.api, depois: () => f.voltar, voltar: f.voltar, novaChave } as const;
  const novo: TelaFormulario = {
    tipo: 'formulario', ...base, enviar: f.salvar,
    campos: camposDe(f.campos, 'criar')(MENOS_PRIVILEGIADO), camposDoPerfil: camposDe(f.campos, 'criar'),
    validar: (v, _i, perfil) => ({ ...f.validar(v, 'criar', perfil ?? MENOS_PRIVILEGIADO) }),
    montar: (v, _i, perfil) => {
      const corpo = f.criar(v, perfil ?? MENOS_PRIVILEGIADO);
      if (!corpo) throw new Error('formulário inválido');
      return corpo;
    },
  };
  const editar: TelaFormulario = {
    tipo: 'formulario', ...base, enviar: 'Salvar alterações',
    campos: camposDe(f.campos, 'editar')(MENOS_PRIVILEGIADO), camposDoPerfil: camposDe(f.campos, 'editar'),
    validar: (v, _i, perfil) => ({ ...f.validar(v, 'editar', perfil ?? MENOS_PRIVILEGIADO) }),
    montar: () => { throw new Error('edição usa montarPatch'); },
    edicao: { ler: (id) => `${f.api}/${encodeURIComponent(id)}`, abrir: (c) => f.abrir(c), montarPatch: (v, original, perfil) => f.patch(v, original as R, perfil) },
  };
  return { novo, editar };
}

// ---- Clientes ----

/** Filtros do descritor (`filial_id`, `vendedor_id`) mais o "inativos" que a página declara; os seletores leem do próprio cadastros. */
const FILTROS_CLIENTES: readonly FiltroTela[] = [
  { chave: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', fonte: '/v1/cadastros/filiais' },
  { chave: 'vendedor_id', rotulo: 'Vendedor', tipo: 'cadastro', fonte: '/v1/cadastros/vendedores' },
  FILTRO_INATIVOS,
];

export const LISTA_CLIENTES: TelaLista = listaDe(paginaClientes, {
  rotuloBusca: 'Razão social, fantasia ou CNPJ/CPF', filtros: FILTROS_CLIENTES, rota: ROTA_CLIENTE, rotuloLinha: 'Abrir cliente', campoRotulo: 'razao_social',
  tipos: { prazo_medio_dias: 'numero', limite_credito_centavos: 'dinheiro', inativo: 'status' },
  novo: { rota: ROTA_CLIENTE_NOVO, rotulo: 'Novo cliente', criar: EDITAR },
});

const CLIENTE = formularios({
  api: API_CLIENTES, voltar: ROTA_CLIENTES, salvar: 'Salvar cliente', campos: camposDoCliente, validar: validarCliente, criar: corpoCriarCliente,
  abrir: (c) => { const r = ClienteResumo.parse(c); return { valores: valoresDoCliente(r), original: r }; },
  patch: corpoAlterarCliente,
});
export const NOVO_CLIENTE = CLIENTE.novo;
export const EDITAR_CLIENTE = CLIENTE.editar;

// ---- Produtos, Filiais e Tabelas de preço ----

export const LISTA_PRODUTOS = listaDe(paginaProdutos, {
  rotuloBusca: 'Código, descrição ou EAN', tipos: { custo_centavos: 'dinheiro', inativo: 'status' }, rota: ROTA_PRODUTO, rotuloLinha: 'Abrir produto', campoRotulo: 'descricao',
  novo: { rota: ROTA_PRODUTO_NOVO, rotulo: 'Novo produto', criar: 'cadastros.produto.editar' },
});
export const LISTA_FILIAIS = listaDe(paginaFiliais, {
  rotuloBusca: 'Razão social ou CNPJ', tipos: { nfe_serie: 'numero', inativo: 'status' }, rota: ROTA_FILIAL, rotuloLinha: 'Abrir filial', campoRotulo: 'razao_social',
  novo: { rota: ROTA_FILIAL_NOVA, rotulo: 'Nova filial', criar: 'cadastros.filial.editar' },
});
export const LISTA_TABELAS_PRECO = listaDe(paginaTabelasPreco, {
  rotuloBusca: 'Nome da tabela', tipos: { inativo: 'status' }, rota: ROTA_TABELA_PRECO, rotuloLinha: 'Abrir tabela de preço', campoRotulo: 'nome',
  novo: { rota: ROTA_TABELA_PRECO_NOVA, rotulo: 'Nova tabela de preço', criar: 'cadastros.preco.editar' },
});

const PRODUTO = formularios({
  api: API_PRODUTOS, voltar: ROTA_PRODUTOS, salvar: 'Salvar produto', campos: camposDoProduto, validar: validarProduto, criar: corpoCriarProduto,
  abrir: (c) => { const p = paginaProdutos.item.parse(c); return { valores: valoresDoProduto(p), original: p }; },
  patch: corpoAlterarProduto,
});
const FILIAL = formularios({
  api: API_FILIAIS, voltar: ROTA_FILIAIS, salvar: 'Salvar filial', campos: camposDaFilial, validar: validarFilialTela, criar: (v) => corpoCriarFilial(v),
  abrir: (c) => { const f = paginaFiliais.item.parse(c); return { valores: valoresDaFilial(f), original: f }; },
  patch: (v, o) => corpoAlterarFilial(v, o),
});
const TABELA = formularios({
  api: API_TABELAS_PRECO, voltar: ROTA_TABELAS_PRECO, salvar: 'Salvar tabela de preço', campos: camposDaTabelaPreco, validar: validarTabelaPreco, criar: (v) => corpoCriarTabelaPreco(v),
  abrir: (c) => { const t = paginaTabelasPreco.item.parse(c); return { valores: valoresDaTabelaPreco(t), original: t }; },
  patch: (v, o) => corpoAlterarTabelaPreco(v, o),
});

export const NOVO_PRODUTO = PRODUTO.novo;
export const EDITAR_PRODUTO = PRODUTO.editar;
export const NOVA_FILIAL = FILIAL.novo;
export const EDITAR_FILIAL = FILIAL.editar;
export const NOVA_TABELA_PRECO = TABELA.novo;
export const EDITAR_TABELA_PRECO = TABELA.editar;

export const TELAS_CADASTROS: Readonly<Record<string, TelaDescrita>> = {
  [ROTA_CLIENTES]: LISTA_CLIENTES,
  [ROTA_CLIENTE_NOVO]: NOVO_CLIENTE,
  [ROTA_CLIENTE]: EDITAR_CLIENTE,
  [ROTA_PRODUTOS]: LISTA_PRODUTOS,
  [ROTA_PRODUTO_NOVO]: NOVO_PRODUTO,
  [ROTA_PRODUTO]: EDITAR_PRODUTO,
  [ROTA_FILIAIS]: LISTA_FILIAIS,
  [ROTA_FILIAL_NOVA]: NOVA_FILIAL,
  [ROTA_FILIAL]: EDITAR_FILIAL,
  [ROTA_TABELAS_PRECO]: LISTA_TABELAS_PRECO,
  [ROTA_TABELA_PRECO_NOVA]: NOVA_TABELA_PRECO,
  [ROTA_TABELA_PRECO]: EDITAR_TABELA_PRECO,
};
