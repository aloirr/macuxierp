import { describe, expect, it } from 'vitest';
import { CargaPedido, ehAVista, FORMAS_A_VISTA, MAX_ARQUIVOS_LOTE } from './index';

describe('contrato da carga de CSV', () => {
  it('CargaPedido aceita até MAX_ARQUIVOS_LOTE arquivos (o literal do .max() é lido pelo teste de sincronia da CLI)', () => {
    const arquivo = { nome: 'cliente.csv', bytes: new Uint8Array() };
    expect(CargaPedido.safeParse({ modo: 'validar', arquivos: Array(MAX_ARQUIVOS_LOTE).fill(arquivo) }).success).toBe(true);
    expect(CargaPedido.safeParse({ modo: 'validar', arquivos: Array(MAX_ARQUIVOS_LOTE + 1).fill(arquivo) }).success).toBe(false);
  });
});

describe('critério único de à vista (RN-CAD-09)', () => {
  it('RN-CAD-09: ehAVista exige forma à vista e todos os prazos 0', () => {
    expect([...FORMAS_A_VISTA]).toEqual(['01', '04', '17']);
    for (const f of FORMAS_A_VISTA) expect(ehAVista({ forma_tpag: f, prazos_dias: [0] })).toBe(true);
    expect(ehAVista({ forma_tpag: '01', prazos_dias: [0, 0] })).toBe(true);
    expect(ehAVista({ forma_tpag: '01', prazos_dias: [0, 30] })).toBe(false);
    expect(ehAVista({ forma_tpag: '15', prazos_dias: [0] })).toBe(false);
    expect(ehAVista({ forma_tpag: '17', prazos_dias: [30] })).toBe(false);
  });
});
