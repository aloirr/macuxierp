import { describe, expect, it } from 'vitest';
import type { IcmsItem, ItemResultado } from '@macuxierp/fiscal/contracts';
import { valorItem } from '@macuxierp/platform-sdk';
import { calc, itemPedido, pedidoAprovado } from './fixtures';
import { cfopDoItem, resumoDoItem, montarNota, ratearProporcional, valoresFiscais, type SituacaoPedido } from './nota';

const item = itemPedido;
const pedido = pedidoAprovado([item(1, 30_000, 1000, 300), item(2, 10_000, 2500)]);
const situacao = (status: SituacaoPedido['status'] = 'aprovado', f1 = 0, f2 = 0) => ({
  status,
  itens: [
    { sequencia: 1, quantidade: 30_000, quantidade_faturada: f1 },
    { sequencia: 2, quantidade: 10_000, quantidade_faturada: f2 },
  ],
});
const base = { pedido, ambiente: 'producao' as const, calculo: [calc(1), calc(2)], frete_centavos: 1000 };

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
    const p3 = pedidoAprovado([item(1, 30_000, 333, 100), item(2, 10_000, 2500)]);
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
      const r = montarNota({ ...base, pedido: p3, frete_centavos: 1001, situacao: situacao('faturado_parcial', fat1, fat2), itens });
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
  it('RN-FAT-01/RF-FAT-01: a 2ª nota acima do saldo é recusada pelas notas do próprio faturamento, mesmo com o pedido sem consumir a 1ª', () => {
    const ja = new Map([[1, 30_000], [2, 4_000]]);
    // o pedido ainda diz 0 faturado; a soma das notas manda
    const total = montarNota({ ...base, situacao: situacao('aprovado', 0, 0), ja_faturadas: ja });
    if (!total.ok) throw new Error('esperava ok');
    expect(total.nota.itens.map((i) => [i.sequencia, i.quantidade])).toEqual([[2, 6_000]]);
    const acima = montarNota({ ...base, situacao: situacao('aprovado', 0, 0), ja_faturadas: ja, itens: [{ sequencia: 1, quantidade: 1 }], calculo: [calc(1)] });
    expect(!acima.ok && acima.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'itens.1.quantidade' });
    // vale o maior: o pedido já consumiu mais que as notas
    const maior = montarNota({ ...base, situacao: situacao('faturado_parcial', 30_000, 0), ja_faturadas: new Map([[1, 10_000]]), itens: [{ sequencia: 1, quantidade: 1 }], calculo: [calc(1)] });
    expect(maior.ok).toBe(false);
  });
  it('RN-PED-02: só pedido aprovado ou faturado_parcial é faturado', () => {
    for (const s of ['cancelado', 'recebido', 'em_analise', 'recusado', 'faturado'] as const) {
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
  it('RN-CORE-03: totais da nota somam o cálculo fiscal, incluindo IPI e IBS/CBS informativos', () => {
    const ibs = { cst: '000', c_class_trib: '000001', v_bc: 1000, v_ibs_uf: 1, v_cbs: 9 };
    const ipi = { cst: '50', c_enq: '999', v_bc: 1000, p_ipi: 50_000, v_ipi: 50 };
    const r = montarNota({ ...base, situacao: situacao(), calculo: [calc(1, { ibs, ipi }), calc(2, { ibs })] });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.totais).toMatchObject({ vIBS: 2, vCBS: 18, vIPI: 50, vNF: 5500 - 300 + 1000 + 50 });
  });
  it('RN-CORE-03: vNF soma o ICMS-ST e o FCP-ST do cálculo (mesma fórmula do fiscal.calculo@1)', () => {
    const st = { orig: '0' as const, cst: '10', v_bc: 1000, p_icms: 200_000, v_icms: 200, mod_bc_st: 4, v_bc_st: 1500, p_icms_st: 200_000, v_icms_st: 100, v_fcp_st: 5 };
    const r = montarNota({ ...base, situacao: situacao(), calculo: [calc(1, { icms: st }), calc(2)] });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.totais).toMatchObject({ vST: 100, vBCST: 1500, vFCPST: 5, vNF: 5500 - 300 + 1000 + 100 + 5 });
  });
  it('RN-FAT-01: valoresFiscais soma só o que o XML emite em cada CST/CSOSN (CST 40 e CSOSN 102 sem vBC/vICMS; vST só em CST 10 e CSOSN 201/202/203; PIS/COFINS NT sem valor)', () => {
    const r = (icms: Omit<IcmsItem, 'orig'>, extra: Partial<ItemResultado> = {}) => valoresFiscais(calc(1, { icms: { orig: '0', ...icms }, ...extra }).resultado);
    expect(r({ cst: '40', v_bc: 1000, v_icms: 200, v_icms_st: 50, v_fcp: 3 })).toMatchObject({ vBC: 0, vICMS: 0, vST: 0, vFCP: 0 });
    expect(r({ csosn: '102', v_bc: 1000, v_icms: 200 })).toMatchObject({ vBC: 0, vICMS: 0 });
    expect(r({ cst: '00', v_bc: 1000, v_icms: 200, v_icms_st: 50 })).toMatchObject({ vBC: 1000, vICMS: 200, vST: 0 });
    expect(r({ csosn: '202', v_bc_st: 900, v_icms_st: 50, v_fcp_st: 2, v_icms: 7 })).toMatchObject({ vBCST: 900, vST: 50, vFCPST: 2, vICMS: 0 });
    expect(r({ cst: '00', v_bc: 1 }, { pis: { cst: '07', v_valor: 9 }, cofins: { cst: '99', v_valor: 4 } })).toMatchObject({ vPIS: 0, vCOFINS: 4 });
  });
  it('RN-FAT-01: IBS/CBS/IS do lote 3 do fiscal (ibs_cbs com g_cbs e is) entram nos totais; o vNF não os soma em 2026', () => {
    const ibs_cbs = { cst: '000', c_class_trib: '000001', v_bc: 1000, v_ibs: 3, g_cbs: { p_cbs: 9000, v_cbs: 9 } };
    const is = { cst_is: '000', c_class_trib_is: '000001', v_bc_is: 1000, v_is: 5 };
    expect(valoresFiscais(calc(1, { ibs_cbs, is }).resultado)).toMatchObject({ vIBS: 3, vCBS: 9, vIS: 5 });
    const r = montarNota({ ...base, situacao: situacao(), calculo: [calc(1, { ibs_cbs, is }), calc(2)] });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.totais).toMatchObject({ vIBS: 3, vCBS: 9, vIS: 5, vNF: 5500 - 300 + 1000 });
  });
  it('RF-FAT-01: o CFOP do item vem do ItemResultado.cfop do fiscal quando existe; senão do mapa de CFOP da porta', () => {
    expect(cfopDoItem({ ...calc(1).resultado, cfop: '6102' }, '5102')).toBe('6102');
    expect(cfopDoItem(calc(1).resultado, '5102')).toBe('5102');
    expect(cfopDoItem(calc(1).resultado, undefined)).toBe('');
  });
  it('RF-FAT-01: o resumo do item (evento e consulta) é sequência, quantidade e valor líquido (produto − desconto)', () => {
    const r = montarNota({ ...base, situacao: situacao() });
    if (!r.ok) throw new Error('esperava ok');
    expect(r.nota.itens.map(resumoDoItem)).toEqual([{ sequencia: 1, quantidade: 30_000, valor_centavos: 3000 - 300 }, { sequencia: 2, quantidade: 10_000, valor_centavos: 2500 }]);
  });
  it('RF-FAT-01: vNF da nota difere do v_nf do cálculo fiscal = violação (a referência é o fiscal, RD-0283)', () => {
    const r = montarNota({ ...base, situacao: situacao(), v_nf_fiscal: 5500 - 300 + 1000 + 1 });
    expect(!r.ok && r.violacoes[0]).toMatchObject({ rn: 'RF-FAT-01', campo: 'total' });
    expect(montarNota({ ...base, situacao: situacao(), v_nf_fiscal: 5500 - 300 + 1000 }).ok).toBe(true);
  });
  it('RN-FAT-04: nota de homologação não vai ao FDV (o xNome de homologação é do emissor)', () => {
    const h = montarNota({ ...base, ambiente: 'homologacao', situacao: situacao() });
    const p = montarNota({ ...base, situacao: situacao() });
    expect(h.ok && h.nota.vai_ao_fdv).toBe(false);
    expect(p.ok && p.nota.vai_ao_fdv).toBe(true);
  });
  it('RF-FAT-01: sem frete_centavos informado, o vFrete vem do Frete.valor_centavos do pedido (nulo vale 0)', () => {
    const comFrete = pedidoAprovado([item(1, 30_000, 1000, 300), item(2, 10_000, 2500)]);
    comFrete.pedido.frete = { modalidade: 'CIF', transportadora: null, valor_centavos: 777 };
    const r = montarNota({ pedido: comFrete, ambiente: 'producao', calculo: [calc(1), calc(2)], situacao: situacao() });
    expect(r.ok && r.nota.totais.vFrete).toBe(777);
    comFrete.pedido.frete = { modalidade: 'FOB', transportadora: null, valor_centavos: null };
    const r0 = montarNota({ pedido: comFrete, ambiente: 'producao', calculo: [calc(1), calc(2)], situacao: situacao() });
    expect(r0.ok && r0.nota.totais.vFrete).toBe(0);
    const semFrete = montarNota({ pedido, ambiente: 'producao', calculo: [calc(1), calc(2)], situacao: situacao() });
    expect(semFrete.ok && semFrete.nota.totais.vFrete).toBe(0);
  });
  it('RF-FAT-01: a origem do ProdutoRetrato acompanha o item da nota', () => {
    const r = montarNota({ ...base, situacao: situacao() });
    expect(r.ok && r.nota.itens.map((i) => i.origem)).toEqual(['0', '0']);
  });
});
