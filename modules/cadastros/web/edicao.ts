/**
 * Base das telas de edição do BKO (T-0088): campo do formulário descrito como dado, valores em texto digitado e o
 * corpo que vai à API (criação = POST com `Idempotency-Key`; alteração = PATCH só com o que mudou). As regras vêm do
 * `domain` e dos schemas de `contracts`; a API sempre revalida (RN-CORE-02) e o shell só desenha.
 */
import { pode, type Acao, type Perfil } from '@macuxierp/platform-sdk';
import { interpretarCentavos } from '@macuxierp/platform-sdk/formatar';

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

export const reaisDeCentavos = (c: number | null | undefined): string =>
  c === null || c === undefined ? '' : `${Math.trunc(c / 100)},${String(c % 100).padStart(2, '0')}`;

/** Diferença para o PATCH: só as chaves cujo valor mudou em relação ao registro aberto (JSON igual = igual). */
export function soOQueMudou(novo: Corpo, original: Readonly<Record<string, unknown>>): Corpo {
  const mudou: Corpo = {};
  for (const [k, v] of Object.entries(novo)) if (JSON.stringify(v ?? null) !== JSON.stringify(original[k] ?? null)) mudou[k] = v;
  return mudou;
}

/** Erro de campo de um 422 da API (`campo` e `mensagem`) para o mesmo mapa da validação local. */
export function errosDaApi(violacoes: readonly { campo: string; mensagem: string }[]): Erros {
  const e: Erros = {};
  for (const v of violacoes) {
    const campo = v.campo.replace(/^enderecos\.0\./, 'end_');
    e[campo] ??= v.mensagem;
  }
  return e;
}

/** Idempotency-Key da tentativa: gerada ao abrir o formulário e reusada no reenvio (RN-CORE-05). */
export const novaChaveDeEdicao = (): string => globalThis.crypto.randomUUID();

/** Erros vazios = pode enviar. */
export const semErros = (e: Erros): boolean => Object.keys(e).length === 0;

export type { Perfil };
