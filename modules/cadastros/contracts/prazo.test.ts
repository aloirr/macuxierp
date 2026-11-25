import { describe, expect, it } from 'vitest';
import { CondicaoPagamento, CondicaoPagamentoDados, Cliente, EVENTOS, LinhaCondicaoPagamento, MAX_DIAS, MAX_DIAS_LEGADO, MAX_PARCELAS, MAX_PARCELAS_LEGADO, prazoCompleto, prazoPermitidoAoCliente } from './index';

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

describe('RN-CAD-15 e regra 3 do CLAUDE.md: legado até o CHECK da 0052 na entidade e no evento @1; 365/24 só na entrada', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const legada = {
    codigo: 'L400', descricao: 'Legado', forma_tpag: '15', prazos_dias: Array.from({ length: 30 }, () => 400), prazo_medio_dias: 400,
    forma_external_id: 'f1', external_id: 'c1', id: uuid, inativo: false, external_id_anterior: null,
  };
  it('o limite legado é mais largo que o da entrada', () => {
    expect(MAX_DIAS_LEGADO).toBeGreaterThan(MAX_DIAS);
    expect(MAX_PARCELAS_LEGADO).toBeGreaterThan(MAX_PARCELAS);
  });
  it('a condição legada de 400 dias e 30 parcelas passa na entidade e no evento @1', () => {
    expect(CondicaoPagamento.safeParse(legada).success).toBe(true);
    expect(EVENTOS['cadastros.condicao_pagamento.alterada@1'].safeParse(legada).success).toBe(true);
    expect(CondicaoPagamento.safeParse({ ...legada, prazo_medio_dias: MAX_DIAS_LEGADO + 1 }).success).toBe(false);
    expect(CondicaoPagamento.safeParse({ ...legada, prazos_dias: Array.from({ length: MAX_PARCELAS_LEGADO + 1 }, () => 1) }).success).toBe(false);
  });
  it('a mesma condição é recusada na entrada e na carga CSV', () => {
    expect(CondicaoPagamentoDados.safeParse(legada).success).toBe(false);
    expect(CondicaoPagamentoDados.safeParse({ ...legada, prazos_dias: [30] }).success).toBe(false);
    expect(CondicaoPagamentoDados.safeParse({ ...legada, prazo_medio_dias: 30 }).success).toBe(false);
    const csv = LinhaCondicaoPagamento.shape.dados.shape;
    expect(csv.prazos_dias.safeParse(legada.prazos_dias).success).toBe(false);
    expect(csv.prazo_medio_dias.safeParse(400).success).toBe(false);
  });
  it('prazoCompleto e prazoPermitidoAoCliente seguem funcionando com o legado', () => {
    expect(prazoCompleto(legada)).toBe(true);
    expect(prazoPermitidoAoCliente(legada, { prazo_medio_dias: 400 })).toBe(true);
    expect(prazoPermitidoAoCliente(legada, { prazo_medio_dias: 399 })).toBe(false);
  });
  it('o prazo médio legado do cliente (até 999) passa na entidade e no evento; a entrada fica em 365', () => {
    const e = EVENTOS['cadastros.cliente.alterado@1'].shape.prazo_medio_dias;
    expect(Cliente.shape.prazo_medio_dias.safeParse(400).success).toBe(true);
    expect(e.safeParse(999).success).toBe(true);
    expect(e.safeParse(1000).success).toBe(false);
  });
});
