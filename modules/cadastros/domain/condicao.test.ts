import { describe, expect, it } from 'vitest';
import { FORMAS_A_VISTA } from '../contracts';
import { validarCondicaoPagamento } from './condicao';

describe('condição de pagamento', () => {
  it('RN-CAD-09: forma à vista (01, 04, 17) com prazo 0 é aceita', () => {
    for (const f of FORMAS_A_VISTA) expect(validarCondicaoPagamento({ forma_tpag: f, prazos_dias: [0] })).toEqual([]);
  });
  it('RN-CAD-09: forma à vista com algum prazo maior que 0 é recusada', () => {
    expect(validarCondicaoPagamento({ forma_tpag: '01', prazos_dias: [0, 30] })).toEqual([
      { rn: 'RN-CAD-09', campo: 'prazos_dias', mensagem: expect.any(String) },
    ]);
    expect(validarCondicaoPagamento({ forma_tpag: '17', prazos_dias: [1] })[0]).toMatchObject({ rn: 'RN-CAD-09' });
    expect(validarCondicaoPagamento({ forma_tpag: '04', prazos_dias: [0, 0, 999] })).toHaveLength(1);
  });
  it('RN-CAD-09: forma a prazo (15 boleto) aceita prazo 0 e prazos maiores', () => {
    expect(validarCondicaoPagamento({ forma_tpag: '15', prazos_dias: [0] })).toEqual([]);
    expect(validarCondicaoPagamento({ forma_tpag: '15', prazos_dias: [30, 60] })).toEqual([]);
  });
});
