import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';

describe('manifesto do módulo pedido', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('pedido');
    expect(manifest.publica.every((e) => e.startsWith('pedido.'))).toBe(true);
  });

  it('publica os seis eventos pedido.pedido.*@1, inclusive faturado@1 e faturado_cliente@1 (modo ponte)', () => {
    expect([...manifest.publica].sort()).toEqual(
      ['aprovado', 'cancelado', 'faturado', 'faturado_cliente', 'recebido', 'recusado'].map((f) => `pedido.pedido.${f}@1`),
    );
  });
});
