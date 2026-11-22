import { describe, expect, it } from 'vitest';
import { MotivoCodigo } from '../contracts';
import { CATALOGO_MOTIVOS, textoMotivo } from './motivos';

describe('catálogo de motivos', () => {
  it('RN-PED-05: todo código do contrato tem texto em português', () => {
    for (const c of MotivoCodigo.options) expect(CATALOGO_MOTIVOS[c].length).toBeGreaterThan(3);
  });
  it('RN-PED-05: ao FDV vai o texto do catálogo; em "outro", o texto livre', () => {
    expect(textoMotivo('credito_insuficiente', 'ignorado')).toBe(CATALOGO_MOTIVOS.credito_insuficiente);
    expect(textoMotivo('outro', 'Cliente pediu troca')).toBe('Cliente pediu troca');
    expect(textoMotivo('outro', null)).toBe(CATALOGO_MOTIVOS.outro);
  });
});
