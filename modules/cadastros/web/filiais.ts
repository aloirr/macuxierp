/**
 * Filial no BKO (RF-CAD-08, T-0088): lista pelo SDK e formulário de criação e edição. A configuração fiscal da filial
 * (CRT, regime de PIS/COFINS, IE, série da NF-e) roda aqui pelas mesmas funções do `domain` que a API usa (RN-CAD-02,
 * RN-CAD-03, RN-FIS-02, D8); a API revalida e devolve o 422 por campo (`errosDaApi`). O CNPJ só entra na criação. A numeração
 * corrente da NF-e é do faturamento; aqui só a série e o número inicial. Ambiente fiscal e certificado são da empresa (core).
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarDocumento } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { Filial, FilialAtualizacao, FilialDados, RegimePisCofins } from '../contracts';
import { validarFilial } from '../domain';
import { CAMPOS_ENDERECO, camposVisiveis, corpoDoPatch, enderecoDoFormulario, faltandoObrigatorios, opcoes, simNao, colunaSituacao, soDigitos, validarEnderecoTela, vazioParaNulo, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';

export const ROTA_FILIAIS = '/cadastros/filiais';
export const ROTA_FILIAL_NOVA = '/cadastros/filiais/novo';
export const ROTA_FILIAL = '/cadastros/filiais/:id';
export const API_FILIAIS = '/v1/cadastros/filiais';

export type FilialResumo = Filial;

export const ROTULO_CRT: Readonly<Record<FilialDados['crt'], string>> = { '1': 'Simples Nacional', '2': 'Simples Nacional (excesso de sublimite)', '3': 'Regime normal', '4': 'MEI' };
export const ROTULO_REGIME_PIS_COFINS: Readonly<Record<RegimePisCofins, string>> = { cumulativo: 'Cumulativo', nao_cumulativo: 'Não cumulativo' };

export const paginaFiliais = definirPaginaLista({
  id: 'filiais', api: API_FILIAIS, item: Filial, busca: true, inativos: true,
  colunas: [
    { id: 'cnpj', titulo: 'CNPJ', valor: (f) => formatarDocumento(f.cnpj) },
    { id: 'razao_social', titulo: 'Razão social', valor: (f) => f.razao_social },
    { id: 'ie', titulo: 'IE', valor: (f) => f.ie ?? '' },
    { id: 'crt', titulo: 'Regime tributário', valor: (f) => ROTULO_CRT[f.crt] },
    { id: 'padrao', titulo: 'Padrão', valor: (f) => simNao(f.padrao) },
    { id: 'nfe_serie', titulo: 'Série NF-e', valor: (f) => f.nfe_serie },
    { id: 'industrial_ipi', titulo: 'Industrial (IPI)', valor: (f) => simNao(f.industrial_ipi) },
    // RN-FIS-02: só a filial de CRT 3 tem regime; nos demais a célula vem vazia.
    { id: 'regime_pis_cofins', titulo: 'Regime PIS/COFINS', valor: (f) => (f.regime_pis_cofins ? ROTULO_REGIME_PIS_COFINS[f.regime_pis_cofins] : '') },
    colunaSituacao(),
  ],
  csv: { arquivo: 'filiais.csv' },
  vazio: { semFiltro: 'Nenhuma filial cadastrada.', comFiltro: 'Nenhuma filial com estes filtros.' },
});

export const CAMPOS_FILIAL: readonly CampoEdicao[] = [
  { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'texto', obrigatorio: true, soCriacao: true, ajuda: 'Com ou sem pontuação.' },
  { nome: 'razao_social', rotulo: 'Razão social', tipo: 'texto', obrigatorio: true },
  { nome: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto' },
  { nome: 'ie', rotulo: 'Inscrição estadual', tipo: 'texto' },
  { nome: 'crt', rotulo: 'Regime tributário (CRT)', tipo: 'selecao', obrigatorio: true, opcoes: opcoes(ROTULO_CRT) },
  { nome: 'regime_pis_cofins', rotulo: 'Regime de PIS/COFINS', tipo: 'selecao', obrigatorio: true, opcoes: opcoes(ROTULO_REGIME_PIS_COFINS), mostrarSe: (v) => v.crt === '3' },
  { nome: 'industrial_ipi', rotulo: 'Estabelecimento industrial (IPI)', tipo: 'booleano' },
  { nome: 'padrao', rotulo: 'Filial padrão', tipo: 'booleano' },
  { nome: 'emissora', rotulo: 'Emite NF-e', tipo: 'booleano' },
  { nome: 'nfe_serie', rotulo: 'Série da NF-e', tipo: 'texto' },
  { nome: 'nfe_numero_inicial', rotulo: 'Número inicial da NF-e', tipo: 'texto' },
  ...CAMPOS_ENDERECO,
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

/** O regime só existe no CRT 3 (RN-FIS-02); nos demais a tela não o mostra e ele vai vazio. */
const regimeDoFormulario = (v: Valores) => (v.crt === '3' ? vazioParaNulo(v.regime_pis_cofins) : null);

/** Campo da violação do `domain` (nome na API) para o campo do formulário. */
const CAMPO_DO_FORMULARIO: Readonly<Record<string, string>> = { municipio_ibge: 'end_municipio_ibge', uf: 'end_uf' };

export function validarFilialTela(v: Valores, modo: Modo, perfil: Perfil): Erros {
  const e = faltandoObrigatorios(camposDaFilial(perfil, modo), v);
  if (modo === 'criar' && !e.cnpj && !FilialDados.shape.cnpj.safeParse(soDigitos(v.cnpj)).success) e.cnpj = 'CNPJ inválido';
  validarEnderecoTela(v, e);
  const serie = inteiroOuNulo(v.nfe_serie);
  const numero = inteiroOuNulo(v.nfe_numero_inicial);
  if (Number.isNaN(serie) || (serie !== null && !FilialDados.shape.nfe_serie.safeParse(serie).success)) e.nfe_serie = 'A série vai de 0 a 999';
  if (Number.isNaN(numero) || (numero !== null && !FilialDados.shape.nfe_numero_inicial.safeParse(numero).success)) e.nfe_numero_inicial = 'Informe um número inicial maior que zero';
  const crt = FilialDados.shape.crt.safeParse(v.crt);
  const regime = regimeDoFormulario(v);
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
    regime_pis_cofins: regimeDoFormulario(v), industrial_ipi: v.industrial_ipi === 'true', padrao: v.padrao === 'true', emissora: v.emissora === 'true',
    nfe_serie: inteiroOuNulo(v.nfe_serie), nfe_numero_inicial: inteiroOuNulo(v.nfe_numero_inicial),
    endereco: enderecoDoFormulario(v),
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
  return corpoDoPatch(corpoComum(v, 'editar'), original as unknown as Record<string, unknown>, FilialAtualizacao);
}
