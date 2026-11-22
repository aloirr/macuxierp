import { describe, expect, it } from 'vitest';
import { STATUS_COMPROMETEM } from './validacao';

describe('compromisso de crédito (RN-PED-04, premissa f; decisões de 22/11, 01h10 e 01h12)', () => {
  it('RN-PED-04: só aprovado e faturado_parcial comprometem estoque e crédito', () => {
    expect([...STATUS_COMPROMETEM]).toEqual(['aprovado', 'faturado_parcial']);
  });
});
