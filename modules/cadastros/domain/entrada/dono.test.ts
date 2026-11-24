import { describe, expect, it } from 'vitest';
import { donoDaCarga, donoEfetivo, donoPermiteEscrita, type MapaDono } from './dono';

describe('dono por entidade (ADR 0014 §14, RN-CAD a numerar)', () => {
  it('dono cliente: a entrada aceita; o BKO e a carga de CSV são recusados com dono_cliente', () => {
    expect(donoPermiteEscrita('cliente', 'entrada')).toEqual({ ok: true });
    expect(donoPermiteEscrita('cliente', 'bko')).toEqual({ ok: false, codigo: 'dono_cliente' });
    expect(donoPermiteEscrita('cliente', 'csv')).toEqual({ ok: false, codigo: 'dono_cliente' });
  });

  it('dono erp: a entrada é recusada com entidade_dono_erp; o BKO e a carga de CSV seguem', () => {
    expect(donoPermiteEscrita('erp', 'entrada')).toEqual({ ok: false, codigo: 'entidade_dono_erp' });
    expect(donoPermiteEscrita('erp', 'bko')).toEqual({ ok: true });
    expect(donoPermiteEscrita('erp', 'csv')).toEqual({ ok: true });
  });

  it('o padrão é erp quando a entidade não está no mapa', () => {
    expect(donoEfetivo('produto', {})).toBe('erp');
    expect(donoEfetivo('produto', { produto: 'cliente' })).toBe('cliente');
  });

  it('o cliente_endereco segue o dono do cliente, mesmo que o mapa diga outra coisa', () => {
    const m: MapaDono = { cliente: 'cliente', cliente_endereco: 'erp' };
    expect(donoEfetivo('cliente_endereco', m)).toBe('cliente');
    expect(donoEfetivo('cliente_endereco', { cliente: 'erp', cliente_endereco: 'cliente' })).toBe('erp');
    expect(donoEfetivo('cliente_endereco', {})).toBe('erp');
  });

  it('o produto_unidade segue o dono do produto', () => {
    expect(donoEfetivo('produto_unidade', { produto: 'cliente', produto_unidade: 'erp' })).toBe('cliente');
    expect(donoEfetivo('produto_unidade', { produto: 'erp', produto_unidade: 'cliente' })).toBe('erp');
  });

  it('a carga de CSV bloqueia a entidade da carga se qualquer entidade do Hub dela tem dono cliente (condição = forma + prazo)', () => {
    expect(donoDaCarga('cliente', { cliente: 'cliente' })).toBe('cliente');
    expect(donoDaCarga('condicao_pagamento', { prazo_pagamento: 'cliente' })).toBe('cliente');
    expect(donoDaCarga('condicao_pagamento', { forma_pagamento: 'cliente' })).toBe('cliente');
    expect(donoDaCarga('condicao_pagamento', {})).toBe('erp');
    expect(donoDaCarga('produto_unidade', { produto: 'cliente' })).toBe('cliente');
  });
});
