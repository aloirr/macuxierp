import { describe, expect, it } from 'vitest';
import { prazoCompleto, prazoPermitidoAoCliente } from './index';

describe('prazo completo e prazo permitido ao cliente (contracts)', () => {
  const prazo = { codigo: 'B30', descricao: 'Boleto 30', prazos_dias: [30], prazo_medio_dias: 30 as number | null };
  it('RN-CAD-15: completo = código, descrição, ao menos uma parcela e prazo médio não nulo', () => {
    expect(prazoCompleto(prazo)).toBe(true);
    expect(prazoCompleto({ ...prazo, prazo_medio_dias: 0 })).toBe(true);
    expect(prazoCompleto({ ...prazo, prazo_medio_dias: null })).toBe(false);
    expect(prazoCompleto({ ...prazo, prazos_dias: [] })).toBe(false);
    expect(prazoCompleto({ ...prazo, descricao: ' ' })).toBe(false);
    expect(prazoCompleto({ ...prazo, codigo: '' })).toBe(false);
  });
  it('RN-CAD-16: cliente sem prazo médio vê todos os prazos completos; com prazo médio, só os de prazo médio <= o dele', () => {
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: null })).toBe(true);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 30 })).toBe(true);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 45 })).toBe(true);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 29 })).toBe(false);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 0 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: 0, prazos_dias: [0] }, { prazo_medio_dias: 0 })).toBe(true);
  });
  it('RN-CAD-16: prazo incompleto (legado) nunca é permitido, nem a cliente sem prazo médio', () => {
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: null }, { prazo_medio_dias: null })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: null }, { prazo_medio_dias: 365 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: undefined }, {})).toBe(false);
  });
  it('RN-CAD-16: exceção do cartão de crédito (tPag 03) fica fora do limite do prazo médio', () => {
    const cartao = { ...prazo, forma_tpag: '03', prazos_dias: [30, 60, 90], prazo_medio_dias: 90 as number | null };
    expect(prazoPermitidoAoCliente(cartao, { prazo_medio_dias: 30 })).toBe(true);
    expect(prazoPermitidoAoCliente(cartao, { prazo_medio_dias: 0 })).toBe(true);
    expect(prazoPermitidoAoCliente({ ...cartao, prazo_medio_dias: null }, { prazo_medio_dias: 30 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...cartao, prazos_dias: [] }, { prazo_medio_dias: 365 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...cartao, forma_tpag: '15' }, { prazo_medio_dias: 30 })).toBe(false);
  });
});
