/**
 * CNPJ e CPF com dígito verificador (RN-CAD-01). Fonte única para core e cadastros (desenho T-0002, seção 4 e D4):
 * nenhum módulo copia esta regra.
 *
 * CNPJ alfanumérico (Receita Federal, a partir de jul/2026): 12 posições de [0-9A-Z] + 2 dígitos verificadores
 * numéricos. Cada caractere vale o código ASCII menos 48 ('0'..'9' = 0..9, 'A' = 17 ... 'Z' = 42); o DV é o módulo 11
 * com pesos 2..9 da direita para a esquerda, como no CNPJ numérico (que continua válido pela mesma conta).
 */
import { z } from 'zod';

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
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || todosIguais(c)) return false;
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
