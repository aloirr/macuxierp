import { describe, expect, it } from 'vitest';
import { estadoDaTroca } from './troca-senha';

describe('estadoDaTroca (T-0052)', () => {
  it('abre o envio com atual, regras e confirmação conferindo', () => {
    expect(estadoDaTroca('Antiga#1x', 'Nova-senha-1', 'Nova-senha-1').podeEnviar).toBe(true);
  });
  it('senha nova igual à atual bloqueia o envio', () => {
    const e = estadoDaTroca('Nova-senha-1', 'Nova-senha-1', 'Nova-senha-1');
    expect(e.igualAtual).toBe(true);
    expect(e.podeEnviar).toBe(false);
  });
  it('nova vazia não conta como igual à atual vazia', () => {
    expect(estadoDaTroca('', '', '').igualAtual).toBe(false);
  });
  it('confirmação diferente ou regra faltando bloqueia', () => {
    expect(estadoDaTroca('a', 'Nova-senha-1', 'x').podeEnviar).toBe(false);
    expect(estadoDaTroca('a', 'curta', 'curta').podeEnviar).toBe(false);
  });
});
