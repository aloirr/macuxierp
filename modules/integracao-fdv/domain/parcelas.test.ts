import { describe, expect, it } from 'vitest';
import { PrazoPagamentoHub } from '../contracts';
import { lerParcelasDias, normalizarParcelasDias, parcelasDiasParaHub } from './parcelas';

describe('RN-INF-PRAZO: parcelas_dias do Hub é lista de inteiros (T-0085)', () => {
  it('prazos do ERP viram lista de inteiros, na ordem; à vista = [0]', () => {
    expect(parcelasDiasParaHub([28, 56])).toEqual([28, 56]);
    expect(parcelasDiasParaHub([0])).toEqual([0]);
    expect(parcelasDiasParaHub([])).toEqual([0]);
  });

  it('fixture do Hub: o payload aceito tem parcelas_dias como lista e o texto "28/56" é recusado', () => {
    const base = { external_id: '11111111-1111-4111-8111-111111111111', ativo: true, forma_external_id: '22222222-2222-4222-8222-222222222222', codigo: '28-56', descricao: '28 e 56 dias', prazo_medio_dias: 42 };
    expect(PrazoPagamentoHub.safeParse({ ...base, parcelas_dias: [28, 56] }).success).toBe(true);
    expect(PrazoPagamentoHub.safeParse({ ...base, parcelas_dias: [0] }).success).toBe(true);
    expect(PrazoPagamentoHub.safeParse({ ...base, parcelas_dias: '28/56' }).success).toBe(false);
    expect(PrazoPagamentoHub.safeParse({ ...base, parcelas_dias: ['28'] }).success).toBe(false);
    expect(PrazoPagamentoHub.safeParse({ ...base, parcelas_dias: [] }).success).toBe(false);
  });

  it('leitor aceita a lista e o texto legado "28/56" já gravado no espelho', () => {
    expect(lerParcelasDias([28, 56])).toEqual([28, 56]);
    expect(lerParcelasDias('28/56')).toEqual([28, 56]);
    expect(lerParcelasDias('0')).toEqual([0]);
    expect(lerParcelasDias(null)).toBeNull();
    expect(lerParcelasDias([])).toBeNull();
    expect(lerParcelasDias('x')).toBeNull();
  });
});

describe('T-0112: normalizarParcelasDias', () => {
  it('RN-INF-PRAZO: texto legado vira lista; lista fica; ilegível fica como está; o resto do payload não muda', () => {
    expect(normalizarParcelasDias({ a: 1, parcelas_dias: '28/56' })).toEqual({ a: 1, parcelas_dias: [28, 56] });
    expect(normalizarParcelasDias({ parcelas_dias: '0' })).toEqual({ parcelas_dias: [0] });
    expect(normalizarParcelasDias({ parcelas_dias: [28] })).toEqual({ parcelas_dias: [28] });
    expect(normalizarParcelasDias({ parcelas_dias: 'x' })).toEqual({ parcelas_dias: 'x' });
    expect(normalizarParcelasDias({ parcelas_dias: [] })).toEqual({ parcelas_dias: [] });
  });
});
