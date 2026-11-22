import { describe, expect, it } from 'vitest';
import { MotivoCodigo } from '../contracts';
import { CATALOGO_MOTIVOS, CATALOGO_MOTIVOS_SISTEMA, MOTIVO_NOTA_CANCELADA, textoMotivoSistema, textoMotivo } from './motivos';

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

describe('motivo de sistema', () => {
  it('RN-PED-02: nota_cancelada é motivo só de sistema, fora do que o usuário escolhe na tela', () => {
    expect(MOTIVO_NOTA_CANCELADA).toBe('nota_cancelada');
    expect(MotivoCodigo.safeParse(MOTIVO_NOTA_CANCELADA).success).toBe(false);
    expect(Object.keys(CATALOGO_MOTIVOS)).not.toContain(MOTIVO_NOTA_CANCELADA);
    expect(textoMotivoSistema(MOTIVO_NOTA_CANCELADA)).toBe(CATALOGO_MOTIVOS_SISTEMA.nota_cancelada);
    expect(textoMotivoSistema('qualquer')).toBeNull();
  });
});
