/**
 * CNPJ e CPF com dígito verificador (RN-CAD-01). Fonte única para core e cadastros (desenho T-0002, seção 4 e D4):
 * nenhum módulo copia esta regra.
 *
 * CNPJ alfanumérico (Receita Federal, a partir de jul/2026): 12 posições de [0-9A-Z] + 2 dígitos verificadores
 * numéricos. Cada caractere vale o código ASCII menos 48 ('0'..'9' = 0..9, 'A' = 17 ... 'Z' = 42); o DV é o módulo 11
 * com pesos 2..9 da direita para a esquerda, como no CNPJ numérico (que continua válido pela mesma conta).
 */
import { z } from 'zod';

/** CNPJ sem máscara (numérico ou alfanumérico), igual ao domínio plataforma.cnpj. */
export const PADRAO_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;
/** Sigla da UF: 2 letras maiúsculas. */
export const PADRAO_UF = /^[A-Z]{2}$/;
/** As 27 UFs (26 estados e o DF), em maiúsculas. Prefixo do código da empresa (RN-CORE-11) e domínio de `uf`. */
export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

/** Tira pontuação (. / - e espaço) e passa para maiúsculas. Não valida. */
export function normalizarDocumento(valor: string): string {
  return valor.replace(/[.\-/\s]/g, '').toUpperCase();
}

const todosIguais = (s: string) => /^(.)\1*$/.test(s);

function dvModulo11(valores: readonly number[]): number {
  let peso = 2;
  let soma = 0;
  for (let i = valores.length - 1; i >= 0; i--) {
    soma += (valores[i] ?? 0) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** RN-CAD-01: CNPJ (numérico ou alfanumérico) válido pelo dígito verificador. Aceita com ou sem máscara. */
export function cnpjValido(valor: string): boolean {
  const c = normalizarDocumento(valor);
  if (!PADRAO_CNPJ.test(c) || todosIguais(c)) return false;
  const valores = [...c.slice(0, 12)].map((ch) => ch.charCodeAt(0) - 48);
  const dv1 = dvModulo11(valores);
  const dv2 = dvModulo11([...valores, dv1]);
  return c.endsWith(`${dv1}${dv2}`);
}

/** RN-CAD-01: CPF válido pelo dígito verificador. Aceita com ou sem máscara. */
export function cpfValido(valor: string): boolean {
  const c = normalizarDocumento(valor);
  if (!/^\d{11}$/.test(c) || todosIguais(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/** Raiz do CNPJ (8 primeiras posições): a regra do A1 da mesma raiz do emitente (D4). */
export function cnpjRaiz(cnpj: string): string {
  return normalizarDocumento(cnpj).slice(0, 8);
}

/** Zod do CNPJ: normaliza (sem máscara, maiúsculas) e valida o DV (RN-CAD-01). */
export const Cnpj = z
  .string()
  .transform(normalizarDocumento)
  .refine(cnpjValido, { message: 'RN-CAD-01: CNPJ inválido' });

/** Zod do CPF: normaliza (só dígitos) e valida o DV (RN-CAD-01). */
export const Cpf = z
  .string()
  .transform(normalizarDocumento)
  .refine(cpfValido, { message: 'RN-CAD-01: CPF inválido' });

/**
 * RN-CAD-02: dígito verificador da Inscrição Estadual pela regra da UF. Fonte única do DV da IE (RN-CAD-02). O
 * cadastros passa a usar por recado (RD-0253); UF nova entra aqui.
 * Porte da lógica do sped-common (`NFePHP\Common\Validator\IE`, opção MIT; atribuição: Copyright (c) NFePHP,
 * https://github.com/nfephp-org/sped-common), por enquanto só de AM, PA e SP:
 * - AM: 9 dígitos; pesos 9..2 nos 8 primeiros; soma < 11 dá DV 11 − soma; senão resto 0 ou 1 dá 0 e o resto, 11 − resto.
 * - PA: 9 dígitos, começa com 15; pesos 9..2 nos 8 primeiros; resto 0 ou 1 dá 0, senão 11 − resto.
 * - SP: 12 dígitos; 1º DV (9ª posição) com pesos 1,3,4,5,6,7,8,10 nos 8 primeiros e o 2º DV (12ª posição) com pesos
 *   3,2,10..2 nos 11 primeiros; cada DV é a soma % 11 % 10.
 * Devolve `null` para UF ainda sem regra no ERP (a conferir com o porte das demais UFs) e `true` para "ISENTO"
 * (quem pode ser isento é decisão do cadastro, RN-CAD-02).
 */
export function ieComDvValido(uf: string, ie: string): boolean | null {
  const v = normalizarDocumento(ie);
  if (v === 'ISENTO') return true;
  const regra = REGRAS_IE[uf.toUpperCase()];
  if (!regra) return null;
  return /^\d+$/.test(v) && regra(v);
}

function somaPesosDescendo(digitos: string): number {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) soma += Number(digitos[i]) * (digitos.length + 1 - i);
  return soma;
}

/** DV de SP: soma dos dígitos pelos pesos, % 11 % 10. */
function dvSp(digitos: string, pesos: readonly number[]): number {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) soma += Number(digitos[i]) * (pesos[i] ?? 0);
  return (soma % 11) % 10;
}

const REGRAS_IE: Readonly<Record<string, (ie: string) => boolean>> = Object.freeze({
  AM: (ie) => {
    if (ie.length !== 9) return false;
    const soma = somaPesosDescendo(ie.slice(0, 8));
    const resto = soma % 11;
    const dv = soma < 11 ? 11 - soma : resto < 2 ? 0 : 11 - resto;
    return dv === Number(ie[8]);
  },
  PA: (ie) => {
    if (ie.length !== 9 || !ie.startsWith('15')) return false;
    const resto = somaPesosDescendo(ie.slice(0, 8)) % 11;
    return (resto < 2 ? 0 : 11 - resto) === Number(ie[8]);
  },
  SP: (ie) =>
    ie.length === 12 &&
    dvSp(ie.slice(0, 8), [1, 3, 4, 5, 6, 7, 8, 10]) === Number(ie[8]) &&
    dvSp(ie.slice(0, 11), [3, 2, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(ie[11]),
});
