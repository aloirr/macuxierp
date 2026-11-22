import { describe, expect, it } from 'vitest';
import { sugerirIndIeDest as sugerir, validarIe, validarIndIeDest } from './ie';

describe('inscrição estadual', () => {
  it('RN-CAD-02: UF com DV no SDK: DV certo passa e devolve a IE limpa; errado não', () => {
    expect(validarIe('AM', '01.234.567-9')).toEqual({ ok: true, ie: '012345679' });
    expect(validarIe('AM', '012345678').ok).toBe(false);
    expect(validarIe('PA', '15.000000-6')).toEqual({ ok: true, ie: '150000006' });
    expect(validarIe('PA', '150000007').ok).toBe(false);
    expect(validarIe('SP', '110.042.490.114')).toEqual({ ok: true, ie: '110042490114' });
    expect(validarIe('SP', '110042490115').ok).toBe(false);
  });
  it('RN-CAD-02: UF sem DV no SDK valida só o formato (2 a 14 posições numéricas)', () => {
    expect(validarIe('RS', '0123456789').ok).toBe(true);
    expect(validarIe('RS', 'AB').ok).toBe(false);
  });
  it('RN-CAD-02: "ISENTO" é aceito como texto fixo', () => {
    expect(validarIe('AM', 'isento')).toEqual({ ok: true, ie: 'ISENTO' });
  });
});

describe('indicador da IE do destinatário', () => {
  it('RN-CAD-02: contribuinte (1) exige IE válida e não aceita ISENTO', () => {
    expect(validarIndIeDest({ ind_ie_dest: '1', ie: '012345679', uf: 'AM' }).ok).toBe(true);
    expect(validarIndIeDest({ ind_ie_dest: '1', ie: null, uf: 'AM' }).ok).toBe(false);
    expect(validarIndIeDest({ ind_ie_dest: '1', ie: 'ISENTO', uf: 'AM' }).ok).toBe(false);
  });
  it('RN-CAD-02: isento (2) leva ISENTO ou nenhuma IE, nunca um número', () => {
    expect(validarIndIeDest({ ind_ie_dest: '2', ie: 'ISENTO', uf: 'AM' }).ok).toBe(true);
    expect(validarIndIeDest({ ind_ie_dest: '2', ie: '012345679', uf: 'AM' }).ok).toBe(false);
  });
  it('RN-CAD-02: não contribuinte sem IE gera indIEDest 9; com IE é recusado', () => {
    expect(validarIndIeDest({ ind_ie_dest: '9', ie: null, uf: 'AM' }).ok).toBe(true);
    expect(validarIndIeDest({ ind_ie_dest: '9', ie: '012345679', uf: 'AM' }).ok).toBe(false);
  });
  it('RN-CAD-02: sugere o indicador a partir da IE informada', () => {
    expect(sugerir(null)).toBe('9');
    expect(sugerir('ISENTO')).toBe('2');
    expect(sugerir('012345679')).toBe('1');
  });
});
