/** Estado e validação do formulário genérico (parte pura). A API sempre revalida (RN-CORE-02). */
import type { ErrosFormulario } from './tipos';

export function temErros(e: ErrosFormulario): boolean {
  return Object.keys(e).length > 0;
}

/** Mensagem do primeiro erro de um mapa campo -> texto (o diálogo mostra uma por vez). */
export function primeiroErro(e: ErrosFormulario): string {
  return Object.values(e)[0] ?? '';
}
