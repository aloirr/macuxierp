/**
 * Erros do `safeParse` dos contratos (Zod) em português, por campo da tela. Os limites vivem só em `contracts`:
 * a tela lê o `maximum` da própria issue e não repete número nenhum.
 */
import type { ZodIssue } from 'zod';

/** Chave do campo da tela a partir do `path` da issue (`itens.0.quantidade`); `renomear` troca o nome do contrato pelo do formulário. */
export function chaveDoCampo(path: readonly (string | number)[], renomear: Readonly<Record<string, string>> = {}): string {
  return path.map((p) => (typeof p === 'string' ? (renomear[p] ?? p) : String(p))).join('.');
}

/** Mensagem em português para a issue: o limite máximo vem do Zod; nos demais casos quem chama sobrepõe por campo (`especificas`, pela chave final do path). */
export function mensagemDaIssue(i: ZodIssue, especificas: Readonly<Record<string, string>> = {}): string {
  const ultimo = String(i.path[i.path.length - 1] ?? '');
  if (i.code === 'too_big') return `No máximo ${String(i.maximum)} ${i.type === 'array' ? 'itens' : 'caracteres'}`;
  const propria = especificas[ultimo];
  if (propria) return propria;
  if (i.code === 'too_small') return i.type === 'array' ? 'Inclua ao menos um item' : 'Preencha o campo';
  if (i.code === 'invalid_enum_value') return 'Escolha uma das opções';
  return 'Valor inválido';
}

/** Primeira mensagem de cada campo (a ordem do Zod é a da tela). */
export function errosPorCampo(issues: readonly ZodIssue[], renomear: Readonly<Record<string, string>> = {}, especificas: Readonly<Record<string, string>> = {}): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const i of issues) {
    const chave = chaveDoCampo(i.path, renomear) || 'formulario';
    erros[chave] ??= mensagemDaIssue(i, especificas);
  }
  return erros;
}
