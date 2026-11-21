/** Violação de regra de negócio: `rn` vira o `codigo` do 422 na API (ex.: `RN-CAD-01`). */
export interface Violacao {
  rn: string;
  campo: string;
  mensagem: string;
}

export const violacao = (rn: string, campo: string, mensagem: string): Violacao => ({ rn, campo, mensagem });
