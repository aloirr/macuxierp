/** Violação de regra de negócio: `rn` vira o `codigo` do 422 na API (ex.: `RN-CAD-01`). */
export interface Violacao {
  rn: string;
  campo: string;
  mensagem: string;
}

export const violacao = (rn: string, campo: string, mensagem: string): Violacao => ({ rn, campo, mensagem });

/** Erro lançado pelo domain quando gerar o resultado seria produzir algo que a SEFAZ rejeitaria. Carrega todas as violações. */
export class ErroViolacao extends Error {
  constructor(readonly violacoes: Violacao[]) {
    super(violacoes.map((v) => `${v.rn} ${v.campo}: ${v.mensagem}`).join('; '));
    this.name = 'ErroViolacao';
  }
}
