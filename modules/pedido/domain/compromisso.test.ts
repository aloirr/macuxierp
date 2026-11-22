import { describe, expect, it } from 'vitest';
import { STATUS_COMPROMETEM, compromissoDeCredito } from './validacao';

describe('compromisso de crédito (RN-PED-04, premissa f)', () => {
  const aVista = { forma_tpag: '01', prazos_dias: [0] };
  const aPrazo = { forma_tpag: '15', prazos_dias: [30] };
  it('RN-PED-04: só aprovado e faturado_parcial comprometem estoque e crédito', () => {
    expect([...STATUS_COMPROMETEM]).toEqual(['aprovado', 'faturado_parcial']);
  });
  it('RN-PED-04: o pedido à vista não entra na soma; o a prazo, o sem condição e a condição desconhecida entram', () => {
    const linhas = [
      { condicao_pagamento_id: 'v', centavos: 1000 },
      { condicao_pagamento_id: 'p', centavos: 200 },
      { condicao_pagamento_id: null, centavos: 30 },
      { condicao_pagamento_id: 'x', centavos: 4 },
    ];
    const condicoes = new Map([['v', aVista], ['p', aPrazo]]);
    expect(compromissoDeCredito(linhas, condicoes)).toBe(234);
  });
  it('RN-PED-04: boleto com prazos [30] conta no compromisso; PIX com prazos [0] não conta', () => {
    const condicoes = new Map([['bol30', { forma_tpag: '15', prazos_dias: [30] }], ['pix0', { forma_tpag: '17', prazos_dias: [0] }]]);
    expect(compromissoDeCredito([{ condicao_pagamento_id: 'bol30', centavos: 500 }], condicoes)).toBe(500);
    expect(compromissoDeCredito([{ condicao_pagamento_id: 'pix0', centavos: 500 }], condicoes)).toBe(0);
  });
  it('RN-PED-04: sem linhas, zero', () => expect(compromissoDeCredito([], new Map())).toBe(0));
});
