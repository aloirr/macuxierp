/**
 * Base das telas de edição do BKO (T-0088): campo do formulário descrito como dado, valores em texto digitado e o
 * corpo que vai à API (criação = POST com `Idempotency-Key`; alteração = PATCH só com o que mudou). As regras vêm do
 * `domain` e dos schemas de `contracts`; a API sempre revalida (RN-CORE-02) e o shell só desenha.
 */
import { pode, type Acao, type Perfil } from '@macuxierp/platform-sdk';
import { interpretarCentavos } from '@macuxierp/platform-sdk/formatar';
import { Cep, Ibge, Uf } from '../contracts';

export type TipoCampoEdicao = 'texto' | 'selecao' | 'dinheiro' | 'cadastro' | 'booleano';

export interface CampoEdicao {
  nome: string;
  rotulo: string;
  tipo: TipoCampoEdicao;
  obrigatorio?: boolean;
  /** `cadastro`: lista de onde ler as opções (`/v1/cadastros/filiais`). */
  fonte?: string;
  opcoes?: readonly { valor: string; rotulo: string }[];
  ajuda?: string;
  /** Só aparece (e só vai no corpo) para quem tem a ação; a API devolve 403 sem ela. */
  exige?: Acao;
  /** Só na criação (o endereço principal do cliente; depois, a tela de endereços cuida deles). */
  soCriacao?: boolean;
  /**
   * Condição para o campo aparecer, a partir dos valores digitados (ex.: o regime de PIS/COFINS só com CRT 3). O shell chama a
   * cada digitação e esconde o campo quando devolve `false`; campo escondido não pede preenchimento e a tela o envia vazio.
   */
  mostrarSe?: (v: Valores) => boolean;
}

export type Modo = 'criar' | 'editar';
export type Valores = Readonly<Record<string, string>>;
export type Erros = Record<string, string>;
export type Corpo = Record<string, unknown>;

/** Campos que o perfil e o modo enxergam (esconde, não protege: a API checa de novo). */
export function camposVisiveis(campos: readonly CampoEdicao[], perfil: Perfil, modo: Modo): CampoEdicao[] {
  return campos.filter((c) => (!c.exige || pode(perfil, c.exige)) && (modo === 'criar' || !c.soCriacao));
}

export const vazioParaNulo = (t: string | undefined): string | null => {
  const s = (t ?? '').trim();
  return s === '' ? null : s;
};
export const soDigitos = (t: string | undefined): string => (t ?? '').replace(/\D/g, '');

/** Reais digitados ("1.234,56") em centavos; `null` quando não é valor em reais. Vazio devolve `undefined`. */
export function centavosDoTexto(t: string | undefined): number | null | undefined {
  const s = (t ?? '').trim();
  return s === '' ? undefined : interpretarCentavos(s);
}

/** JSON com as chaves em ordem (a API pode devolver o objeto aninhado, como o endereço, em outra ordem). */
const estavel = (v: unknown): string => JSON.stringify(v ?? null, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Diferença para o PATCH: só as chaves cujo valor mudou em relação ao registro aberto (JSON igual = igual). */
export function soOQueMudou(novo: Corpo, original: Readonly<Record<string, unknown>>): Corpo {
  const mudou: Corpo = {};
  for (const [k, v] of Object.entries(novo)) if (estavel(v) !== estavel(original[k])) mudou[k] = v;
  return mudou;
}

/** Corpo do PATCH: só o que mudou em relação ao registro aberto, conferido pelo schema; sem mudança ou contrato recusando, `null`. */
export function corpoDoPatch(novo: Corpo, original: Readonly<Record<string, unknown>>, schema: { safeParse(x: unknown): { success: boolean; data?: unknown } }): Corpo | null {
  const mudou = soOQueMudou(novo, original);
  if (Object.keys(mudou).length === 0) return null;
  const r = schema.safeParse(mudou);
  if (!r.success) return null;
  const dados = r.data as Record<string, unknown>;
  return Object.fromEntries(Object.keys(mudou).map((k) => [k, dados[k]]));
}

/** Campos obrigatórios em branco (ignora os que a tela não mostra), com a mensagem única da tela. */
export function faltandoObrigatorios(campos: readonly CampoEdicao[], v: Valores): Erros {
  const e: Erros = {};
  for (const c of campos) if (c.obrigatorio && (!c.mostrarSe || c.mostrarSe(v)) && (v[c.nome] ?? '').trim() === '') e[c.nome] = 'Preencha este campo';
  return e;
}

/** Opções de seleção a partir de um mapa valor para rótulo. */
export const opcoes = (r: Readonly<Record<string, string>>) => Object.entries(r).map(([valor, rotulo]) => ({ valor, rotulo }));

export const simNao = (v: unknown): string => (v ? 'Sim' : 'Não');
export const situacao = (inativo: unknown): string => (inativo ? 'Inativo' : 'Ativo');

/** Endereço do formulário (cliente na criação e filial): campos `end_*`. */
export const CAMPOS_ENDERECO: readonly CampoEdicao[] = [
  { nome: 'end_cep', rotulo: 'CEP', tipo: 'texto', obrigatorio: true },
  { nome: 'end_logradouro', rotulo: 'Logradouro', tipo: 'texto', obrigatorio: true },
  { nome: 'end_numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true },
  { nome: 'end_complemento', rotulo: 'Complemento', tipo: 'texto' },
  { nome: 'end_bairro', rotulo: 'Bairro', tipo: 'texto', obrigatorio: true },
  { nome: 'end_municipio_ibge', rotulo: 'Município (código IBGE)', tipo: 'texto', obrigatorio: true },
  { nome: 'end_uf', rotulo: 'UF', tipo: 'texto', obrigatorio: true },
];

/** Formato do CEP, do código IBGE e da UF; só preenche `e` onde o campo ainda não tem erro. */
export function validarEnderecoTela(v: Valores, e: Erros): void {
  if (!e.end_cep && !Cep.safeParse(soDigitos(v.end_cep)).success) e.end_cep = 'O CEP tem 8 números';
  if (!e.end_municipio_ibge && !Ibge.safeParse((v.end_municipio_ibge ?? '').trim()).success) e.end_municipio_ibge = 'O código IBGE tem 7 números';
  if (!e.end_uf && !Uf.safeParse((v.end_uf ?? '').trim().toUpperCase()).success) e.end_uf = 'Informe a UF com 2 letras';
}

/** Endereço normalizado para o corpo (CEP em números, UF maiúscula, Brasil). */
export const enderecoDoFormulario = (v: Valores) => ({
  logradouro: (v.end_logradouro ?? '').trim(), numero: (v.end_numero ?? '').trim(), complemento: vazioParaNulo(v.end_complemento), bairro: (v.end_bairro ?? '').trim(),
  municipio_ibge: (v.end_municipio_ibge ?? '').trim(), uf: (v.end_uf ?? '').trim().toUpperCase(), cep: soDigitos(v.end_cep), pais_bacen: '1058',
});

/** Erro de campo de um 422 da API (`campo` e `mensagem`) para o mesmo mapa da validação local. */
export function errosDaApi(violacoes: readonly { campo: string; mensagem: string }[]): Erros {
  const e: Erros = {};
  for (const v of violacoes) {
    const campo = v.campo.replace(/^(?:enderecos\.0|endereco)\./, 'end_');
    e[campo] ??= v.mensagem;
  }
  return e;
}

/** Idempotency-Key da tentativa: gerada ao abrir o formulário e reusada no reenvio (RN-CORE-05). */
export const novaChaveDeEdicao = (): string => globalThis.crypto.randomUUID();
