import { describe, expect, it } from 'vitest';
import { aplicarNotaAutorizada, aplicarNotaCancelada, recuarPorNotaCancelada } from './faturamento';

const itens = [
  { sequencia: 1, quantidade: 30_000, quantidade_faturada: 0 },
  { sequencia: 2, quantidade: 10_000, quantidade_faturada: 0 },
];

describe('aplicarNotaAutorizada', () => {
  it('RN-PED-02: nota que cobre todo o saldo leva aprovado a faturado', () => {
    const r = aplicarNotaAutorizada(itens, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 300 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 100 }], 'aprovado');
    expect(r).toEqual({ ok: true, status: 'faturado', valor_centavos: 400, itens: [{ sequencia: 1, quantidade_faturada: 30_000 }, { sequencia: 2, quantidade_faturada: 10_000 }] });
  });
  it('RN-PED-02: nota que cobre parte leva aprovado a faturado_parcial', () => {
    const r = aplicarNotaAutorizada(itens, [{ sequencia: 1, quantidade: 10_000, valor_centavos: 100 }], 'aprovado');
    expect(r).toMatchObject({ ok: true, status: 'faturado_parcial', itens: [{ sequencia: 1, quantidade_faturada: 10_000 }, { sequencia: 2, quantidade_faturada: 0 }] });
  });
  it('RN-PED-02: faturado_parcial acumula e chega a faturado', () => {
    const parcial = [{ sequencia: 1, quantidade: 30_000, quantidade_faturada: 10_000 }, { sequencia: 2, quantidade: 10_000, quantidade_faturada: 10_000 }];
    expect(aplicarNotaAutorizada(parcial, [{ sequencia: 1, quantidade: 20_000 }], 'faturado_parcial')).toMatchObject({ ok: true, status: 'faturado', valor_centavos: 0 });
    expect(aplicarNotaAutorizada(parcial, [{ sequencia: 1, quantidade: 10_000 }], 'faturado_parcial')).toMatchObject({ ok: true, status: 'faturado_parcial' });
  });
  it('RN-PED-02: linhas repetidas da mesma sequência somam antes de comparar com o saldo', () => {
    const r = aplicarNotaAutorizada(itens, [{ sequencia: 2, quantidade: 6_000 }, { sequencia: 2, quantidade: 5_000 }], 'aprovado');
    expect(r).toMatchObject({ ok: false, codigo: 'quantidade_acima_do_saldo' });
  });
  it('RN-PED-02: sequência inexistente é rejeitada', () => {
    expect(aplicarNotaAutorizada(itens, [{ sequencia: 9, quantidade: 1 }], 'aprovado')).toMatchObject({ ok: false, codigo: 'sequencia_inexistente' });
  });
  it('RN-PED-02: quantidade acima do saldo é rejeitada', () => {
    expect(aplicarNotaAutorizada(itens, [{ sequencia: 2, quantidade: 10_001 }], 'aprovado')).toMatchObject({ ok: false, codigo: 'quantidade_acima_do_saldo' });
  });
  it('RN-PED-02: quantidade zero, negativa ou fracionada e nota sem itens são rejeitadas', () => {
    for (const q of [0, -1, 1.5]) expect(aplicarNotaAutorizada(itens, [{ sequencia: 1, quantidade: q }], 'aprovado')).toMatchObject({ ok: false, codigo: 'quantidade_invalida' });
    expect(aplicarNotaAutorizada(itens, [], 'aprovado')).toMatchObject({ ok: false, codigo: 'nota_sem_itens' });
  });
  it('RN-PED-02: só aprovado e faturado_parcial recebem nota', () => {
    for (const s of ['recebido', 'em_analise', 'recusado', 'faturado', 'cancelado'] as const) {
      expect(aplicarNotaAutorizada(itens, [{ sequencia: 1, quantidade: 1 }], s)).toMatchObject({ ok: false, codigo: 'status_invalido' });
    }
  });
  it('RN-PED-02: não altera a entrada', () => {
    const copia = structuredClone(itens);
    aplicarNotaAutorizada(itens, [{ sequencia: 1, quantidade: 1 }], 'aprovado');
    expect(itens).toEqual(copia);
  });
});

describe('aplicarNotaCancelada', () => {
  const faturados = [{ sequencia: 1, quantidade: 30_000, quantidade_faturada: 30_000 }, { sequencia: 2, quantidade: 10_000, quantidade_faturada: 10_000 }];
  it('RN-PED-02: cancelar nota que tirou tudo do faturado devolve aprovado', () => {
    expect(aplicarNotaCancelada(faturados, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 300 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 100 }], 'faturado'))
      .toEqual({ ok: true, status: 'aprovado', valor_centavos: 400, itens: [{ sequencia: 1, quantidade_faturada: 0 }, { sequencia: 2, quantidade_faturada: 0 }] });
  });
  it('RN-PED-02: cancelar parte devolve faturado_parcial', () => {
    expect(aplicarNotaCancelada(faturados, [{ sequencia: 1, quantidade: 10_000 }], 'faturado')).toMatchObject({ ok: true, status: 'faturado_parcial' });
  });
  it('RN-PED-02: faturado_parcial que zera tudo volta a aprovado', () => {
    expect(aplicarNotaCancelada([{ sequencia: 1, quantidade: 30_000, quantidade_faturada: 10_000 }], [{ sequencia: 1, quantidade: 10_000 }], 'faturado_parcial')).toMatchObject({ ok: true, status: 'aprovado' });
  });
  it('RN-PED-02: sequência inexistente, quantidade acima do faturado e status inválido são rejeitados', () => {
    expect(aplicarNotaCancelada(faturados, [{ sequencia: 9, quantidade: 1 }], 'faturado')).toMatchObject({ ok: false, codigo: 'sequencia_inexistente' });
    expect(aplicarNotaCancelada(faturados, [{ sequencia: 2, quantidade: 10_001 }], 'faturado')).toMatchObject({ ok: false, codigo: 'quantidade_acima_do_faturado' });
    expect(aplicarNotaCancelada(faturados, [{ sequencia: 2, quantidade: 1 }], 'aprovado')).toMatchObject({ ok: false, codigo: 'status_invalido' });
    expect(aplicarNotaCancelada(faturados, [{ sequencia: 2, quantidade: 1 }], 'cancelado')).toMatchObject({ ok: false, codigo: 'status_invalido' });
  });
});

describe('recuarPorNotaCancelada', () => {
  const faturados = [{ sequencia: 1, quantidade: 30_000, quantidade_faturada: 30_000 }, { sequencia: 2, quantidade: 10_000, quantidade_faturada: 10_000 }];
  it('RN-PED-02: faturado → faturado_parcial subtrai itens e valor da nota', () => {
    expect(recuarPorNotaCancelada(faturados, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 300 }], 'faturado', 400))
      .toEqual({ ok: true, status: 'faturado_parcial', valor_faturado_centavos: 100, itens: [{ sequencia: 1, quantidade_faturada: 0 }, { sequencia: 2, quantidade_faturada: 10_000 }] });
  });
  it('RN-PED-02: o recuo a aprovado só sai com itens zerados e valor faturado zero', () => {
    expect(recuarPorNotaCancelada(faturados, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 300 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 100 }], 'faturado', 400))
      .toMatchObject({ ok: true, status: 'aprovado', valor_faturado_centavos: 0 });
    expect(recuarPorNotaCancelada(faturados, [{ sequencia: 1, quantidade: 30_000, valor_centavos: 300 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 100 }], 'faturado', 450))
      .toMatchObject({ ok: false, codigo: 'valor_faturado_incoerente' });
  });
  it('RN-PED-02: valor da nota acima do faturado é recusado', () => {
    expect(recuarPorNotaCancelada(faturados, [{ sequencia: 1, quantidade: 10_000, valor_centavos: 500 }], 'faturado', 400)).toMatchObject({ ok: false, codigo: 'valor_acima_do_faturado' });
  });
  it('RN-PED-02: as recusas de aplicarNotaCancelada valem no recuo', () => {
    expect(recuarPorNotaCancelada(faturados, [{ sequencia: 2, quantidade: 1 }], 'aprovado', 0)).toMatchObject({ ok: false, codigo: 'status_invalido' });
    expect(recuarPorNotaCancelada(faturados, [{ sequencia: 2, quantidade: 10_001 }], 'faturado', 400)).toMatchObject({ ok: false, codigo: 'quantidade_acima_do_faturado' });
  });
});
