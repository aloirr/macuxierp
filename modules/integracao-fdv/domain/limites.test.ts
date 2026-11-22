import { describe, expect, it } from 'vitest';
import { LOTES_POR_MINUTO, decidirChamada, decidirEnvioLote } from './limites';

describe('limites próprios', () => {
  const agora = 1_000_000_000;
  it('1 lote em voo por entidade', () => {
    expect(decidirEnvioLote({ agora, lotesEm: [], chamadasEm: [], emVooNaEntidade: 1 })).toMatchObject({ permitido: false, motivo: 'lote_em_voo' });
    expect(decidirEnvioLote({ agora, lotesEm: [], chamadasEm: [], emVooNaEntidade: 0 })).toEqual({ permitido: true });
  });

  it('15 lotes por minuto: espera até a marca mais antiga sair da janela', () => {
    const lotesEm = Array.from({ length: LOTES_POR_MINUTO }, (_, i) => agora - 50_000 + i);
    const d = decidirEnvioLote({ agora, lotesEm, chamadasEm: [], emVooNaEntidade: 0 });
    expect(d).toMatchObject({ permitido: false, motivo: 'limite_lotes' });
    expect((d as { esperarSegundos: number }).esperarSegundos).toBe(10);
    expect(decidirEnvioLote({ agora: agora + 11_000, lotesEm, chamadasEm: [], emVooNaEntidade: 0 })).toEqual({ permitido: true });
  });

  it('120 chamadas por minuto', () => {
    const chamadasEm = Array.from({ length: 120 }, () => agora - 1000);
    expect(decidirChamada({ agora, chamadasEm })).toMatchObject({ permitido: false, motivo: 'limite_chamadas' });
    expect(decidirChamada({ agora, chamadasEm: chamadasEm.slice(1) })).toEqual({ permitido: true });
  });
});
