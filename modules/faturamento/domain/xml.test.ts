import { describe, expect, it } from 'vitest';
import { montarChave } from './chave';
import type { ItemResultado } from '@macuxierp/fiscal/contracts';
import { calc, itemPedido, pedidoAprovado } from './fixtures';
import { montarNota, XNOME_HOMOLOGACAO, type ItemCalculado, type NotaItemMontado } from './nota';
import { ErroViolacao } from './violacao';
import { dhEmiManaus, dinheiroXml, escaparXml, gerarXmlNFe, quantidadeXml, type DadosXml } from './xml';

const calculo: ItemCalculado = calc(1, {
  icms: { orig: '0', cst: '00', mod_bc: 3, v_bc: 2000, p_icms: 200_000, v_icms: 400 },
  pis: { cst: '01', v_bc: 2000, p_aliq: 16_500, v_valor: 33 },
  cofins: { cst: '01', v_bc: 2000, p_aliq: 76_000, v_valor: 152 },
  ibs: { cst: '000', c_class_trib: '000001', v_bc: 2000, v_ibs_uf: 2, v_cbs: 18 },
});
const pedido = pedidoAprovado([
  { ...itemPedido(1, 20_000, 1000), produto_retrato: { codigo: 'REF-001', descricao: 'Refrigerante <Cola> & "Cia"', ncm: '2202.10.00', unidade_comercial: 'UN', ean: null } },
]);
const endereco = { logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio_ibge: '1302603', municipio_nome: 'Manaus', uf: 'AM', cep: '69000-000' };

function dados(ambiente: 'homologacao' | 'producao'): DadosXml {
  const r = montarNota({ pedido, situacao: { status: 'aprovado', itens: [{ sequencia: 1, quantidade: 20_000, quantidade_faturada: 0 }] }, ambiente, calculo: [calculo] });
  if (!r.ok) throw new Error('nota');
  const chave = montarChave({ aamm: '2611', cnpj: '11222333000181', serie: 1, numero: 123, tpEmis: 1, cnf: '12345678' });
  return {
    chave,
    cnf: '12345678',
    tpEmis: 1,
    natOp: 'VENDA',
    serie: 1,
    numero: 123,
    emitida_em: new Date('2026-11-21T14:30:00Z'),
    verProc: 'macuxierp-0.1',
    emitente: { cnpj: '11.222.333/0001-81', nome: 'EMITENTE LTDA', ie: '012345679', crt: 3, endereco },
    destinatario: { documento: '45.723.174/0001-10', nome: 'CLIENTE & FILHOS', ind_ie_dest: 1, ie: '04.123.456-1', endereco },
    nota: r.nota,
    pagamentos: [{ tPag: '15', valor_centavos: 2000 }],
    infCpl: 'Pedido <1>',
    habilitarIbsCbs: true, // só em teste: em produção os grupos IBS/CBS/IS aguardam a T-0020
  };
}

describe('XML da NF-e 4.00', () => {
  it('RN-FAT-02: determinístico, mesma entrada gera os mesmos bytes', () => {
    expect(gerarXmlNFe(dados('producao'))).toBe(gerarXmlNFe(dados('producao')));
  });
  it('RN-FAT-01: Id da infNFe = "NFe" + chave, cDV e nNF coerentes com a chave', () => {
    const x = gerarXmlNFe(dados('producao'));
    expect(x).toContain('Id="NFe13261111222333000181550010000001231123456780"');
    expect(x).toContain('<cDV>0</cDV>');
    expect(x).toContain('<nNF>123</nNF>');
    expect(x).toContain('<cNF>12345678</cNF>');
    expect(x).toContain('<dhEmi>2026-11-21T10:30:00-04:00</dhEmi>');
  });
  it('RF-FAT-01: traz ide, emit, dest, det, total, transp, pag e infAdic', () => {
    const x = gerarXmlNFe(dados('producao'));
    for (const tag of ['<ide>', '<emit>', '<dest>', '<det nItem="1">', '<imposto>', '<total>', '<ICMSTot>', '<transp>', '<pag>', '<infAdic>']) expect(x).toContain(tag);
    expect(x).toContain('<vProd>20.00</vProd>');
    expect(x).toContain('<qCom>2.0000</qCom>');
    expect(x).toContain('<vNF>20.00</vNF>');
    expect(x).toContain('<CNPJ>45723174000110</CNPJ>');
    expect(x).toContain('<tpAmb>1</tpAmb>');
    expect(x).toContain('<idDest>1</idDest>');
  });
  it('RF-FAT-01: escapa caracteres especiais do XML', () => {
    const x = gerarXmlNFe(dados('producao'));
    expect(x).toContain('<xProd>Refrigerante &lt;Cola&gt; &amp; &quot;Cia&quot;</xProd>');
    expect(x).toContain('<infCpl>Pedido &lt;1&gt;</infCpl>');
    expect(escaparXml("a\u0001b'c")).toBe('ab&apos;c');
  });
  it('RN-FAT-04: homologação usa o xNome do Manual no destinatário e tpAmb 2', () => {
    const x = gerarXmlNFe(dados('homologacao'));
    expect(x).toContain(`<dest><CNPJ>45723174000110</CNPJ><xNome>${XNOME_HOMOLOGACAO}</xNome>`);
    expect(x).toContain('<tpAmb>2</tpAmb>');
  });
  it('RF-FAT-01: IBS/CBS entram quando o cálculo os traz e saem quando não', () => {
    const com = gerarXmlNFe(dados('producao'));
    expect(com).toContain('<IBSCBS>');
    expect(com).toContain('<IBSCBSTot><vIBS>0.02</vIBS><vCBS>0.18</vCBS></IBSCBSTot>');
    const d = dados('producao');
    (d.nota.itens[0] as NotaItemMontado).calculo = { ...calculo, resultado: { ...calculo.resultado, ibs: undefined } };
    d.nota.totais.vIBS = 0;
    d.nota.totais.vCBS = 0;
    const sem = gerarXmlNFe(d);
    expect(sem).not.toContain('IBSCBS');
  });
  it('RF-FAT-01: sem a flag, item com IBS/CBS/IS gera violação "aguardando leiaute NT 2025.002 (T-0020)" e nenhum XML sai', () => {
    const d = { ...dados('producao'), habilitarIbsCbs: undefined };
    expect(() => gerarXmlNFe(d)).toThrow(/aguardando leiaute NT 2025\.002 \(T-0020\)/);
    const is = { cst_is: '000', c_class_trib_is: '000001', v_bc_is: 2000, p_is: 10_000, v_is: 20 };
    expect(() => gerarXmlNFe({ ...comCalculo({ ibs: undefined, is }), habilitarIbsCbs: false })).toThrow(/T-0020/);
  });
  it('RF-FAT-01: PIS/COFINS por CST: 01/02 Aliq, 04 a 09 NT com a CST informada, 49 a 99 Outr, 03 violação', () => {
    const sem = { ibs: undefined };
    const nt = gerarXmlNFe(comCalculo({ ...sem, pis: { cst: '07' }, cofins: { cst: '04' } }, (d) => {
      d.nota.totais.vPIS = 0;
      d.nota.totais.vCOFINS = 0;
    }));
    expect(nt).toContain('<PIS><PISNT><CST>07</CST></PISNT></PIS>');
    expect(nt).toContain('<COFINS><COFINSNT><CST>04</CST></COFINSNT></COFINS>');
    const outr = gerarXmlNFe(comCalculo({ ...sem, pis: { cst: '99', v_bc: 2000, p_aliq: 16_500, v_valor: 33 } }));
    expect(outr).toContain('<PISOutr><CST>99</CST><vBC>20.00</vBC><pPIS>1.6500</pPIS><vPIS>0.33</vPIS></PISOutr>');
    expect(gerarXmlNFe(comCalculo({ ...sem, pis: { cst: '02', v_bc: 2000, p_aliq: 16_500, v_valor: 33 } }))).toContain('<PISAliq><CST>02</CST>');
    expect(() => gerarXmlNFe(comCalculo({ ...sem, pis: { cst: '03', v_bc: 2000, p_aliq: 16_500, v_valor: 33 } }))).toThrow(/CST 03/);
    expect(() => gerarXmlNFe(comCalculo({ ...sem, cofins: { cst: '03' } }))).toThrow(/COFINS CST 03/);
    expect(() => gerarXmlNFe(comCalculo({ ...sem, pis: { cst: '20' } }))).toThrow(/sem suporte/);
  });
  it('RN-CORE-03: formatação em inteiros, sem float', () => {
    expect(dinheiroXml(5)).toBe('0.05');
    expect(dinheiroXml(123456)).toBe('1234.56');
    expect(quantidadeXml(15_001)).toBe('1.5001');
    expect(dhEmiManaus(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11-30T22:00:00-04:00');
  });
  it('RF-FAT-01: cProd vem do código do produto no retrato e PIS/COFINS levam base e alíquota', () => {
    const x = gerarXmlNFe(dados('producao'));
    expect(x).toContain('<cProd>REF-001</cProd>');
    expect(x).toContain('<PISAliq><CST>01</CST><vBC>20.00</vBC><pPIS>1.6500</pPIS><vPIS>0.33</vPIS></PISAliq>');
    expect(x).toContain('<pCOFINS>7.6000</pCOFINS>');
  });
  const comCalculo = (parcial: Partial<ItemResultado>, ajusta?: (d: DadosXml) => void): DadosXml => {
    const d = dados('producao');
    (d.nota.itens[0] as NotaItemMontado).calculo = { ...calculo, resultado: { ...calculo.resultado, ...parcial } };
    ajusta?.(d);
    return d;
  };
  const icms = calculo.resultado.icms;
  it('RF-FAT-01: não gera XML que a SEFAZ rejeitaria (CSOSN sem suporte, ICMS sem CST, CST sem suporte, campos que o contrato não traz)', () => {
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...icms, cst: undefined, csosn: '500' } }))).toThrow(ErroViolacao);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...icms, cst: undefined } }))).toThrow(/sem CST/);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...icms, cst: '60' } }))).toThrow(/sem suporte/);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...icms, cst: undefined, csosn: '101' } }))).toThrow(/p_cred_sn/);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...icms, cst: '00', v_bc: undefined } }))).toThrow(/v_bc/);
    expect(() => gerarXmlNFe(comCalculo({}, (d) => ((d.nota.itens[0] as NotaItemMontado).calculo.cfop = '')))).toThrow(/CFOP/);
    const ok102 = gerarXmlNFe(comCalculo({ icms: { ...icms, cst: undefined, csosn: '400' } }));
    expect(ok102).toContain('<ICMSSN102><orig>0</orig><CSOSN>400</CSOSN></ICMSSN102>');
    const ok101 = gerarXmlNFe(comCalculo({ icms: { ...icms, cst: undefined, csosn: '101', p_cred_sn: 12_500, v_cred_icms_sn: 25 } }));
    expect(ok101).toContain('<pCredSN>1.2500</pCredSN><vCredICMSSN>0.25</vCredICMSSN>');
  });
  it('RF-FAT-01: ICMS 00 usa a alíquota do cálculo (décimos de milésimo de ponto percentual) e CST 40/41/50 saem sem base', () => {
    expect(gerarXmlNFe(dados('producao'))).toContain('<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>20.00</vBC><pICMS>20.0000</pICMS><vICMS>4.00</vICMS></ICMS00>');
    const x = gerarXmlNFe(comCalculo({ icms: { orig: '1', cst: '41' } }));
    expect(x).toContain('<ICMS40><orig>1</orig><CST>41</CST></ICMS40>');
  });
  it('RF-FAT-01: ICMS-ST (CST 10 e CSOSN 201/202) leva o grupo ST e os totais vBCST/vST/vFCPST; sem o grupo, violação', () => {
    const st = { mod_bc_st: 4, p_mva_st: 400_000, v_bc_st: 3000, p_icms_st: 200_000, v_icms_st: 200, v_fcp_st: 5, v_bc_fcp_st: 3000, p_fcp_st: 20_000 };
    const x = gerarXmlNFe(comCalculo({ icms: { ...icms, cst: '10', ...st } }, (d) => {
      d.nota.totais.vBCST = 3000;
      d.nota.totais.vST = 200;
      d.nota.totais.vFCPST = 5;
      d.nota.totais.vNF += 205;
      d.pagamentos = [{ tPag: '15', valor_centavos: d.nota.totais.vNF }];
    }));
    expect(x).toContain('<modBCST>4</modBCST><pMVAST>40.0000</pMVAST><vBCST>30.00</vBCST><pICMSST>20.0000</pICMSST><vICMSST>2.00</vICMSST><vBCFCPST>30.00</vBCFCPST><pFCPST>2.0000</pFCPST><vFCPST>0.05</vFCPST>');
    expect(x).toContain('<vBCST>30.00</vBCST><vST>2.00</vST><vFCPST>0.05</vFCPST>');
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...icms, cst: '10' } }))).toThrow(/v_bc_st/);
    expect(gerarXmlNFe(comCalculo({ icms: { orig: '0', csosn: '202', ...st } }))).toContain('<ICMSSN202><orig>0</orig><CSOSN>202</CSOSN>');
    expect(() => gerarXmlNFe(comCalculo({ icms: { orig: '0', csosn: '201', ...st } }))).toThrow(/p_cred_sn/);
  });
  it('RF-FAT-01: IPI com valor exige o grupo IPI completo e o gera; PIS/COFINS com valor exigem CST, base e alíquota', () => {
    const ipiOk = (d: DadosXml): void => {
      d.nota.totais.vIPI = 100;
      d.nota.totais.vNF += 100;
      d.pagamentos = [{ tPag: '15', valor_centavos: d.nota.totais.vNF }];
    };
    expect(() => gerarXmlNFe(comCalculo({ ipi: { v_ipi: 100 } }, ipiOk))).toThrow(/IPI/);
    const x = gerarXmlNFe(comCalculo({ ipi: { cst: '50', c_enq: '999', v_bc: 2000, p_ipi: 50_000, v_ipi: 100 } }, ipiOk));
    expect(x).toContain('<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>20.00</vBC><pIPI>5.0000</pIPI><vIPI>1.00</vIPI></IPITrib></IPI>');
    expect(() => gerarXmlNFe(comCalculo({ pis: { v_valor: 33 } }))).toThrow(/PIS/);
    expect(() => gerarXmlNFe(comCalculo({ cofins: { v_valor: 152 } }))).toThrow(/COFINS/);
  });
  it('RF-FAT-01: IS e IBS/CBS completos saem no item; sem CST/cClassTrib, violação', () => {
    const is = { cst_is: '000', c_class_trib_is: '000001', v_bc_is: 2000, p_is: 10_000, v_is: 20 };
    const x = gerarXmlNFe(comCalculo({ is }, (d) => (d.nota.totais.vIS = 20)));
    expect(x).toContain('<IS><CSTIS>000</CSTIS><cClassTribIS>000001</cClassTribIS><vBCIS>20.00</vBCIS><pIS>1.0000</pIS><vIS>0.20</vIS></IS>');
    expect(x).toContain('<ISTot><vIS>0.20</vIS></ISTot>');
    expect(() => gerarXmlNFe(comCalculo({ ibs: { v_bc: 2000 } }))).toThrow(/IBS\/CBS/);
  });
  it('RF-FAT-01: a soma dos vPag deve bater com o vNF e a chave deve ser válida', () => {
    expect(() => gerarXmlNFe({ ...dados('producao'), pagamentos: [{ tPag: '15', valor_centavos: 1999 }] })).toThrow(/vPag/);
    expect(() => gerarXmlNFe({ ...dados('producao'), chave: '13261111222333000181550010000001231123456781' })).toThrow(/Chave/);
  });
  it('RN-FAT-01: CNPJ alfanumérico do emitente e do destinatário não perde letras; IE e CPF só dígitos', () => {
    const d = dados('producao');
    const chave = montarChave({ aamm: '2611', cnpj: '12ABC34501DE35', serie: 1, numero: 123, tpEmis: 1, cnf: '12345678' });
    const x = gerarXmlNFe({
      ...d,
      chave,
      emitente: { ...d.emitente, cnpj: '12.ABC.345/01DE-35' },
      destinatario: { ...d.destinatario, documento: '98.XYZ.765/00AB-12' },
    });
    expect(x).toContain('<emit><CNPJ>12ABC34501DE35</CNPJ>');
    expect(x).toContain('<dest><CNPJ>98XYZ76500AB12</CNPJ>');
    expect(x).toContain('<IE>012345679</IE>');
    const cpf = gerarXmlNFe({ ...d, destinatario: { ...d.destinatario, documento: '123.456.789-09', ind_ie_dest: 9, ie: null } });
    expect(cpf).toContain('<CPF>12345678909</CPF>');
  });
  it('RF-FAT-01: indFinal 0 em venda a contribuinte (ind_ie_dest 1) e 1 nos demais casos', () => {
    const d = dados('producao');
    expect(gerarXmlNFe(d)).toContain('<indFinal>0</indFinal>');
    for (const ind of [2, 9] as const) {
      expect(gerarXmlNFe({ ...d, destinatario: { ...d.destinatario, ind_ie_dest: ind } })).toContain('<indFinal>1</indFinal>');
    }
    expect(gerarXmlNFe({ ...d, indFinal: 1 })).toContain('<indFinal>1</indFinal>');
  });
});
