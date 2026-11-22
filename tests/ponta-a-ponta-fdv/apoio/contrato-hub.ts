/**
 * T-0012: o que o arnês sabe do contrato do Hub `/integracao/v1` do Macuxi FDV (só consulta: guia
 * `modules/integracao/docs/guia-api-hub.md` do aloirr/macuxifdv, commit b75ab88, lido pela busca de código; o ERP nunca lê
 * tabela do FDV). Serve ao dublê (fidelidade) e ao emissor mínimo do arnês. Não é contrato do ERP (o do ERP é o C-6 do
 * `integracao-fdv`). Fica separado de propósito: é o lado do FDV, usado pelo dublê e pelo emissor mínimo como oráculo
 * (RD-0221); não importar do C-6, do domain nem do SDK.
 */

/** `ORDEM_CARGA_ENTIDADES` do Hub (RN-INT-04 do FDV): a única ordem de carga, filial primeiro. */
export const ORDEM_CARGA_HUB = [
  'filial',
  'vendedor',
  'catalogo_no',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'tabela_escalonada',
  'estoque',
  'cliente',
  'cliente_endereco',
  'transportadora',
  'rota',
  'titulo',
  'nota',
] as const;
export type EntidadeHub = (typeof ORDEM_CARGA_HUB)[number];

/** O que o ERP alimenta na F2 (doc 06 e T-0009 seção 2); a `nota` é da F4. A ordem sai da lista do Hub, nunca de outra. */
const ALIMENTADAS_PELO_ERP = new Set<EntidadeHub>([
  'filial',
  'vendedor',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
  'cliente_endereco',
  'titulo',
]);
export const ORDEM_DO_ERP: readonly EntidadeHub[] = ORDEM_CARGA_HUB.filter((e) =>
  ALIMENTADAS_PELO_ERP.has(e),
);

export const LIMITE_REGISTROS_LOTE = 5000;
/** Corpo de `POST /lotes` acima disto = 413 `corpo_grande`. */
export const LIMITE_CORPO_BYTES = 8 * 1024 * 1024;
/** Nível de compatibilidade de Conector que o ERP declara (P-2, opção A); a versão real vai no `User-Agent`. */
export const VERSAO_CONECTOR = '1.4.0';
export const VERSAO_CONTRATO = 'v1';

/** `mxc_` + 43 caracteres base64url. */
export const FORMATO_CHAVE = /^mxc_[A-Za-z0-9_-]{43}$/;
/** `X-Macuxi-Conector-Id`: letras, números, `.`, `-`, `_`; até 100. */
export const FORMATO_CONECTOR_ID = /^[A-Za-z0-9._-]{1,100}$/;
/** `Idempotency-Key`: 16 a 128 de letras, números, ponto, hífen, sublinhado e dois-pontos. */
export const FORMATO_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{16,128}$/;
/** `alterado_em` e demais carimbos do contrato: ISO 8601 em UTC, com `Z`. */
export const DATA_HORA_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Divide em fatias de até `limite` registros, na ordem recebida (lotes do emissor mínimo e do modo seguro). */
export function emFatias<T>(lista: readonly T[], limite: number): T[][] {
  if (!Number.isInteger(limite) || limite < 1) throw new RangeError('limite de lote inválido.');
  const fatias: T[][] = [];
  for (let i = 0; i < lista.length; i += limite) fatias.push(lista.slice(i, i + limite));
  return fatias;
}

export type ModoLote = 'completo' | 'delta';
export type EstadoLote = 'recebido' | 'processando' | 'concluido' | 'concluido_com_erros' | 'falhou';
export const ESTADOS_FINAIS: readonly EstadoLote[] = ['concluido', 'concluido_com_erros', 'falhou'];

export interface CursorHub {
  alterado_em: string;
  external_id: string;
}
export interface SessaoLote {
  id: string;
  parte: number;
  ultimo: boolean;
}
export interface RegistroHub {
  external_id: string;
  alterado_em: string;
  ativo?: boolean;
  [campo: string]: unknown;
}
export interface LinhaInvalidaEnvelope {
  external_id: string | null;
  codigo: string;
  campo: string | null;
  mensagem?: string;
}
export interface EnvelopeLote {
  versao_contrato: string;
  entidade: string;
  modo: ModoLote;
  enviado_em?: string | null;
  cursor?: CursorHub | null;
  sessao?: SessaoLote | null;
  conector_id?: string | null;
  versao_conector?: string | null;
  registros: RegistroHub[];
  linhas_invalidas?: LinhaInvalidaEnvelope[] | null;
  linhas_invalidas_omitidas?: number | null;
}

/** 202 de `POST /lotes`. */
export interface LoteAceito {
  lote_id: string;
  status: EstadoLote;
  entidade: string;
  modo: ModoLote;
  recebidos: number;
  repetido: boolean;
  consulta: string;
}

export interface Contagens {
  recebidas: number;
  duplicadas_no_lote: number;
  com_erro: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  obsoletas: number;
}

/** Erro por linha (RN-INT-03 do FDV): mensagem legível sem valor de campo. */
export interface ErroLinha {
  indice: number;
  external_id: string | null;
  codigo: string;
  campo: string | null;
  mensagem: string;
  reprocessavel: boolean;
  origem: 'hub' | 'conector';
}

export interface InativacaoLote {
  situacao: 'nada_a_inativar' | 'aplicada' | 'aguardando_confirmacao';
  quantidade: number;
}

/** `GET /lotes/{id}`. */
export interface LoteResultado {
  lote_id: string;
  entidade: string;
  modo: ModoLote;
  status: EstadoLote;
  contagens: Contagens;
  erros: ErroLinha[];
  erros_total: number;
  erros_omitidos: number;
  inativacao?: InativacaoLote | null;
  recebido_em: string;
  concluido_em: string | null;
}

/** Erro padrão do Hub (corpo de 4xx/5xx). */
export interface ErroHub {
  codigo: string;
  mensagem: string;
  requisicao_id: string;
  erros?: { codigo: string; campo: string | null; mensagem: string }[];
}
