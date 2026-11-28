import { describe, expect, it } from 'vitest';
import { ROTULO_SITUACAO_LICENCA, TEXTO_SEM_PRAZO, situacaoDaLicenca, tomDaLicenca } from './textos-licenca';

const agora = new Date('2026-11-28T12:00:00Z');
describe('vocabulário da situação da licença (RN-CORE-02)', () => {
  it('RN-CORE-02: ativa sem prazo e ativa dentro do prazo são "Ativa"; vencida e desligada têm nome próprio', () => {
    expect(situacaoDaLicenca({ ativo: true, valido_ate: null }, agora)).toBe('ativa');
    expect(situacaoDaLicenca({ ativo: true, valido_ate: '2026-12-01T00:00:00Z' }, agora)).toBe('ativa');
    expect(situacaoDaLicenca({ ativo: true, valido_ate: '2026-11-01T00:00:00Z' }, agora)).toBe('vencida');
    expect(situacaoDaLicenca({ ativo: false, valido_ate: null }, agora)).toBe('inativa');
  });
  it('RN-CORE-02: rótulos e tons únicos; "Sem prazo" é só o texto da validade', () => {
    expect(ROTULO_SITUACAO_LICENCA).toEqual({ ativa: 'Ativa', inativa: 'Inativa', vencida: 'Vencida' });
    expect(tomDaLicenca('ativa')).toBe('ok');
    expect(tomDaLicenca('vencida')).toBe('alerta');
    expect(tomDaLicenca('inativa')).toBe('neutro');
    expect(TEXTO_SEM_PRAZO).toBe('Sem prazo');
  });
});
