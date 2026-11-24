import { describe, expect, it } from 'vitest';
import { CHAVE_CODIGO_EMPRESA, gravarCodigoDoLogin, lerCodigoSalvo } from './codigo-salvo';

function armazem(inicial: Record<string, string> = {}) {
  const dados = { ...inicial };
  return { dados, getItem: (k: string) => dados[k] ?? null, setItem: (k: string, v: string) => { dados[k] = v; } };
}

describe('código da empresa lembrado (única memória do login)', () => {
  it('grava só o código normalizado, numa chave constante', () => {
    const a = armazem();
    gravarCodigoDoLogin('bko', ' am2808 ', a);
    expect(a.dados).toEqual({ [CHAVE_CODIGO_EMPRESA]: 'AM2808' });
    expect(lerCodigoSalvo(a)).toBe('AM2808');
  });
  it('valor inválido não grava e o lido inválido é ignorado', () => {
    const a = armazem({ [CHAVE_CODIGO_EMPRESA]: 'lixo qualquer' });
    expect(lerCodigoSalvo(a)).toBeUndefined();
    gravarCodigoDoLogin('bko', 'x@y.co', a);
    expect(a.dados[CHAVE_CODIGO_EMPRESA]).toBe('lixo qualquer');
  });
  it('sem armazenamento ou com erro dele, não quebra', () => {
    expect(lerCodigoSalvo(undefined)).toBeUndefined();
    expect(() => gravarCodigoDoLogin('bko', 'AM2808', undefined)).not.toThrow();
    expect(() => gravarCodigoDoLogin('bko', 'AM2808', { getItem: () => null, setItem: () => { throw new Error('cota'); } })).not.toThrow();
  });

  describe('código gravado só com destino bko', () => {
    it('destino bko grava o código', () => {
      const a = armazem();
      gravarCodigoDoLogin('bko', ' am2808 ', a);
      expect(a.dados).toEqual({ [CHAVE_CODIGO_EMPRESA]: 'AM2808' });
    });
    it('destino config não grava nada', () => {
      const a = armazem();
      gravarCodigoDoLogin('config', 'QUALQUER', a);
      expect(a.dados).toEqual({});
    });
    it('destino config não altera o código já salvo', () => {
      const a = armazem({ [CHAVE_CODIGO_EMPRESA]: 'AM2808' });
      gravarCodigoDoLogin('config', 'OUTRO1', a);
      expect(a.dados).toEqual({ [CHAVE_CODIGO_EMPRESA]: 'AM2808' });
    });
  });
});
