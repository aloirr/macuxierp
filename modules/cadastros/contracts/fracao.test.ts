import { describe, expect, it } from 'vitest';
import { quantidadeAceitaFracao, validarFracaoDaQuantidade } from './index';

describe('RN-CAD-17: fração só em KG e M', () => {
  it('RN-CAD-17: KG e M aceitam fração (qualquer caixa); as outras unidades não', () => {
    expect(quantidadeAceitaFracao('KG')).toBe(true);
    expect(quantidadeAceitaFracao(' m ')).toBe(true);
    for (const u of ['UN', 'CX', 'L', 'PC', 'KGX', '', null, undefined]) expect(quantidadeAceitaFracao(u)).toBe(false);
  });

  it('RN-CAD-17: quantidade inteira passa em qualquer unidade', () => {
    expect(validarFracaoDaQuantidade('UN', 30_000)).toEqual({ ok: true });
    expect(validarFracaoDaQuantidade('CX', 10_000)).toEqual({ ok: true });
  });

  it('RN-CAD-17: fração em UN é recusada com motivo; em KG e M passa, até 4 casas', () => {
    const r = validarFracaoDaQuantidade('UN', 15_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/só em KG e M/);
    expect(validarFracaoDaQuantidade('KG', 15_000)).toEqual({ ok: true });
    expect(validarFracaoDaQuantidade('M', 1)).toEqual({ ok: true });
  });

  it('RN-CAD-17: mais de 4 casas (valor não inteiro na escala) é recusado mesmo em KG', () => {
    expect(validarFracaoDaQuantidade('KG', 1.5).ok).toBe(false);
  });
});
