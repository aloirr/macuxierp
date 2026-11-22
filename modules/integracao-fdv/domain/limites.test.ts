import { describe, expect, it } from 'vitest';
import { LOTES_POR_MINUTO, decidirChamada, decidirEnvioLote, repartirLimiteAgenda } from './limites';

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

describe('cotas da reserva da agenda', () => {
  it('RF-INF-04: sinal, reconciliação e envio dividem o limite; a soma é o limite e o envio nunca fica sem vez', () => {
    expect(repartirLimiteAgenda(10)).toEqual({ sinal: 4, reconciliacao: 2, envio: 4 });
    for (const l of [2, 3, 4, 5, 7, 10, 50, 100]) {
      const c = repartirLimiteAgenda(l);
      expect(c.sinal + c.reconciliacao + c.envio).toBe(l);
      expect(c.envio).toBeGreaterThanOrEqual(1);
      expect(c.sinal).toBeGreaterThanOrEqual(1);
    }
    expect(repartirLimiteAgenda(1)).toEqual({ sinal: 0, reconciliacao: 0, envio: 1 });
    expect(repartirLimiteAgenda(0)).toEqual({ sinal: 0, reconciliacao: 0, envio: 0 });
  });
});
