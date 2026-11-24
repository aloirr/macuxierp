/**
 * Filial no BKO (RF-CAD-08, T-0088): lista pelo SDK e formulário de criação e edição. A configuração fiscal da filial
 * (CRT, regime de PIS/COFINS, IE, série da NF-e) roda aqui pelas mesmas funções do `domain` que a API usa (RN-CAD-02,
 * RN-CAD-03, RN-FIS-02, D8); a API revalida e devolve o 422 por campo (`errosDaApi`). O CNPJ só entra na criação. A numeração
 * corrente da NF-e é do faturamento; aqui só a série e o número inicial. Ambiente fiscal e certificado são da empresa (core).
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarDocumento } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { Cep, Filial, FilialAtualizacao, FilialDados, Ibge, RegimePisCofins, Uf } from '../contracts';
import { validarFilial } from '../domain';
import { camposVisiveis, soDigitos, soOQueMudou, vazioParaNulo, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';

export const ROTA_FILIAIS = '/cadastros/filiais';
export const ROTA_FILIAL_NOVA = '/cadastros/filiais/novo';
export const ROTA_FILIAL = '/cadastros/filiais/:id';
export const API_FILIAIS = '/v1/cadastros/filiais';

export type FilialResumo = Filial;

export const ROTULO_CRT: Readonly<Record<FilialDados['crt'], string>> = { '1': 'Simples Nacional', '2': 'Simples Nacional (excesso de sublimite)', '3': 'Regime normal', '4': 'MEI' };
export const ROTULO_REGIME_PIS_COFINS: Readonly<Record<RegimePisCofins, string>> = { cumulativo: 'Cumulativo', nao_cumulativo: 'Não cumulativo' };

const SIM_NAO = (v: boolean | undefined) => (v ? 'Sim' : 'Não');

export const paginaFiliais = definirPaginaLista({
  id: 'filiais', api: API_FILIAIS, item: Filial, busca: true, inativos: true,
  colunas: [
    { id: 'cnpj', titulo: 'CNPJ', valor: (f) => formatarDocumento(f.cnpj) },
    { id: 'razao_social', titulo: 'Razão social', valor: (f) => f.razao_social },
    { id: 'ie', titulo: 'IE', valor: (f) => f.ie ?? '' },
    { id: 'crt', titulo: 'Regime tributário', valor: (f) => ROTULO_CRT[f.crt] },
    { id: 'padrao', titulo: 'Padrão', valor: (f) => SIM_NAO(f.padrao) },
    { id: 'nfe_serie', titulo: 'Série NF-e', valor: (f) => f.nfe_serie },
    { id: 'industrial_ipi', titulo: 'Industrial (IPI)', valor: (f) => SIM_NAO(f.industrial_ipi) },
    // RN-FIS-02: só a filial de CRT 3 tem regime; nos demais a célula vem vazia.
    { id: 'regime_pis_cofins', titulo: 'Regime PIS/COFINS', valor: (f) => (f.regime_pis_cofins ? ROTULO_REGIME_PIS_COFINS[f.regime_pis_cofins] : '') },
    { id: 'inativo', titulo: 'Situação', valor: (f) => (f.inativo ? 'Inativo' : 'Ativo') },
  ],
  csv: { arquivo: 'filiais.csv' },
  vazio: { semFiltro: 'Nenhuma filial cadastrada.', comFiltro: 'Nenhuma filial com estes filtros.' },
});

const opcoes = (r: Readonly<Record<string, string>>) => Object.entries(r).map(([valor, rotulo]) => ({ valor, rotulo }));

export const CAMPOS_FILIAL: readonly CampoEdicao[] = [
  { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', obrigatorio: true, soCriacao: true, ajuda: 'Com ou sem pontuação.' },
  { nome: 'razao_social', rotulo: 'Razão social', tipo: 'texto', obrigatorio: true },
  { nome: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto' },
  { nome: 'ie', rotulo: 'Inscrição estadual', tipo: 'texto', ajuda: 'Número válido para a UF da filial; a filial não pode ser isenta.' },
  { nome: 'crt', rotulo: 'Regime tributário (CRT)', tipo: 'selecao', obrigatorio: true, opcoes: opcoes(ROTULO_CRT) },
  { nome: 'regime_pis_cofins', rotulo: 'Regime de PIS/COFINS', tipo: 'selecao', opcoes: opcoes(ROTULO_REGIME_PIS_COFINS), ajuda: 'Obrigatório no regime normal (CRT 3); nos demais, fica vazio.' },
  { nome: 'industrial_ipi', rotulo: 'Estabelecimento industrial (IPI)', tipo: 'booleano' },
  { nome: 'padrao', rotulo: 'Filial padrão', tipo: 'booleano' },
  { nome: 'emissora', rotulo: 'Emite NF-e', tipo: 'booleano', ajuda: 'A emissora precisa de série e número inicial.' },
  { nome: 'nfe_serie', rotulo: 'Série da NF-e', tipo: 'texto' },
  { nome: 'nfe_numero_inicial', rotulo: 'Número inicial da NF-e', tipo: 'texto' },
  { nome: 'end_cep', rotulo: 'CEP', tipo: 'texto', obrigatorio: true },
  { nome: 'end_logradouro', rotulo: 'Logradouro', tipo: 'texto', obrigatorio: true },
  { nome: 'end_numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true },
  { nome: 'end_complemento', rotulo: 'Complemento', tipo: 'texto' },
  { nome: 'end_bairro', rotulo: 'Bairro', tipo: 'texto', obrigatorio: true },
  { nome: 'end_municipio_ibge', rotulo: 'Município (código IBGE)', tipo: 'texto', obrigatorio: true },
  { nome: 'end_uf', rotulo: 'UF', tipo: 'texto', obrigatorio: true },
];

export const camposDaFilial = (perfil: Perfil, modo: Modo) => camposVisiveis(CAMPOS_FILIAL, perfil, modo);

export function valoresDaFilial(f: FilialResumo): Valores {
  const e = f.endereco;
  return {
    cnpj: formatarDocumento(f.cnpj), razao_social: f.razao_social, nome_fantasia: f.nome_fantasia ?? '', ie: f.ie ?? '', crt: f.crt, regime_pis_cofins: f.regime_pis_cofins ?? '',
    industrial_ipi: f.industrial_ipi ? 'true' : 'false', padrao: f.padrao ? 'true' : 'false', emissora: f.emissora ? 'true' : 'false',
    nfe_serie: f.nfe_serie === null ? '' : String(f.nfe_serie), nfe_numero_inicial: f.nfe_numero_inicial === null ? '' : String(f.nfe_numero_inicial),
    end_cep: e.cep, end_logradouro: e.logradouro, end_numero: e.numero, end_complemento: e.complemento ?? '', end_bairro: e.bairro, end_municipio_ibge: e.municipio_ibge, end_uf: e.uf,
  };
}

/** Inteiro digitado; vazio = `null`; texto que não é número = `NaN` (a validação recusa). */
const inteiroOuNulo = (t: string | undefined): number | null => {
  const s = (t ?? '').trim();
  return s === '' ? null : /^\d+$/.test(s) ? Number(s) : Number.NaN;
};

/** Campo da violação do `domain` (nome na API) para o campo do formulário. */
const CAMPO_DO_FORMULARIO: Readonly<Record<string, string>> = { municipio_ibge: 'end_municipio_ibge', uf: 'end_uf' };

export function validarFilialTela(v: Valores, modo: Modo, perfil: Perfil): Erros {
  const e: Erros = {};
  for (const c of camposDaFilial(perfil, modo)) if (c.obrigatorio && (v[c.nome] ?? '').trim() === '') e[c.nome] = 'Preencha este campo';
  if (modo === 'criar' && !e.cnpj && !FilialDados.shape.cnpj.safeParse(soDigitos(v.cnpj)).success) e.cnpj = 'CNPJ inválido';
  if (!e.end_cep && !Cep.safeParse(soDigitos(v.end_cep)).success) e.end_cep = 'O CEP tem 8 números';
  if (!e.end_municipio_ibge && !Ibge.safeParse((v.end_municipio_ibge ?? '').trim()).success) e.end_municipio_ibge = 'O código IBGE tem 7 números';
  if (!e.end_uf && !Uf.safeParse((v.end_uf ?? '').trim().toUpperCase()).success) e.end_uf = 'Informe a UF com 2 letras';
  const serie = inteiroOuNulo(v.nfe_serie);
  const numero = inteiroOuNulo(v.nfe_numero_inicial);
  if (Number.isNaN(serie) || (serie !== null && !FilialDados.shape.nfe_serie.safeParse(serie).success)) e.nfe_serie = 'A série vai de 0 a 999';
  if (Number.isNaN(numero) || (numero !== null && !FilialDados.shape.nfe_numero_inicial.safeParse(numero).success)) e.nfe_numero_inicial = 'Informe um número inicial maior que zero';
  const crt = FilialDados.shape.crt.safeParse(v.crt);
  const regime = vazioParaNulo(v.regime_pis_cofins);
  if (regime !== null && !RegimePisCofins.safeParse(regime).success) e.regime_pis_cofins = 'Escolha cumulativo ou não cumulativo';
  if (!e.end_municipio_ibge && !e.end_uf && !e.nfe_serie && !e.nfe_numero_inicial && !e.regime_pis_cofins) {
    for (const x of validarFilial({
      uf: (v.end_uf ?? '').trim().toUpperCase(), municipio_ibge: (v.end_municipio_ibge ?? '').trim(), ie: vazioParaNulo(v.ie), emissora: v.emissora === 'true',
      nfe_serie: serie, nfe_numero_inicial: numero, ...(crt.success ? { crt: crt.data, regime_pis_cofins: regime as RegimePisCofins | null } : {}),
    })) e[CAMPO_DO_FORMULARIO[x.campo] ?? x.campo] ??= x.mensagem;
  }
  return e;
}

function corpoComum(v: Valores, modo: Modo): Corpo {
  const c: Corpo = {
    razao_social: (v.razao_social ?? '').trim(), nome_fantasia: vazioParaNulo(v.nome_fantasia), ie: vazioParaNulo(v.ie)?.toUpperCase() ?? null, crt: v.crt,
    regime_pis_cofins: vazioParaNulo(v.regime_pis_cofins), industrial_ipi: v.industrial_ipi === 'true', padrao: v.padrao === 'true', emissora: v.emissora === 'true',
    nfe_serie: inteiroOuNulo(v.nfe_serie), nfe_numero_inicial: inteiroOuNulo(v.nfe_numero_inicial),
    endereco: {
      logradouro: (v.end_logradouro ?? '').trim(), numero: (v.end_numero ?? '').trim(), complemento: vazioParaNulo(v.end_complemento), bairro: (v.end_bairro ?? '').trim(),
      municipio_ibge: (v.end_municipio_ibge ?? '').trim(), uf: (v.end_uf ?? '').trim().toUpperCase(), cep: soDigitos(v.end_cep), pais_bacen: '1058',
    },
  };
  if (modo === 'criar') c.cnpj = soDigitos(v.cnpj);
  return c;
}

/** Corpo do POST; `null` se o contrato recusar (a tela mostra os erros de `validarFilialTela`). */
export function corpoCriarFilial(v: Valores): FilialDados | null {
  const r = FilialDados.safeParse(corpoComum(v, 'criar'));
  return r.success ? r.data : null;
}

/** Corpo do PATCH com o que mudou; o endereço, se mudou em qualquer campo, vai inteiro. Sem mudança, `null`. */
export function corpoAlterarFilial(v: Valores, original: FilialResumo): Corpo | null {
  const novo = soOQueMudou(corpoComum(v, 'editar'), original as unknown as Record<string, unknown>);
  if (Object.keys(novo).length === 0) return null;
  const r = FilialAtualizacao.safeParse(novo);
  if (!r.success) return null;
  const dados = r.data as Record<string, unknown>;
  return Object.fromEntries(Object.keys(novo).map((k) => [k, dados[k]]));
}
