import { describe, expect, it } from 'vitest';
import { ACAO_INDISPONIVEL, ERRO_CAMPOS } from './textos';

describe('textos de retorno no formato do README do resultado (36 A)', () => {
  it('erro no molde "Não foi possível <ação>. <o que fazer>."', () => {
    for (const t of [ERRO_CAMPOS, ACAO_INDISPONIVEL]) expect(t).toMatch(/^Não foi possível [^.]+\. [^.]+\.$/);
  });
});
