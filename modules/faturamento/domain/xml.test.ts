import { describe, expect, it } from 'vitest';
import { montarChave } from './chave';
import { montarNota, XNOME_HOMOLOGACAO, type CalculoFiscalItem, type NotaItemMontado, type PedidoAprovadoMin } from './nota';
import { ErroViolacao } from './violacao';
import { dhEmiManaus, dinheiroXml, escaparXml, gerarXmlNFe, quantidadeXml, type DadosXml } from './xml';

const calculo: CalculoFiscalItem = {
  sequencia: 1,
  cfop: '5102',
  icms: { orig: 0, cst: '00', vbc_centavos: 2000, aliquota_pct: 20, valor_centavos: 400 },
  ipi_centavos: 0,
  st_centavos: 0,
  pis_centavos: 33,
  cofins_centavos: 152,
  pis: { cst: '01', vbc_centavos: 2000, aliquota_pct: 1.65 },
  cofins: { cst: '01', vbc_centavos: 2000, aliquota_pct: 7.6 },
  ibs_cbs: { cst: '000', cclasstrib: '000001', vbc_centavos: 2000, ibs_centavos: 2, cbs_centavos: 18 },
  imposto_seletivo: null,
};
const pedido: PedidoAprovadoMin = {
  pedido_id: '00000000-0000-4000-8000-0000000000a1',
  filial_id: '00000000-0000-4000-8000-0000000000b1',
  cliente_id: '00000000-0000-4000-8000-0000000000c1',
  vendedor_id: null,
  condicao_pagamento_id: null,
  emitido_em: '2026-11-21T14:00:00.000Z',
  observacao: null,
  frete_centavos: 0,
  itens: [
    {
      sequencia: 1,
      produto_id: 'abcdef12-0000-4000-8000-000000000001',
      produto_retrato: { codigo: 'REF-001', descricao: 'Refrigerante <Cola> & "Cia"', ncm: '2202.10.00', unidade: 'UN', gtin: null },
      quantidade: 20_000,
      preco_unitario_centavos: 1000,
      desconto_centavos: 0,
      total_centavos: 2000,
    },
  ],
  total_centavos: 2000,
};
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
  it('RF-FAT-01: IBS/CBS entram quando o cálculo os traz (dublê até T-0020) e saem quando não', () => {
    const com = gerarXmlNFe(dados('producao'));
    expect(com).toContain('<IBSCBS>');
    expect(com).toContain('<IBSCBSTot><vIBS>0.02</vIBS><vCBS>0.18</vCBS></IBSCBSTot>');
    const d = dados('producao');
    (d.nota.itens[0] as NotaItemMontado).calculo = { ...calculo, ibs_cbs: null };
    d.nota.totais.vIBS = 0;
    d.nota.totais.vCBS = 0;
    const sem = gerarXmlNFe(d);
    expect(sem).not.toContain('IBSCBS');
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
  const comCalculo = (parcial: Partial<CalculoFiscalItem>, ajusta?: (d: DadosXml) => void): DadosXml => {
    const d = dados('producao');
    (d.nota.itens[0] as NotaItemMontado).calculo = { ...calculo, ...parcial };
    ajusta?.(d);
    return d;
  };
  it('RF-FAT-01: não gera XML que a SEFAZ rejeitaria (CSOSN sem suporte, ICMS sem CST, CST sem suporte)', () => {
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...calculo.icms, cst: undefined, csosn: '500' } }))).toThrow(ErroViolacao);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...calculo.icms, cst: undefined } }))).toThrow(/sem CST/);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...calculo.icms, cst: '10' } }))).toThrow(/sem suporte/);
    expect(() => gerarXmlNFe(comCalculo({ icms: { ...calculo.icms, cst: undefined, csosn: '101' } }))).toThrow(/pCredSN/);
    const ok102 = gerarXmlNFe(comCalculo({ icms: { ...calculo.icms, cst: undefined, csosn: '400' } }));
    expect(ok102).toContain('<ICMSSN102><orig>0</orig><CSOSN>400</CSOSN></ICMSSN102>');
    const ok101 = gerarXmlNFe(comCalculo({ icms: { ...calculo.icms, cst: undefined, csosn: '101', pcredsn_pct: 1.25, vcredicmssn_centavos: 25 } }));
    expect(ok101).toContain('<pCredSN>1.2500</pCredSN><vCredICMSSN>0.25</vCredICMSSN>');
  });
  it('RF-FAT-01: IPI maior que zero exige o grupo IPI e o gera; PIS/COFINS com valor exigem base e alíquota', () => {
    const ipiOk = (d: DadosXml): void => {
      d.nota.totais.vIPI = 100;
      d.nota.totais.vNF += 100;
      d.pagamentos = [{ tPag: '15', valor_centavos: d.nota.totais.vNF }];
    };
    expect(() => gerarXmlNFe(comCalculo({ ipi_centavos: 100 }, ipiOk))).toThrow(/grupo IPI/);
    const x = gerarXmlNFe(comCalculo({ ipi_centavos: 100, ipi: { cst: '50', cenq: '999', vbc_centavos: 2000, aliquota_pct: 5 } }, ipiOk));
    expect(x).toContain('<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>20.00</vBC><pIPI>5.0000</pIPI><vIPI>1.00</vIPI></IPITrib></IPI>');
    expect(() => gerarXmlNFe(comCalculo({ pis: { cst: '01', vbc_centavos: 0, aliquota_pct: 1.65 } }))).toThrow(/PIS/);
    expect(() => gerarXmlNFe(comCalculo({ cofins: undefined }))).toThrow(/COFINS/);
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
