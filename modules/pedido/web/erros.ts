/**
 * Erros do `safeParse` dos contratos (Zod) em português, por campo da tela. Os limites vivem só em `contracts`:
 * a tela lê o `maximum` da própria issue e não repete número nenhum.
 */
import type { ZodIssue } from 'zod';

/** Chave do campo da tela a partir do `path` da issue (`itens.0.quantidade`); `renomear` troca o nome do contrato pelo do formulário. */
export function chaveDoCampo(path: readonly (string | number)[], renomear: Readonly<Record<string, string>> = {}): string {
  return path.map((p) => (typeof p === 'string' ? (renomear[p] ?? p) : String(p))).join('.');
}

/** Mensagem em português (problema + ação, com ponto final) para a issue: o limite máximo vem do Zod; nos demais casos quem chama sobrepõe por campo (`especificas`, pela chave final do path). */
export function mensagemDaIssue(i: ZodIssue, especificas: Readonly<Record<string, string>> = {}): string {
  const ultimo = String(i.path[i.path.length - 1] ?? '');
  if (i.code === 'too_big') return i.type === 'array' ? `Itens demais. Inclua no máximo ${String(i.maximum)} itens.` : `Texto longo demais. Use no máximo ${String(i.maximum)} caracteres.`;
  const propria = especificas[ultimo];
  if (propria) return propria;
  if (i.code === 'too_small') return i.type === 'array' ? 'Nenhum item. Inclua ao menos um item.' : 'Campo obrigatório. Preencha o campo.';
  if (i.code === 'invalid_enum_value') return 'Opção inválida. Escolha uma das opções.';
  return 'Valor inválido. Confira o campo.';
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

export interface FalhaDaEdicao {
  mensagem: string;
  /** A tela oferece "Recarregar pedido": o que ela tem na mão está velho. */
  recarregar: boolean;
}

export const MENSAGEM_CONFLITO_EDICAO = 'Outra pessoa alterou este pedido. Recarregue para ver a versão atual e refaça a edição.';
export const MENSAGEM_FORA_DE_ANALISE = 'O pedido saiu de análise e não pode mais ser editado. Volte ao pedido.';

/**
 * Falha do `PUT /pedidos/:id` em texto para a tela (RF-PED-02). O `If-Match` velho vem como 412 (precondição) ou 409
 * `CONFLITO` (a API do pedido responde 409): os dois pedem recarregar. Fora disso a mensagem é a da API.
 */
export function falhaDaEdicao(e: { status: number; codigo: string; message: string }): FalhaDaEdicao {
  if (e.status === 412 || e.status === 409 || e.codigo === 'CONFLITO') return { mensagem: MENSAGEM_CONFLITO_EDICAO, recarregar: true };
  if (e.status === 422 && e.codigo === 'RN-PED-02') return { mensagem: MENSAGEM_FORA_DE_ANALISE, recarregar: true };
  return { mensagem: e.message, recarregar: false };
}
