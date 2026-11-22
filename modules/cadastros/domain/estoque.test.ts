import { describe, expect, it } from 'vitest';
import { aplicarMovimento, deveMoverEstoque, movimentosDaNota } from './estoque';

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

describe('estoque pela nota fiscal (RN-CAD-07)', () => {
  const F = '00000000-0000-4000-8000-000000000001';
  const P = '00000000-0000-4000-8000-0000000000a1';
  it('RN-CAD-07: produção move; homologação só com a bandeira conta_como_real', () => {
    expect(deveMoverEstoque({ ambiente: 'producao' })).toBe(true);
    expect(deveMoverEstoque({ ambiente: 'homologacao' })).toBe(false);
    expect(deveMoverEstoque({ ambiente: 'homologacao', conta_como_real: false })).toBe(false);
    expect(deveMoverEstoque({ ambiente: 'homologacao', conta_como_real: true })).toBe(true);
  });
  it('RN-CAD-07: autorizada dá saída e cancelada dá entrada, com quantidade positiva × 10^4', () => {
    const itens = [{ produto_id: P, filial_id: F, quantidade: 25_000 }];
    expect(movimentosDaNota('autorizada', itens)).toEqual([{ indice: 0, filial_id: F, produto_id: P, tipo: 'saida', quantidade: 25_000 }]);
    expect(movimentosDaNota('cancelada', itens)).toEqual([{ indice: 0, filial_id: F, produto_id: P, tipo: 'entrada', quantidade: 25_000 }]);
  });
  it('RN-CAD-07: item sem produto_id, filial_id ou quantidade válida é ignorado (o índice do item se mantém)', () => {
    const r = movimentosDaNota('autorizada', [
      { filial_id: F, quantidade: 10_000 }, { produto_id: P, quantidade: 10_000 }, { produto_id: P, filial_id: F },
      { produto_id: P, filial_id: F, quantidade: 0 }, { produto_id: P, filial_id: F, quantidade: -5 }, { produto_id: P, filial_id: F, quantidade: 1.5 },
      { produto_id: P, filial_id: F, quantidade: 10_000 },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ indice: 6 });
  });
});
