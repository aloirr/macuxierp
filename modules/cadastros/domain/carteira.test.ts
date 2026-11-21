import { describe, expect, it } from 'vitest';
import { escopoDaCarteira, planejarTransferencia } from './carteira';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

describe('carteira', () => {
  it('D7: o vendedor vê só a própria carteira; sem cadastro de vendedor não vê ninguém', () => {
    expect(escopoDaCarteira('vendedor', [A])).toEqual({ todos: false, vendedor_ids: [A] });
    expect(escopoDaCarteira('vendedor', [])).toEqual({ todos: false, vendedor_ids: [] });
  });
  it('D7: os demais perfis veem a carteira toda', () => {
    for (const p of ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'] as const) {
      expect(escopoDaCarteira(p, [])).toEqual({ todos: true });
    }
  });
  it('D7: transfere a carteira inteira quando não há lista', () => {
    expect(planejarTransferencia({ de: A, para: B, cliente_ids: undefined, carteira_de: [C1, C2] })).toEqual({ ok: true, cliente_ids: [C1, C2] });
  });
  it('D7: transfere só os clientes pedidos, se estiverem na carteira de origem', () => {
    expect(planejarTransferencia({ de: A, para: B, cliente_ids: [C2], carteira_de: [C1, C2] })).toEqual({ ok: true, cliente_ids: [C2] });
    const r = planejarTransferencia({ de: A, para: B, cliente_ids: [C1], carteira_de: [C2] });
    expect(r.ok).toBe(false);
  });
  it('D7: origem igual ao destino ou carteira vazia é recusado', () => {
    expect(planejarTransferencia({ de: A, para: A, cliente_ids: undefined, carteira_de: [C1] }).ok).toBe(false);
    expect(planejarTransferencia({ de: A, para: B, cliente_ids: undefined, carteira_de: [] }).ok).toBe(false);
  });
});
