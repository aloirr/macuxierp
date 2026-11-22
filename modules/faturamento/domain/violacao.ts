import { violacao, type Violacao } from '@macuxierp/platform-sdk';

/** `Violacao` e `violacao` vêm do platform-sdk (RD-0235); aqui só o erro do domínio. */
export { violacao, type Violacao };

/** Erro lançado pelo domain quando gerar o resultado seria produzir algo que a SEFAZ rejeitaria. Carrega todas as violações. */
export class ErroViolacao extends Error {
  constructor(readonly violacoes: Violacao[]) {
    super(violacoes.map((v) => `${v.rn} ${v.campo}: ${v.mensagem}`).join('; '));
    this.name = 'ErroViolacao';
  }
}
