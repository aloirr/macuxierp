import { describe, expect, it } from 'vitest';
import { montarNota, ratearProporcional, valorItem, xNomeDestinatario, XNOME_HOMOLOGACAO, type CalculoFiscalItem, type PedidoAprovadoMin } from './nota';

const item = (sequencia: number, quantidade: number, preco: number, desconto = 0) => ({
  sequencia,
  produto_id: `00000000-0000-4000-8000-00000000000${sequencia}`,
  produto_retrato: { codigo: `P${sequencia}`, descricao: `Produto ${sequencia}`, ncm: '22021000', unidade: 'UN', gtin: null },
  quantidade,
  preco_unitario_centavos: preco,
  desconto_centavos: desconto,
  total_centavos: valorItem(quantidade, preco) - desconto,
});
const pedido: PedidoAprovadoMin = {
  pedido_id: '00000000-0000-4000-8000-0000000000a1',
  filial_id: '00000000-0000-4000-8000-0000000000b1',
  cliente_id: '00000000-0000-4000-8000-0000000000c1',
  vendedor_id: null,
  condicao_pagamento_id: null,
  emitido_em: '2026-11-21T14:00:00.000Z',
  observacao: null,
  frete_centavos: 1000,
  itens: [item(1, 30_000, 1000, 300), item(2, 10_000, 2500)],
  total_centavos: 0,
};
const calc = (sequencia: number, extra: Partial<CalculoFiscalItem> = {}): CalculoFiscalItem => ({
  sequencia,
  cfop: '5102',
  icms: { orig: 0, cst: '00', vbc_centavos: 1000, aliquota_pct: 20, valor_centavos: 200 },
  ipi_centavos: 0,
  st_centavos: 0,
  pis_centavos: 10,
  cofins_centavos: 46,
  ibs_cbs: null,
  imposto_seletivo: null,
  ...extra,
});
const situacao = (status = 'aprovado', f1 = 0, f2 = 0) => ({
  status,
  itens: [
    { sequencia: 1, quantidade: 30_000, quantidade_faturada: f1 },
    { sequencia: 2, quantidade: 10_000, quantidade_faturada: f2 },
  ],
});
const base = { pedido, ambiente: 'producao' as const, calculo: [calc(1), calc(2)] };

describe('montar nota a partir do pedido aprovado', () => {
  it('RF-FAT-01: valor do item = arred(qtd4 × preço / 10^4), meio para cima', () => {
    expect(valorItem(10_000, 1999)).toBe(1999);
    expect(valorItem(15_000, 333)).toBe(500); // 499,5
    expect(valorItem(1, 5000)).toBe(1); // 0,5
    expect(valorItem(1, 4999)).toBe(0);
  });
  it('RF-FAT-01: nota total usa o saldo de todos os itens e soma os totais', () => {
    const r = montarNota({ ...base, situacao: situacao() });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.itens.map((i) => i.quantidade)).toEqual([30_000, 10_000]);
    expect(r.nota.totais.vProd).toBe(3000 + 2500);
    expect(r.nota.totais.vDesc).toBe(300);
    expect(r.nota.totais.vFrete).toBe(1000);
    expect(r.nota.totais.vNF).toBe(5500 - 300 + 1000);
    expect(r.nota.totais.vICMS).toBe(400);
  });
  it('RF-FAT-01: parcial respeita o saldo e rateia o desconto pela quantidade', () => {
    const r = montarNota({ ...base, situacao: situacao('faturado_parcial', 10_000, 0), itens: [{ sequencia: 1, quantidade: 10_000 }], calculo: [calc(1)] });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.itens[0]).toMatchObject({ valor_produto_centavos: 1000, desconto_centavos: 100 });
    expect(r.nota.totais.vFrete).toBe(Math.round((1000 * 1000) / 5500)); // 182, proporcional ao valor da nota
  });
  it('RN-CORE-03: 3 notas parciais pelo acumulado somam exatamente desconto e frete do pedido', () => {
    const p3: PedidoAprovadoMin = { ...pedido, frete_centavos: 1001, itens: [item(1, 30_000, 333, 100), item(2, 10_000, 2500)] };
    const fatias: [number, number][] = [
      [10_000, 3_333],
      [10_000, 3_333],
      [10_000, 3_334],
    ];
    let fat1 = 0;
    let fat2 = 0;
    let desc = 0;
    let frete = 0;
    fatias.forEach(([q1, q2]) => {
      const itens = [{ sequencia: 1, quantidade: q1 }, { sequencia: 2, quantidade: q2 }];
      const r = montarNota({ ...base, pedido: p3, situacao: situacao('faturado_parcial', fat1, fat2), itens });
      if (!r.ok) throw new Error(JSON.stringify(r.violacoes));
      desc += r.nota.totais.vDesc;
      frete += r.nota.totais.vFrete;
      fat1 += q1;
      fat2 += q2;
    });
    expect(desc).toBe(100);
    expect(frete).toBe(1001);
  });
  it('RF-FAT-01: recusa quantidade acima do saldo, item inexistente, repetido e pedido sem saldo', () => {
    const acima = montarNota({ ...base, situacao: situacao('aprovado', 25_000), itens: [{ sequencia: 1, quantidade: 6_000 }], calculo: [calc(1)] });
    expect(acima.ok).toBe(false);
    const inex = montarNota({ ...base, situacao: situacao(), itens: [{ sequencia: 9 }] });
    expect(!inex.ok && inex.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'itens.9' });
    const rep = montarNota({ ...base, situacao: situacao(), itens: [{ sequencia: 1 }, { sequencia: 1 }], calculo: [calc(1)] });
    expect(rep.ok).toBe(false);
    const zerado = montarNota({ ...base, situacao: situacao('aprovado', 30_000, 10_000) });
    expect(!zerado.ok && zerado.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'itens' });
  });
  it('RN-PED-02: só pedido aprovado ou faturado_parcial é faturado', () => {
    for (const s of ['cancelado', 'recebido', 'em_analise', 'recusado', 'faturado']) {
      const r = montarNota({ ...base, situacao: situacao(s) });
      expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RN-PED-02' });
    }
  });
  it('RF-FAT-01: sem cálculo fiscal do item a nota não monta', () => {
    const r = montarNota({ ...base, situacao: situacao(), calculo: [calc(1)] });
    expect(!r.ok && r.violacoes[0]?.campo).toBe('itens.2.calculo');
  });
  it('RN-CORE-03: frete, desconto e outras rateados sem perder centavo', () => {
    expect(ratearProporcional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(ratearProporcional(10, [0, 0])).toEqual([5, 5]);
    for (const total of [0, 1, 7, 999, 12_345]) {
      const partes = ratearProporcional(total, [333, 500, 167, 1]);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(total);
    }
    const r = montarNota({ ...base, situacao: situacao(), outras_centavos: 101 });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.totais.vOutro).toBe(101);
    expect(r.nota.totais.vFrete).toBe(1000);
  });
  it('RN-CORE-03: totais da nota somam o cálculo fiscal, incluindo IBS/CBS/IS informativos', () => {
    const ibs = { cst: '000', cclasstrib: '000001', vbc_centavos: 1000, ibs_centavos: 1, cbs_centavos: 9 };
    const r = montarNota({ ...base, situacao: situacao(), calculo: [calc(1, { ibs_cbs: ibs, ipi_centavos: 50 }), calc(2, { ibs_cbs: ibs })] });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.totais).toMatchObject({ vIBS: 2, vCBS: 18, vIPI: 50, vNF: 5500 - 300 + 1000 + 50 });
  });
  it('RN-FAT-04: homologação troca o xNome do destinatário e não vai ao FDV', () => {
    expect(xNomeDestinatario('homologacao', 'CLIENTE X')).toBe(XNOME_HOMOLOGACAO);
    expect(xNomeDestinatario('producao', 'CLIENTE X')).toBe('CLIENTE X');
    const h = montarNota({ ...base, ambiente: 'homologacao', situacao: situacao() });
    const p = montarNota({ ...base, situacao: situacao() });
    expect(h.ok && h.nota.vai_ao_fdv).toBe(false);
    expect(p.ok && p.nota.vai_ao_fdv).toBe(true);
  });
});
