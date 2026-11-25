/**
 * T-0085 (critério 3): o prazo que o ERP monta bate com o contrato do Hub dos DOIS lados, sem um conferir a si mesmo:
 * o C-6 do ERP (`PrazoPagamentoHub`, modules/integracao-fdv/contracts/hub.ts) e o oráculo do lado do FDV que o dublê usa
 * (`parcelasDiasValidas`, apoio/duble-hub.ts, do guia do integrador). Se um dos dois mudar sozinho, a tabela abaixo cai.
 * Lote 2: limite real do Hub (1 a 24 parcelas de 0 a 365 dias), descrição e prazo médio (0 a 365) obrigatórios, e o prazo
 * incompleto (RN-CAD-15, sem prazo médio) não sai; a forma sai assim mesmo.
 */
import { describe, expect, it } from 'vitest';
import { PrazoPagamentoHub } from '../../modules/integracao-fdv/contracts/index';
import { mapearCondicao, mapearCondicaoOpcional } from '../../modules/integracao-fdv/domain/mapeamento';
import { parcelasDiasValidas } from './apoio/duble-hub';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EM = '2026-11-24T20:00:00.000Z';
const BASE = { external_id: U(1), ativo: true, forma_external_id: U(2), codigo: '28-56', descricao: 'Boleto 28/56', prazo_medio_dias: 42 };
const aceitoPeloC6 = (parcelas_dias: unknown): boolean => PrazoPagamentoHub.safeParse({ ...BASE, parcelas_dias }).success;
const lista = (n: number, d = 30): number[] => Array.from({ length: n }, () => d);

describe('T-0085 — parcelas_dias: C-6 do ERP × oráculo do Hub (dublê)', () => {
  const casos: [string, unknown, boolean][] = [
    ['lista [28, 56]', [28, 56], true],
    ['à vista [0]', [0], true],
    ['limite 365', [365], true],
    ['24 parcelas', lista(24), true],
    ['25 parcelas', lista(25), false],
    ['texto "28/56" (legado)', '28/56', false],
    ['texto "0"', '0', false],
    ['número solto', 28, false],
    ['lista vazia', [], false],
    ['fração', [28.5], false],
    ['negativo', [-1], false],
    ['acima de 365', [366], false],
    ['999 (limite antigo)', [999], false],
    ['texto dentro da lista', ['28'], false],
    ['nulo', null, false],
    // P-4 (plano v0.3.12): os dois tetos juntos, na borda (C-6: .max(24) parcelas de .max(365) dias).
    ['P-4: 24 parcelas de 365 dias', lista(24, 365), true],
    ['P-4: 24 parcelas, a última com 366 dias', [...lista(23, 365), 366], false],
  ];
  it.each(casos)('%s: aceito = %s nos dois lados', (_nome, valor, esperado) => {
    expect(aceitoPeloC6(valor)).toBe(esperado);
    expect(parcelasDiasValidas(valor)).toBe(esperado);
  });
});

describe('T-0085 — prazo_medio_dias e descricao no C-6 (lote 2)', () => {
  const aceito = (o: Record<string, unknown>): boolean => PrazoPagamentoHub.safeParse({ ...BASE, parcelas_dias: [28, 56], ...o }).success;
  it.each([
    ['prazo médio 0', { prazo_medio_dias: 0 }, true],
    ['prazo médio 365', { prazo_medio_dias: 365 }, true],
    ['prazo médio 366', { prazo_medio_dias: 366 }, false],
    ['prazo médio negativo', { prazo_medio_dias: -1 }, false],
    ['prazo médio fracionado', { prazo_medio_dias: 42.5 }, false],
    ['sem prazo médio', { prazo_medio_dias: undefined }, false],
    ['sem descrição', { descricao: undefined }, false],
    ['descrição vazia', { descricao: '' }, false],
  ] as const)('%s: aceito = %s', (_nome, o, esperado) => {
    expect(aceito(o)).toBe(esperado);
  });
});

describe('T-0085 — o prazo mapeado pelo ERP passa no C-6 e no oráculo do Hub', () => {
  const condicao = (prazos_dias: number[], forma_tpag = '15', prazo_medio_dias: number | null = 42) => ({
    id: U(6),
    codigo: '28-56',
    descricao: 'Boleto 28/56',
    forma_tpag,
    prazos_dias,
    prazo_medio_dias,
    inativo: false,
    forma_codigo: null,
    forma_nome: null,
  });
  it.each([
    ['28 e 56 dias', [28, 56], '15', 42],
    ['à vista', [0], '01', 0],
    ['24 parcelas de 365 dias', lista(24, 365), '15', 365],
  ] as const)('%s', (_nome, prazos, tpag, medio) => {
    const { prazo } = mapearCondicao(condicao([...prazos], tpag, medio), EM, { tenantId: U(100), formaAtiva: true });
    expect(prazo).not.toBeNull();
    const r = PrazoPagamentoHub.safeParse(prazo!.payload);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(prazo!.payload).toMatchObject({ descricao: 'Boleto 28/56', prazo_medio_dias: medio });
    expect(parcelasDiasValidas(prazo!.payload.parcelas_dias)).toBe(true);
  });
  it.each([
    ['sem prazo médio (RN-CAD-15)', [28, 56], null],
    ['legado sem parcela', [], 0],
  ] as const)('prazo incompleto %s não sai; a forma sai', (_nome, prazos, medio) => {
    const { forma, prazo } = mapearCondicaoOpcional(condicao([...prazos], '15', medio), EM, { tenantId: U(100), formaAtiva: true });
    expect(prazo).toBeNull();
    expect(forma.entidade).toBe('forma_pagamento');
    // A assinatura antiga (#550, expande e contrai) lança erro no prazo incompleto em vez de devolver nulo.
    expect(() => mapearCondicao(condicao([...prazos], '15', medio), EM, { tenantId: U(100), formaAtiva: true })).toThrow(/RN-CAD-15/);
  });
});
