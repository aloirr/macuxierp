import { describe, expect, it } from 'vitest';
import { camposAlterados, semMudanca } from './diferenca';

describe('sem mudança (D5)', () => {
  const atual = { razao_social: 'Cliente Exemplo', limite: 100, fantasia: null };
  it('D5: patch igual ao estado atual não muda nada', () => {
    expect(semMudanca({ razao_social: 'Cliente Exemplo', limite: 100 }, atual)).toBe(true);
  });
  it('D5: célula vazia (undefined) não conta como mudança', () => {
    expect(semMudanca({ razao_social: undefined, limite: 100 }, atual)).toBe(true);
  });
  it('D5: lista os campos que mudam', () => {
    expect(camposAlterados({ razao_social: 'Outro', limite: 100, fantasia: 'X' }, atual)).toEqual(['razao_social', 'fantasia']);
  });
  it('D5: lista e objeto são comparados por valor', () => {
    expect(semMudanca({ prazos: [30, 60] }, { prazos: [30, 60] })).toBe(true);
    expect(semMudanca({ prazos: [30] }, { prazos: [30, 60] })).toBe(false);
  });
});
