import { describe, expect, it } from 'vitest';
import { StatusPedido } from '../contracts';
import { podeEditarPedido } from './edicao';

describe('edição do pedido (RF-PED-02)', () => {
  it('RN-PED-02: só o pedido bko em análise se edita; outro status ou o pedido do FDV, não', () => {
    for (const s of StatusPedido.options) expect(podeEditarPedido(s, 'bko'), s).toBe(s === 'em_analise');
    for (const s of StatusPedido.options) expect(podeEditarPedido(s, 'fdv'), s).toBe(false);
  });
});
