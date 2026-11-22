import { describe, expect, it } from 'vitest';
import { recarregarValido } from './recarregar';

const ID = '00000000-0000-4000-8000-000000000001';

describe('recarregarValido', () => {
  it('rota exata registrada vale', () => expect(recarregarValido('/pedido/pedidos')).toBe(true));
  it('detalhe com UUID vale', () => expect(recarregarValido(`/pedido/pedidos/${ID}`)).toBe(true));
  it('detalhe com segmento que não é UUID não vale', () => {
    expect(recarregarValido('/pedido/pedidos/abc')).toBe(false);
    expect(recarregarValido('/pedido/pedidos/..%2Fx')).toBe(false);
  });
  it('rota não registrada não vale', () => expect(recarregarValido('/qualquer/coisa')).toBe(false));
});
