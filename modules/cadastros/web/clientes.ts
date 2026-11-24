/**
 * Cliente no BKO (RF-CAD-01, T-0088): lista pelo SDK e formulário de criação e edição. RN-CAD-01 (documento) e RN-CAD-02
 * (IE e indicador) rodam aqui pelas mesmas funções do `domain` que a API usa; a API revalida. O limite de crédito só aparece
 * a quem tem `cadastros.cliente.credito`. O endereço principal entra na criação; depois, endereços e contatos têm rota própria.
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarDocumento, formatarValorCentavos } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { Cep, Cliente, ClienteAtualizacao, ClienteDados, Ibge, Uf, Uuid, type EnderecoCliente } from '../contracts';
import { sugerirIndIeDest, validarDocumentoCliente, validarIndIeDest, type IndIeDest } from '../domain';
import { camposVisiveis, centavosDoTexto, soDigitos, soOQueMudou, vazioParaNulo, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';

export const ROTA_CLIENTES = '/cadastros/clientes';
export const ROTA_CLIENTE_NOVO = '/cadastros/clientes/novo';
export const ROTA_CLIENTE = '/cadastros/clientes/:id';
export const API_CLIENTES = '/v1/cadastros/clientes';

export const ROTULO_IND_IE: Readonly<Record<IndIeDest, string>> = { '1': 'Contribuinte', '2': 'Isento', '9': 'Não contribuinte' };

/** Cliente como a lista e o detalhe devolvem (os endereços têm rota própria). */
export const ClienteResumo = Cliente.omit({ enderecos: true });
export type ClienteResumo = typeof ClienteResumo._output;

/** Lista pelo SDK (T-0041): limites 200/30 e cursor vêm do contrato de listas (ADR 0019). */
export const paginaClientes = definirPaginaLista({
  id: 'clientes', api: API_CLIENTES, item: ClienteResumo, busca: true, inativos: true,
  filtros: { filial_id: Uuid.optional(), vendedor_id: Uuid.optional() },
  colunas: [
    { id: 'documento', titulo: 'CNPJ/CPF', valor: (c) => formatarDocumento(c.documento) },
    { id: 'razao_social', titulo: 'Razão social', valor: (c) => c.razao_social },
    { id: 'nome_fantasia', titulo: 'Fantasia', valor: (c) => c.nome_fantasia ?? '' },
    { id: 'ind_ie_dest', titulo: 'Contribuinte ICMS', valor: (c) => ROTULO_IND_IE[c.ind_ie_dest] },
    { id: 'limite_credito_centavos', titulo: 'Limite', valor: (c) => formatarCentavos(c.limite_credito_centavos), exige: 'cadastros.cliente.credito' },
    { id: 'inativo', titulo: 'Situação', valor: (c) => (c.inativo ? 'Inativo' : 'Ativo') },
  ],
  csv: { arquivo: 'clientes.csv' },
  vazio: { semFiltro: 'Nenhum cliente cadastrado.', comFiltro: 'Nenhum cliente com estes filtros.' },
});

export const CAMPOS_CLIENTE: readonly CampoEdicao[] = [
  { nome: 'tipo_pessoa', rotulo: 'Tipo de pessoa', tipo: 'selecao', obrigatorio: true, opcoes: [{ valor: 'PJ', rotulo: 'Pessoa jurídica' }, { valor: 'PF', rotulo: 'Pessoa física' }] },
  { nome: 'documento', rotulo: 'CNPJ/CPF', tipo: 'texto', obrigatorio: true, ajuda: 'Com ou sem pontuação; os dígitos verificadores são conferidos.' },
  { nome: 'razao_social', rotulo: 'Razão social', tipo: 'texto', obrigatorio: true },
  { nome: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto' },
  { nome: 'ind_ie_dest', rotulo: 'Contribuinte ICMS', tipo: 'selecao', obrigatorio: true, opcoes: Object.entries(ROTULO_IND_IE).map(([valor, rotulo]) => ({ valor, rotulo })) },
  { nome: 'ie', rotulo: 'Inscrição estadual', tipo: 'texto', ajuda: 'Contribuinte: número válido para a UF. Isento: "ISENTO" ou vazio. Não contribuinte: vazio.' },
  { nome: 'email_nfe', rotulo: 'E-mail da NF-e', tipo: 'texto' },
  { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', obrigatorio: true, fonte: '/v1/cadastros/filiais' },
  { nome: 'vendedor_id', rotulo: 'Vendedor', tipo: 'cadastro', fonte: '/v1/cadastros/vendedores' },
  { nome: 'condicao_pagamento_id', rotulo: 'Condição de pagamento', tipo: 'cadastro', fonte: '/v1/cadastros/condicoes-pagamento' },
  { nome: 'tabela_preco_id', rotulo: 'Tabela de preço', tipo: 'cadastro', fonte: '/v1/cadastros/tabelas-preco' },
  { nome: 'limite_credito_centavos', rotulo: 'Limite de crédito (R$)', tipo: 'dinheiro', exige: 'cadastros.cliente.credito' },
  { nome: 'end_cep', rotulo: 'CEP', tipo: 'texto', obrigatorio: true, soCriacao: true },
  { nome: 'end_logradouro', rotulo: 'Logradouro', tipo: 'texto', obrigatorio: true, soCriacao: true },
  { nome: 'end_numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true, soCriacao: true },
  { nome: 'end_complemento', rotulo: 'Complemento', tipo: 'texto', soCriacao: true },
  { nome: 'end_bairro', rotulo: 'Bairro', tipo: 'texto', obrigatorio: true, soCriacao: true },
  { nome: 'end_municipio_ibge', rotulo: 'Município (código IBGE)', tipo: 'texto', obrigatorio: true, soCriacao: true },
  { nome: 'end_uf', rotulo: 'UF', tipo: 'texto', obrigatorio: true, soCriacao: true },
];

export const camposDoCliente = (perfil: Perfil, modo: Modo) => camposVisiveis(CAMPOS_CLIENTE, perfil, modo);

/** Valores do formulário a partir do cliente aberto (edição). */
export function valoresDoCliente(c: ClienteResumo): Valores {
  return {
    tipo_pessoa: c.tipo_pessoa, documento: formatarDocumento(c.documento), razao_social: c.razao_social, nome_fantasia: c.nome_fantasia ?? '', ind_ie_dest: c.ind_ie_dest,
    ie: c.ie ?? '', email_nfe: c.email_nfe ?? '', filial_id: c.filial_id, vendedor_id: c.vendedor_id ?? '', condicao_pagamento_id: c.condicao_pagamento_id ?? '',
    tabela_preco_id: c.tabela_preco_id ?? '', limite_credito_centavos: c.limite_credito_centavos == null ? '' : formatarValorCentavos(c.limite_credito_centavos),
  };
}

/** Indicador sugerido ao digitar a IE (RN-CAD-02); a pessoa pode trocar. */
export const indicadorSugerido = (ie: string): IndIeDest => sugerirIndIeDest(vazioParaNulo(ie));

/**
 * Validação local. `ufPrincipal`: na criação vem do campo `end_uf`; na edição, da UF do endereço principal gravado
 * (sem ela a IE de contribuinte não pode ser conferida aqui, e a API decide).
 */
export function validarCliente(v: Valores, modo: Modo, perfil: Perfil, ufPrincipal?: string): Erros {
  const e: Erros = {};
  const campos = camposDoCliente(perfil, modo);
  for (const c of campos) if (c.obrigatorio && (v[c.nome] ?? '').trim() === '') e[c.nome] = 'Preencha este campo';
  if (!e.tipo_pessoa && !e.documento && (v.tipo_pessoa === 'PJ' || v.tipo_pessoa === 'PF')) {
    const d = validarDocumentoCliente(v.tipo_pessoa, v.documento ?? '');
    if (!d.ok) e.documento = d.violacao.mensagem;
  }
  const uf = modo === 'criar' ? (v.end_uf ?? '').trim().toUpperCase() : (ufPrincipal ?? '');
  const ind = v.ind_ie_dest;
  if (!e.ind_ie_dest && (ind === '1' || ind === '2' || ind === '9') && (ind !== '1' || uf !== '')) {
    const ie = validarIndIeDest({ ind_ie_dest: ind, ie: vazioParaNulo(v.ie), uf });
    if (!ie.ok) e.ie = ie.violacao.mensagem;
  }
  if (campos.some((c) => c.nome === 'limite_credito_centavos') && centavosDoTexto(v.limite_credito_centavos) === null) e.limite_credito_centavos = 'Informe o limite em reais, como 1.500,00';
  if (modo === 'criar') {
    if (!e.end_cep && !Cep.safeParse(soDigitos(v.end_cep)).success) e.end_cep = 'O CEP tem 8 números';
    if (!e.end_municipio_ibge && !Ibge.safeParse((v.end_municipio_ibge ?? '').trim()).success) e.end_municipio_ibge = 'O código IBGE tem 7 números';
    if (!e.end_uf && !Uf.safeParse((v.end_uf ?? '').trim().toUpperCase()).success) e.end_uf = 'Informe a UF com 2 letras';
  }
  return e;
}

function corpoComum(v: Valores, perfil: Perfil, modo: Modo): Corpo {
  const c: Corpo = {
    tipo_pessoa: v.tipo_pessoa, documento: soDigitos(v.documento), razao_social: (v.razao_social ?? '').trim(), nome_fantasia: vazioParaNulo(v.nome_fantasia), ind_ie_dest: v.ind_ie_dest,
    ie: vazioParaNulo(v.ie)?.toUpperCase() ?? null, email_nfe: vazioParaNulo(v.email_nfe), filial_id: v.filial_id, vendedor_id: vazioParaNulo(v.vendedor_id),
    condicao_pagamento_id: vazioParaNulo(v.condicao_pagamento_id), tabela_preco_id: vazioParaNulo(v.tabela_preco_id),
  };
  // Sem a permissão do crédito o campo nem vai no corpo (a API recusa com 403 se for).
  if (camposDoCliente(perfil, modo).some((x) => x.nome === 'limite_credito_centavos')) c.limite_credito_centavos = centavosDoTexto(v.limite_credito_centavos) ?? 0;
  return c;
}

/** Corpo do POST (cliente com o endereço principal); `null` se o contrato recusar (a tela mostra os erros de `validarCliente`). */
export function corpoCriarCliente(v: Valores, perfil: Perfil): ClienteDados | null {
  const endereco: EnderecoCliente = {
    tipo: 'principal', logradouro: (v.end_logradouro ?? '').trim(), numero: (v.end_numero ?? '').trim(), complemento: vazioParaNulo(v.end_complemento), bairro: (v.end_bairro ?? '').trim(),
    municipio_ibge: (v.end_municipio_ibge ?? '').trim(), uf: (v.end_uf ?? '').trim().toUpperCase(), cep: soDigitos(v.end_cep), pais_bacen: '1058',
  };
  const r = ClienteDados.safeParse({ ...corpoComum(v, perfil, 'criar'), enderecos: [endereco] });
  return r.success ? r.data : null;
}

/** Corpo do PATCH: só o que mudou em relação ao cliente aberto (sem mudança = `null`, nada a enviar). */
export function corpoAlterarCliente(v: Valores, original: ClienteResumo, perfil: Perfil): Corpo | null {
  const novo = soOQueMudou(corpoComum(v, perfil, 'editar'), original as unknown as Record<string, unknown>);
  if (Object.keys(novo).length === 0) return null;
  const r = ClienteAtualizacao.safeParse(novo);
  if (!r.success) return null;
  const dados = r.data as Record<string, unknown>;
  return Object.fromEntries(Object.keys(novo).map((k) => [k, dados[k]]));
}
