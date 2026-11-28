/**
 * Cliente no BKO (RF-CAD-01, T-0088): lista pelo SDK e formulário de criação e edição. RN-CAD-01 (documento) e RN-CAD-02
 * (IE e indicador) rodam aqui pelas mesmas funções do `domain` que a API usa; a API revalida. O limite de crédito só aparece
 * a quem tem `cadastros.cliente.credito`. O endereço principal entra na criação; depois, endereços e contatos têm rota própria.
 */
import type { Perfil } from '@macuxierp/platform-sdk';
import { formatarCentavos, formatarDocumento, formatarValorCentavos } from '@macuxierp/platform-sdk/formatar';
import { definirPaginaLista } from '@macuxierp/platform-sdk/listas';
import { ROTULO_PRAZO_MEDIO } from './prazos';
import { Cliente, ClienteAtualizacao, ClienteDados, Uuid } from '../contracts';
import { sugerirIndIeDest, validarDocumentoCliente, validarIndIeDest, type IndIeDest } from '../domain';
import { CAMPOS_ENDERECO, CAMPOS_LOCALIZACAO, camposVisiveis, centavosDoTexto, corpoDoPatch, enderecoDoFormulario, faltandoObrigatorios, localizacaoDoFormulario, opcoes, colunaSituacao, soDigitos, validarEnderecoTela, vazioParaNulo, type CampoEdicao, type Corpo, type Erros, type Modo, type Valores } from './edicao';

export const ROTA_CLIENTES = '/cadastros/clientes';
export const ROTA_CLIENTE_NOVO = '/cadastros/clientes/novo';
export const ROTA_CLIENTE = '/cadastros/clientes/:id';
export const API_CLIENTES = '/v1/cadastros/clientes';

export const ROTULO_IND_IE: Readonly<Record<IndIeDest, string>> = { '1': 'Contribuinte', '2': 'Isento', '9': 'Não contribuinte' };

/** Cliente como a lista e o detalhe devolvem (os endereços têm rota própria). */
export const ClienteResumo = Cliente.omit({ enderecos: true });
export type ClienteResumo = typeof ClienteResumo._output;

/** Lista pelo SDK (T-0041): paginação padrão e cursor vêm do contrato de listas (ADR 0019). */
export const paginaClientes = definirPaginaLista({
  id: 'clientes', api: API_CLIENTES, item: ClienteResumo, busca: true, inativos: true,
  filtros: { filial_id: Uuid.optional(), vendedor_id: Uuid.optional() },
  colunas: [
    { id: 'documento', titulo: 'CNPJ/CPF', valor: (c) => formatarDocumento(c.documento) },
    { id: 'razao_social', titulo: 'Razão social', valor: (c) => c.razao_social },
    { id: 'nome_fantasia', titulo: 'Fantasia', valor: (c) => c.nome_fantasia ?? '' },
    { id: 'ind_ie_dest', titulo: 'Contribuinte ICMS', valor: (c) => ROTULO_IND_IE[c.ind_ie_dest] },
    { id: 'prazo_medio_dias', titulo: ROTULO_PRAZO_MEDIO, valor: (c) => (typeof c.prazo_medio_dias === 'number' ? `${c.prazo_medio_dias}` : '') },
    { id: 'limite_credito_centavos', titulo: 'Limite', valor: (c) => formatarCentavos(c.limite_credito_centavos), exige: 'cadastros.cliente.credito' },
    colunaSituacao(),
  ],
  csv: { arquivo: 'clientes.csv' },
  vazio: { semFiltro: 'Nenhum cliente cadastrado.', comFiltro: 'Nenhum cliente com estes filtros.' },
});

export const CAMPOS_CLIENTE: readonly CampoEdicao[] = [
  { nome: 'tipo_pessoa', rotulo: 'Tipo de pessoa', tipo: 'selecao', obrigatorio: true, opcoes: [{ valor: 'PJ', rotulo: 'Pessoa jurídica' }, { valor: 'PF', rotulo: 'Pessoa física' }], colunas: 2 },
  { nome: 'documento', rotulo: 'CNPJ/CPF', tipo: 'texto', obrigatorio: true, colunas: 3 },
  { nome: 'razao_social', rotulo: 'Razão social', tipo: 'texto', obrigatorio: true, colunas: 4 },
  { nome: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto', colunas: 3 },
  { nome: 'ind_ie_dest', rotulo: 'Contribuinte ICMS', tipo: 'selecao', obrigatorio: true, opcoes: opcoes(ROTULO_IND_IE), colunas: 3 },
  { nome: 'ie', rotulo: 'Inscrição estadual', tipo: 'texto', ajuda: 'Contribuinte: número válido para a UF. Isento: "ISENTO" ou vazio. Não contribuinte: vazio.', colunas: 3 },
  { nome: 'email_nfe', rotulo: 'E-mail da NF-e', tipo: 'texto', colunas: 3 },
  { nome: 'filial_id', rotulo: 'Filial', tipo: 'cadastro', obrigatorio: true, fonte: '/v1/cadastros/filiais', colunas: 3 },
  { nome: 'vendedor_id', rotulo: 'Vendedor', tipo: 'cadastro', fonte: '/v1/cadastros/vendedores', colunas: 3 },
  { nome: 'condicao_pagamento_id', rotulo: 'Condição de pagamento', tipo: 'cadastro', fonte: '/v1/cadastros/condicoes-pagamento', colunas: 3 },
  { nome: 'tabela_preco_id', rotulo: 'Tabela de preço', tipo: 'cadastro', fonte: '/v1/cadastros/tabelas-preco', colunas: 3 },
  { nome: 'limite_credito_centavos', rotulo: 'Limite de crédito (R$)', tipo: 'dinheiro', exige: 'cadastros.cliente.credito', colunas: 3 },
  ...[...CAMPOS_ENDERECO, ...CAMPOS_LOCALIZACAO].map((c) => ({ ...c, soCriacao: true })),
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
  const campos = camposDoCliente(perfil, modo);
  const e = faltandoObrigatorios(campos, v);
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
  if (modo === 'criar') validarEnderecoTela(v, e);
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
  const endereco = { tipo: 'principal', ...enderecoDoFormulario(v), ...localizacaoDoFormulario(v) };
  const r = ClienteDados.safeParse({ ...corpoComum(v, perfil, 'criar'), enderecos: [endereco] });
  if (!r.success) return null;
  // O contrato devolve limite 0 por padrão; sem a permissão do crédito a chave não vai no corpo (a API aplica o padrão).
  const dados: Record<string, unknown> = { ...r.data };
  if (!camposDoCliente(perfil, 'criar').some((x) => x.nome === 'limite_credito_centavos')) delete dados.limite_credito_centavos;
  return dados as ClienteDados;
}

/** Corpo do PATCH: só o que mudou em relação ao cliente aberto (sem mudança = `null`, nada a enviar). */
export function corpoAlterarCliente(v: Valores, original: ClienteResumo, perfil: Perfil): Corpo | null {
  return corpoDoPatch(corpoComum(v, perfil, 'editar'), original as unknown as Record<string, unknown>, ClienteAtualizacao);
}
