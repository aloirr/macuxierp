import { describe, expect, it } from 'vitest';
import type { Pendencia } from '../contracts';
import { decidirAprovacao, decisaoAutomatica } from './aprovacao';

const P = '00000000-0000-4000-8000-0000000000a1';
const bloq: Pendencia = { codigo: 'cliente_inativo', bloqueante: true, sequencia: null, produto_id: null };
const leve: Pendencia = { codigo: 'estoque_insuficiente', bloqueante: false, sequencia: null, produto_id: P };

describe('decisão de aprovação', () => {
  it('RN-PED-03: sem pendência a decisão automática é aprovado', () => {
    expect(decisaoAutomatica([])).toBe('aprovado');
  });
  it('RN-PED-03: com qualquer pendência a decisão automática é em_analise', () => {
    expect(decisaoAutomatica([leve])).toBe('em_analise');
    expect(decisaoAutomatica([bloq])).toBe('em_analise');
  });
  it('RN-PED-03: pendência bloqueante impede aprovar, com a lista dos bloqueantes', () => {
    expect(decidirAprovacao([bloq, leve], 'ok')).toEqual({ ok: false, tipo: 'regra', rn: 'RN-PED-03', bloqueantes: [bloq], mensagem: expect.any(String) });
  });
  it('RN-PED-03: pendência não bloqueante sem justificativa é erro de entrada (400)', () => {
    for (const j of [undefined, '', '   ']) {
      expect(decidirAprovacao([leve], j)).toEqual({ ok: false, tipo: 'entrada', campo: 'justificativa', mensagem: expect.any(String) });
    }
  });
  it('RN-PED-03: pendência não bloqueante com justificativa é aceita e fica registrada', () => {
    expect(decidirAprovacao([leve], 'Gerente liberou')).toEqual({ ok: true, pendencias_aceitas: [leve], pendencias_gravar: [leve], justificativa: 'Gerente liberou' });
  });
  it('RN-PED-03: sem pendência aprova sem justificativa', () => {
    expect(decidirAprovacao([], undefined)).toEqual({ ok: true, pendencias_aceitas: [], pendencias_gravar: [], justificativa: null });
  });
  it('RN-PED-07 e RN-PED-03: no pedido do FDV a pendência de prazo é aceita com justificativa e vira não bloqueante', () => {
    const prazo: Pendencia = { codigo: 'prazo_acima_do_cliente', bloqueante: true, sequencia: null, produto_id: null };
    const aceita = { ...prazo, bloqueante: false };
    expect(decidirAprovacao([prazo], 'Cliente novo, prazo liberado', 'fdv')).toEqual({ ok: true, pendencias_aceitas: [aceita], pendencias_gravar: [aceita], justificativa: 'Cliente novo, prazo liberado' });
    expect(decidirAprovacao([prazo], '  ', 'fdv')).toMatchObject({ ok: false, tipo: 'entrada', campo: 'justificativa' });
    // outra bloqueante continua barrando; a não bloqueante é aceita mas não é gravada no aprovado
    expect(decidirAprovacao([prazo, bloq], 'ok', 'fdv')).toMatchObject({ ok: false, tipo: 'regra', rn: 'RN-PED-03', bloqueantes: [bloq] });
    expect(decidirAprovacao([prazo, leve], 'ok', 'fdv')).toMatchObject({ ok: true, pendencias_aceitas: [aceita, leve], pendencias_gravar: [aceita] });
    // pedido manual: o prazo segue bloqueante
    expect(decidirAprovacao([prazo], 'ok')).toMatchObject({ ok: false, tipo: 'regra', rn: 'RN-PED-03' });
  });
});
