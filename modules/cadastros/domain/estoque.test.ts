import { describe, expect, it } from 'vitest';
import { aplicarMovimento } from './estoque';

describe('movimento de estoque', () => {
  it('RN-CAD-07: entrada soma e saída subtrai (quantidade × 10^4)', () => {
    expect(aplicarMovimento({ saldo: 50_000, tipo: 'entrada', quantidade: 20_000, podeNegativo: false })).toEqual({ ok: true, delta: 20_000, saldo: 70_000 });
    expect(aplicarMovimento({ saldo: 50_000, tipo: 'saida', quantidade: 20_000, podeNegativo: false })).toEqual({ ok: true, delta: -20_000, saldo: 30_000 });
  });
  it('RN-CAD-07: saída que deixa o saldo negativo é recusada sem a permissão do gerente', () => {
    const r = aplicarMovimento({ saldo: 10_000, tipo: 'saida', quantidade: 10_001, podeNegativo: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violacao).toMatchObject({ rn: 'RN-CAD-07' });
  });
  it('RN-CAD-07: com a permissão (cadastros.estoque.negativo) o saldo pode ficar negativo', () => {
    expect(aplicarMovimento({ saldo: 10_000, tipo: 'saida', quantidade: 30_000, podeNegativo: true })).toMatchObject({ ok: true, saldo: -20_000 });
  });
  it('RN-CAD-07: ajuste tem sinal e não pode ser zero; saldo exato zero é permitido', () => {
    expect(aplicarMovimento({ saldo: 10_000, tipo: 'ajuste', quantidade: -10_000, podeNegativo: false })).toMatchObject({ ok: true, saldo: 0 });
    expect(aplicarMovimento({ saldo: 10_000, tipo: 'ajuste', quantidade: 0, podeNegativo: false }).ok).toBe(false);
    expect(aplicarMovimento({ saldo: 10_000, tipo: 'ajuste', quantidade: -10_001, podeNegativo: false }).ok).toBe(false);
  });
  it('RN-CAD-07: entrada e saída exigem quantidade positiva', () => {
    expect(aplicarMovimento({ saldo: 0, tipo: 'entrada', quantidade: -1, podeNegativo: true }).ok).toBe(false);
    expect(aplicarMovimento({ saldo: 0, tipo: 'saida', quantidade: 0, podeNegativo: true }).ok).toBe(false);
  });
});
