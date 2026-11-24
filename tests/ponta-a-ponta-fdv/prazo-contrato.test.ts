/**
 * T-0085 (critério 3): o prazo que o ERP monta bate com o contrato do Hub dos DOIS lados, sem um conferir a si mesmo:
 * o C-6 do ERP (`PrazoPagamentoHub`, modules/integracao-fdv/contracts/hub.ts) e o oráculo do lado do FDV que o dublê usa
 * (`parcelasDiasValidas`, apoio/duble-hub.ts, do guia do integrador). Se um dos dois mudar sozinho, a tabela abaixo cai.
 * Lote 2 (descrição e prazo médio obrigatórios, prazo incompleto não sai, cliente com prazo_medio_max_dias): casos
 * pendentes em docs/testes/plano-v0.3.12.md, seção T-0085.
 */
import { describe, expect, it } from 'vitest';
import { PrazoPagamentoHub } from '../../modules/integracao-fdv/contracts/index';
import { mapearCondicao } from '../../modules/integracao-fdv/domain/mapeamento';
import { parcelasDiasValidas } from './apoio/duble-hub';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EM = '2026-11-24T20:00:00.000Z';
const BASE = { external_id: U(1), ativo: true, forma_external_id: U(2), codigo: '28-56' };
const aceitoPeloC6 = (parcelas_dias: unknown): boolean => PrazoPagamentoHub.safeParse({ ...BASE, parcelas_dias }).success;

describe('T-0085 — parcelas_dias: C-6 do ERP × oráculo do Hub (dublê)', () => {
  const casos: [string, unknown, boolean][] = [
    ['lista [28, 56]', [28, 56], true],
    ['à vista [0]', [0], true],
    ['limite 999', [999], true],
    ['texto "28/56" (legado)', '28/56', false],
    ['texto "0"', '0', false],
    ['número solto', 28, false],
    ['lista vazia', [], false],
    ['fração', [28.5], false],
    ['negativo', [-1], false],
    ['acima de 999', [1000], false],
    ['texto dentro da lista', ['28'], false],
    ['nulo', null, false],
  ];
  it.each(casos)('%s: aceito = %s nos dois lados', (_nome, valor, esperado) => {
    expect(aceitoPeloC6(valor)).toBe(esperado);
    expect(parcelasDiasValidas(valor)).toBe(esperado);
  });
});

describe('T-0085 — o prazo mapeado pelo ERP passa no C-6 e no oráculo do Hub', () => {
  const condicao = (prazos_dias: number[], forma_tpag = '15') => ({
    id: U(6),
    codigo: '28-56',
    descricao: 'Boleto 28/56',
    forma_tpag,
    prazos_dias,
    inativo: false,
    forma_codigo: null,
    forma_nome: null,
  });
  it.each([
    ['28 e 56 dias', [28, 56], '15'],
    ['à vista', [0], '01'],
    ['legado sem parcela (vira à vista [0])', [], '01'],
  ] as const)('%s', (_nome, prazos, tpag) => {
    const { prazo } = mapearCondicao(condicao([...prazos], tpag), EM, { tenantId: U(100), formaAtiva: true });
    const r = PrazoPagamentoHub.safeParse(prazo.payload);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(parcelasDiasValidas(prazo.payload.parcelas_dias)).toBe(true);
  });
});
