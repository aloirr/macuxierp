/**
 * Pré-cadastro de cliente do FDV (T-0059 §4): `ClienteParaErpFdv` → `ClienteDados` ou a lista de erros por campo, com
 * TODAS as recusas juntas. Função pura: as consultas ao banco entram prontas em `ContextoPreCadastroFdv`.
 * A mensagem sai do catálogo, nunca leva o valor recusado (LGPD). Os campos obrigatórios seguem as RN atuais; a
 * obrigatoriedade parametrizada da RN-CAD-14 entra quando o parâmetro existir.
 */
import { MAX_MOTIVO_RETORNO_CLIENTE_FDV, normalizarDocumento, type ClienteParaErpFdv, type ErroCampoClienteFdv } from '@macuxierp/platform-sdk';
import { Cep, ClienteDados, Endereco } from '../contracts';
import { resolverMunicipio, type MunicipioOficial } from './carga/municipio-por-nome';
import { tipoPessoaDoDocumento, validarDocumentoCliente } from './documento';
import { validarIe, validarIndIeDest, type IndIeDest } from './ie';
import { CODIGO_UF } from './municipio';

/** O que a API consulta antes de chamar a regra (a regra continua pura). */
export interface ContextoPreCadastroFdv {
  /** Já existe cliente ATIVO com o mesmo documento no tenant. */
  documentoJaCadastrado: boolean;
  /** Municípios vigentes da UF de `chavesDoPreCadastroFdv` (tabela oficial do IBGE); vazio para UF desconhecida. */
  municipiosDaUf: readonly MunicipioOficial[];
  /** Filial resolvida pela API: a do `filial_external_id` ou, sem ele, a padrão. `null` = não achou. */
  filialId: string | null;
}

export type ResultadoPreCadastroFdv = { ok: true; dados: ClienteDados } | { ok: false; erros: ErroCampoClienteFdv[] };

/** Catálogo: mensagem por código, sem o valor recusado. */
export const MENSAGENS_PRE_CADASTRO_FDV = Object.freeze({
  documento_obrigatorio: 'Informe o CPF ou o CNPJ do cliente.',
  documento_invalido: 'CPF ou CNPJ inválido (dígito verificador).',
  documento_ja_cadastrado: 'Já existe um cliente ativo com este documento no ERP.',
  ie_invalida: 'Inscrição estadual inválida para a UF informada.',
  uf_invalida: 'UF inválida ou não informada.',
  municipio_nao_encontrado: 'Cidade não encontrada na UF pela tabela do IBGE.',
  municipio_ambiguo: 'Cidade ambígua na UF: confira o nome.',
  cep_invalido: 'CEP deve ter 8 dígitos.',
  campo_obrigatorio: 'Campo obrigatório no endereço da NF-e.',
  tamanho_maximo: 'Texto maior que o limite do ERP.',
  filial_nao_encontrada: 'Filial não encontrada no ERP.',
  dado_invalido: 'Dado recusado pelas regras do cadastro do ERP.',
});
export type CodigoPreCadastroFdv = keyof typeof MENSAGENS_PRE_CADASTRO_FDV;

const so = (v: string | null | undefined): string => (v ?? '').trim();

/** Erro por campo com a mensagem do catálogo; `municipio_ambiguo` só muda a mensagem: o código que o FDV conhece é `municipio_nao_encontrado`. */
export const erroPreCadastroFdv = (campo: string, codigo: CodigoPreCadastroFdv): ErroCampoClienteFdv => ({
  campo, codigo: codigo === 'municipio_ambiguo' ? 'municipio_nao_encontrado' : codigo, mensagem: MENSAGENS_PRE_CADASTRO_FDV[codigo],
});
const erro = erroPreCadastroFdv;

/** As chaves que a API consulta antes da regra: documento normalizado, UF como o ERP guarda (maiúscula) e a filial pedida (vazia = a padrão). */
export function chavesDoPreCadastroFdv(pre: ClienteParaErpFdv): { documento: string; uf: string; filialExterna: string } {
  return { documento: normalizarDocumento(so(pre.documento)), uf: so(pre.uf).toUpperCase(), filialExterna: so(pre.filial_external_id) };
}

/** RN-CAD-01, RN-CAD-02, RN-CAD-03 e os limites da NF-e sobre o pré-cadastro do FDV. */
export function validarPreCadastroFdv(pre: ClienteParaErpFdv, ctx: ContextoPreCadastroFdv): ResultadoPreCadastroFdv {
  const erros: ErroCampoClienteFdv[] = [];

  // RN-CAD-01
  const { documento, uf } = chavesDoPreCadastroFdv(pre);
  const tipo = tipoPessoaDoDocumento(documento);
  if (documento === '') erros.push(erro('documento', 'documento_obrigatorio'));
  else if (tipo === null || !validarDocumentoCliente(tipo, documento).ok) erros.push(erro('documento', 'documento_invalido'));
  else if (ctx.documentoJaCadastrado) erros.push(erro('documento', 'documento_ja_cadastrado'));

  // RN-CAD-03: UF e cidade pelo IBGE, sem diferenciar acento nem caixa
  const ufOk = Object.hasOwn(CODIGO_UF, uf);
  if (!ufOk) erros.push(erro('uf', 'uf_invalida'));
  let ibge: string | null = null;
  const cidade = so(pre.cidade);
  if (ufOk) {
    if (cidade === '') erros.push(erro('cidade', 'municipio_nao_encontrado'));
    else {
      const m = resolverMunicipio(cidade, ctx.municipiosDaUf);
      if (m.ok) ibge = m.ibge;
      else erros.push(erro('cidade', m.codigo === 'ambiguo' ? 'municipio_ambiguo' : 'municipio_nao_encontrado'));
    }
  }

  // RN-CAD-02: IE pela UF; "ISENTO" = 2, vazia = 9, válida = 1
  const ieBruta = so(pre.inscricao_estadual);
  let ie: string | null = null;
  let indIeDest: IndIeDest = '9';
  if (ieBruta !== '') {
    const v = ufOk ? validarIe(uf, ieBruta) : null; // sem UF válida a IE não tem regra; a UF já foi recusada
    if (v && !v.ok) erros.push(erro('inscricao_estadual', 'ie_invalida'));
    else {
      ie = v ? v.ie : ieBruta.toUpperCase();
      indIeDest = ie === 'ISENTO' ? '2' : '1';
      if (ufOk && !validarIndIeDest({ ind_ie_dest: indIeDest, ie, uf }).ok) erros.push(erro('inscricao_estadual', 'ie_invalida'));
    }
  }

  // Endereço da NF-e
  const cep = so(pre.cep).replace(/\D/g, '');
  if (!Cep.safeParse(cep).success) erros.push(erro('cep', 'cep_invalido'));
  const texto = (campo: 'logradouro' | 'bairro') => {
    const v = so(pre[campo]);
    if (v === '') erros.push(erro(campo, 'campo_obrigatorio'));
    else if (!Endereco.shape[campo].safeParse(v).success) erros.push(erro(campo, 'tamanho_maximo'));
    return v;
  };
  const logradouro = texto('logradouro');
  const bairro = texto('bairro');
  // número e complemento acima do limite recusam (nunca são cortados em silêncio); sem número vira S/N
  const numero = so(pre.numero) || 'S/N';
  if (!Endereco.shape.numero.safeParse(numero).success) erros.push(erro('numero', 'tamanho_maximo'));
  const complemento = so(pre.complemento) || null;
  if (complemento !== null && !Endereco.shape.complemento.safeParse(complemento).success) erros.push(erro('complemento', 'tamanho_maximo'));

  const razao = so(pre.razao_social);
  if (razao === '') erros.push(erro('razao_social', 'campo_obrigatorio'));
  else if (!ClienteDados.shape.razao_social.safeParse(razao).success) erros.push(erro('razao_social', 'tamanho_maximo'));
  const fantasia = so(pre.nome_fantasia);
  if (!ClienteDados.shape.nome_fantasia.safeParse(fantasia).success) erros.push(erro('nome_fantasia', 'tamanho_maximo'));

  if (ctx.filialId === null) erros.push(erro('filial_external_id', 'filial_nao_encontrada'));

  if (erros.length > 0 || tipo === null || ibge === null || ctx.filialId === null) return { ok: false, erros };
  const email = ClienteDados.shape.email_nfe.safeParse(so(pre.email));
  // T-0059: telefone/latitude/longitude aguardam decisão do Alexandre
  return {
    ok: true,
    dados: {
      tipo_pessoa: tipo, documento, ie, ind_ie_dest: indIeDest, razao_social: razao, nome_fantasia: fantasia || null,
      email_nfe: email.success ? email.data : null,
      limite_credito_centavos: 0, condicao_pagamento_id: null, tabela_preco_id: null, filial_id: ctx.filialId, vendedor_id: null,
      enderecos: [{ tipo: 'principal', logradouro, numero, complemento, bairro, municipio_ibge: ibge, uf, cep, pais_bacen: '1058' }],
      external_id: null,
    },
  };
}

/** Junção das mensagens, sem repetir, até o teto do `motivo` do retorno (300). */
export function motivoDaRecusaFdv(erros: readonly ErroCampoClienteFdv[]): string {
  return [...new Set(erros.map((e) => e.mensagem))].join(' ').slice(0, MAX_MOTIVO_RETORNO_CLIENTE_FDV).trim();
}
