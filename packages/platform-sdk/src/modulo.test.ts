import { describe, expect, it } from 'vitest';
import { defineModule, ManifestoInvalido } from './modulo';

const base = { versao: '0.1.0', descricao: 'x', perfis: ['administrador'], publica: [], consome: [] } as const;

describe('defineModule', () => {
  it('aceita manifesto válido', () => {
    const m = defineModule({ ...base, id: 'pedido', depende: ['core'], publica: ['pedido.pedido.aprovado@1'] });
    expect(Object.isFrozen(m)).toBe(true);
  });

  it('exige dependência do core', () => {
    expect(() => defineModule({ ...base, id: 'pedido', depende: [] })).toThrow(ManifestoInvalido);
  });

  it('recusa evento fora do padrão ou de outro módulo', () => {
    expect(() => defineModule({ ...base, id: 'pedido', depende: ['core'], publica: ['pedido.aprovado'] })).toThrow(
      /fora do padrão/,
    );
    expect(() =>
      defineModule({ ...base, id: 'pedido', depende: ['core'], publica: ['fiscal.regra.alterada@1'] }),
    ).toThrow(/próprio módulo/);
  });
});
