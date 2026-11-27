import { describe, expect, it } from 'vitest';
import { linhaBaseFdv, textoProximaTentativa } from './integracao-fdv';

describe('v0.3.18 A2: próxima tentativa (texto e linha)', () => {
  it('textoProximaTentativa usa a data e hora no fuso do tenant', () => {
    expect(textoProximaTentativa('2026-11-27T15:30:00.000Z', 'America/Manaus')).toBe('Próxima tentativa: 27/11/2026 11:30');
    expect(textoProximaTentativa('2026-11-27T15:30:00.000Z', 'America/Sao_Paulo')).toBe('Próxima tentativa: 27/11/2026 12:30');
  });
  it('linhaBaseFdv: com data vira texto; nulo ou ausente vira null', () => {
    const base = { entidade: 'cliente', ligada: true, ultimo_envio_em: null, falha: { motivo: 'credencial', acao: 'corrigir_credencial' } } as const;
    expect(linhaBaseFdv({ ...base, proxima_tentativa_em: '2026-11-27T15:30:00.000Z' }, 'America/Manaus', () => '').proximaTentativa).toBe('Próxima tentativa: 27/11/2026 11:30');
    expect(linhaBaseFdv({ ...base, proxima_tentativa_em: null }, 'America/Manaus', () => '').proximaTentativa).toBeNull();
    expect(linhaBaseFdv(base, 'America/Manaus', () => '').proximaTentativa).toBeNull();
  });
});

describe('v0.3.19 expand: falha sem ação (acao: null, licenca_erp)', () => {
  it('a linha mostra só o motivo, sem ação, e não chama o texto da ação', () => {
    let chamou = false;
    const l = linhaBaseFdv({ entidade: 'cliente', ligada: true, ultimo_envio_em: null, falha: { motivo: 'licenca_erp', acao: null } }, 'America/Manaus', () => { chamou = true; return 'x'; });
    expect(l.falha).toEqual({ motivo: 'Sem licença da Integração FDV.', acao: '' });
    expect(chamou).toBe(false);
  });
});
