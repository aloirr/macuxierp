import { describe, expect, it } from 'vitest';
import { limparDescricaoOficial } from './oficial';

describe('limparDescricaoOficial', () => {
  it('RN-CAD-10: tira as tags HTML da descrição da carga e mantém o texto', () => {
    expect(limparDescricaoOficial('Outros <i>preparados</i> de carne')).toBe('Outros preparados de carne');
    expect(limparDescricaoOficial('<b>A</b><br/>B')).toBe('A B');
  });
  it('RN-CAD-10: converte as entidades comuns e junta espaços', () => {
    expect(limparDescricaoOficial('Leite &amp; creme&nbsp;&nbsp; de &lt;1&gt; kg')).toBe('Leite & creme de <1> kg');
  });
  it('RN-CAD-10: texto sem tag passa igual; vazio e nulo ficam como estão', () => {
    expect(limparDescricaoOficial('Arroz')).toBe('Arroz');
    expect(limparDescricaoOficial(null)).toBeNull();
    expect(limparDescricaoOficial(undefined)).toBeUndefined();
    expect(limparDescricaoOficial('')).toBe('');
  });
  it('RN-CAD-10: o sinal de menor solto, sem tag, fica no texto', () => {
    expect(limparDescricaoOficial('teor < 5 e > 2')).toBe('teor < 5 e > 2');
  });
});
