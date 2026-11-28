import { describe, expect, it } from 'vitest';
import { itemParaEmissao } from './itens-emissao';
import { calc, itemPedido } from './fixtures';
import { montarNota } from './nota';
import type { ItemResultado } from '@macuxierp/fiscal/contracts';

function item(extra: Partial<ItemResultado>, cfop = '5102') {
  const pedido = { sequencia: 1, quantidade: 20_000, quantidade_faturada: 0 };
  const r = montarNota({
    pedido: { ...pedidoBase(), },
    situacao: { status: 'aprovado', itens: [pedido] },
    ambiente: 'homologacao',
    calculo: [calc(1, extra, cfop)],
  });
  if (!r.ok) throw new Error('nota');
  return itemParaEmissao(r.nota.itens[0]!);
}
import { pedidoAprovado } from './fixtures';
const pedidoBase = () => pedidoAprovado([itemPedido(1, 20_000, 1000)]);
const campos = (r: ReturnType<typeof item>) => (r.ok ? [] : r.violacoes.map((v) => v.campo));

const ipiRegra = { regra_aplicada: { st: false, ipi: true }, calc_ipi: { v_bc: 1000, p_aliq: 50_000, v_valor: 50 } } as const;
describe('IPI do item (calc_ipi do fiscal → imposto.IPI do emissor)', () => {
  it('RN-FIS-05: calc_ipi vira IPITrib (v_bc → vBC, p_aliq → pIPI em %, v_valor → vIPI) com a CST e o cEnq do grupo ipi', () => {
    const r = item({ ...ipiRegra, ipi: { cst: '50', c_enq: '301' } });
    expect(r.ok && r.item.imposto.IPI).toEqual({ cEnq: '301', IPITrib: { CST: '50', vBC: 1000, pIPI: '5.0000', vIPI: 50 } });
  });
  it('RN-FIS-05: sem cEnq no cálculo, o enquadramento é "999"', () => {
    const r = item({ ...ipiRegra, ipi: { cst: '99' } });
    expect(r.ok && r.item.imposto.IPI?.cEnq).toBe('999');
  });
  it('RN-FIS-05: CST não tributada (IPINT) sem valor passa; com valor é violação', () => {
    const nt = item({ regra_aplicada: { st: false, ipi: true }, calc_ipi: { v_bc: 0, p_aliq: 0, v_valor: 0 }, ipi: { cst: '53' } });
    expect(nt.ok && nt.item.imposto.IPI).toEqual({ cEnq: '999', IPINT: { CST: '53' } });
    expect(campos(item({ ...ipiRegra, ipi: { cst: '53' } }))).toEqual(['itens.1.ipi']);
  });
  it('RF-FAT-01: regra de IPI sem CST, ou IPI com valor sem regra aplicada, é violação antes da reserva do número', () => {
    expect(campos(item(ipiRegra))).toEqual(['itens.1.ipi']);
    expect(campos(item({ ipi: { cst: '50', c_enq: '999', v_bc: 1000, p_ipi: 50_000, v_ipi: 50 } }))).toEqual(['itens.1.ipi']);
  });
  it('RN-FIS-05: sem regra e sem valor não há grupo IPI', () => {
    const r = item({});
    expect(r.ok && r.item.imposto).not.toHaveProperty('IPI');
  });
  it('RN-CORE-03: o vIPI do calc_ipi entra no vNF e o total é a soma dos itens', () => {
    const pedido = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
    const sit = { status: 'aprovado' as const, itens: [1, 2].map((s) => ({ sequencia: s, quantidade: s === 1 ? 20_000 : 10_000, quantidade_faturada: 0 })) };
    const a = montarNota({ pedido, situacao: sit, ambiente: 'homologacao', calculo: [calc(1), calc(2)] });
    const b = montarNota({ pedido, situacao: sit, ambiente: 'homologacao', calculo: [calc(1, { ...ipiRegra, ipi: { cst: '50' } }), calc(2, { ...ipiRegra, ipi: { cst: '50' } })] });
    if (!a.ok || !b.ok) throw new Error('nota');
    expect(b.nota.totais.vIPI).toBe(100);
    expect(b.nota.totais.vNF - a.nota.totais.vNF).toBe(100);
    expect(b.nota.itens.reduce((t, i) => t + (itemParaEmissao(i).ok ? 50 : 0), 0)).toBe(b.nota.totais.vIPI);
  });
});

describe('item da nota no formato da NotaParaEmissao', () => {
  it('RF-FAT-01: ICMS 00, PIS e COFINS viram o grupo do emissor, em centavos e com a alíquota em % de 4 casas', () => {
    const r = item({});
    expect(r.ok && r.item).toMatchObject({ qCom: '2.0000', vUnCom: '10.00', vProd: 2000, imposto: { ICMS: { CST: '00', pICMS: '20.0000' }, COFINS: { CST: '01', aliquota: '7.6000', valor: 46 } } });
  });
  it('RF-FAT-01: CFOP ausente é violação do item', () => {
    expect(campos(item({}, ''))).toEqual(['itens.1.cfop']);
  });
  it('RF-FAT-01: CST de ICMS que o emissor não monta (10, 20) e CSOSN 500/900 são violação antes da reserva do número', () => {
    expect(campos(item({ icms: { orig: '0', cst: '10', v_bc: 1, p_icms: 1, v_icms: 1 } }))).toEqual(['itens.1.icms']);
    expect(campos(item({ icms: { orig: '0', csosn: '500' } }))).toEqual(['itens.1.icms']);
  });
  it('RF-FAT-01: CSOSN 102 sem PIS/COFINS no cálculo (MEI) vira PIS/COFINS 99 zerado', () => {
    const r = item({ icms: { orig: '0', csosn: '102' }, pis: undefined, cofins: undefined });
    expect(r.ok && r.item.imposto).toMatchObject({ ICMS: { CSOSN: '102' }, PIS: { CST: '99', vBC: 0, valor: 0 }, COFINS: { CST: '99' } });
  });
  it('RF-FAT-01: PIS CST 03 (por quantidade) é violação; PIS CST 04 passa sem valor', () => {
    expect(campos(item({ pis: { cst: '03' } }))).toEqual(['itens.1.pis']);
    expect(item({ pis: { cst: '04' } }).ok).toBe(true);
  });
  it('RN-FIS-03: o grupo ibs_cbs do cálculo (NT 2025.002-RTC) vai ao emissor, sem trava no faturamento', () => {
    const r = item({
      ibs_cbs: { cst: '000', c_class_trib: '000001', v_bc: 1000, g_ibs_uf: { p_ibs_uf: 1000, v_ibs_uf: 1 }, g_ibs_mun: { p_ibs_mun: 0, v_ibs_mun: 0 }, g_cbs: { p_cbs: 9000, v_cbs: 9 }, v_ibs: 1 },
    });
    expect(r.ok && r.item.imposto.IBSCBS).toEqual({ CST: '000', cClassTrib: '000001', gIBSCBS: { vBC: 1000, pIBSUF: '0.1000', vIBSUF: 1, pIBSMun: '0.0000', vIBSMun: 0, pCBS: '0.9000', vCBS: 9 } });
  });
});
