/** Estado e validação do formulário genérico (parte pura). A API sempre revalida (RN-CORE-02). */
import type { CampoFormulario, ErrosFormulario, ItemFormulario, ValoresFormulario } from './tipos';

/** Idempotency-Key: gerada uma vez por formulário aberto e reaproveitada em reenvio (escrita idempotente). */
export function novaChaveIdempotencia(): string {
  return globalThis.crypto.randomUUID();
}

export const ITEM_VAZIO: ItemFormulario = { produto_id: '', quantidade: '', preco: '', desconto: '' };

/** "12,50" ou "12.50" -> 1250 (centavos); inválido -> null. */
export function paraCentavos(texto: string): number | null {
  const t = texto.trim().replace(/\./g, (m, i, s: string) => (s.includes(',') ? '' : m)).replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Quantidade com até 3 casas (milésimos); inválido ou zero -> null. */
export function paraMilesimos(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 1000);
  return n > 0 ? n : null;
}

/** Obrigatórios dos campos do descritor; cada módulo soma as regras dele na `validar`. */
export function obrigatorios(campos: readonly CampoFormulario[], valores: ValoresFormulario): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const c of campos) if (c.obrigatorio && !(valores[c.nome] ?? '').trim()) erros[c.nome] = `Informe: ${c.rotulo.toLowerCase()}.`;
  return erros;
}

export function temErros(e: ErrosFormulario): boolean {
  return Object.keys(e).length > 0;
}
