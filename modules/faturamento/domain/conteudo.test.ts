import { describe, expect, it } from 'vitest';
import { notaParaEmissaoDe, type ConteudoNota, type IdentidadeNota } from './conteudo';
import { FUSO_MANAUS_MINUTOS } from './fuso';
import { calc, itemPedido, pedidoAprovado } from './fixtures';
import { montarNota } from './nota';
import { montarPagamento } from './pagamento';

const endereco = { logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio_ibge: '1302603', municipio_nome: 'Manaus' as string | null, uf: 'AM', cep: '69000-000' };
const emitida_em = new Date('2026-11-21T14:30:00Z');

function montar(csosn?: string, crt: 1 | 3 | 4 = 3) {
  const pedido = pedidoAprovado([itemPedido(1, 20_000, 1000), itemPedido(2, 10_000, 2500)]);
  const icms = csosn ? { orig: '0' as const, csosn, p_cred_sn: 180_000, v_cred_icms_sn: 10 } : undefined;
  const r = montarNota({
    pedido,
    situacao: { status: 'aprovado', itens: [{ sequencia: 1, quantidade: 20_000, quantidade_faturada: 0 }, { sequencia: 2, quantidade: 10_000, quantidade_faturada: 0 }] },
    ambiente: 'homologacao',
    calculo: [calc(1, icms ? { icms } : {}), calc(2, icms ? { icms } : {})],
  });
  if (!r.ok) throw new Error('nota');
  const pag = montarPagamento({ forma_tpag: '15', prazos_dias: [30, 60], total_centavos: r.nota.totais.vNF, emissao: emitida_em, numero: 7 });
  const id: IdentidadeNota = { cnf: '12345678' as string | null, tpEmis: 1, serie: 1, numero: 7, emitida_em, ambiente: 'homologacao', pedido_id: pedido.pedido_id, filial_id: pedido.filial_id, cliente_id: pedido.cliente_id, vendedor_id: null };
  const c: ConteudoNota = {
    natOp: 'VENDA DE MERCADORIA',
    emitente: { cnpj: '11.222.333/0001-81', nome: 'EMITENTE LTDA', ie: '012345679', crt, endereco },
    destinatario: { documento: '45.723.174/0001-10', nome: 'CLIENTE', ind_ie_dest: 1, ie: '04.123.456-1', endereco },
    modFrete: 9,
    infCpl: null,
    itensSolicitados: null,
    pagamentos: pag.pagamentos,
    cobranca: pag.cobranca,
    itens: r.nota.itens,
  };
  return { id, c };
}

/** Violações (campos) da nota: vazio = a NotaParaEmissao sai. */
const violacoes = (id: IdentidadeNota, c: ConteudoNota) => {
  const r = notaParaEmissaoDe(id, c);
  return r.ok ? [] : r.violacoes;
};
const nota = (id: IdentidadeNota, c: ConteudoNota) => {
  const r = notaParaEmissaoDe(id, c);
  if (!r.ok) throw new Error(`violações: ${r.violacoes.map((v) => v.campo).join(',')}`);
  return r.nota;
};

describe('NotaParaEmissao (entrada da porta EmissorNFe, em centavos, sem totais)', () => {
  it('RN-FAT-02: o conteúdo gravado (ida e volta por JSON) gera a mesma NotaParaEmissao', () => {
    const { id, c } = montar();
    const volta = JSON.parse(JSON.stringify(c)) as ConteudoNota;
    expect(JSON.parse(JSON.stringify(nota(id, volta)))).toEqual(JSON.parse(JSON.stringify(nota(id, c))));
  });
  it('RF-FAT-01: leva ide (UTC e fuso de Manaus, cNF gravado), emit com CRT, dest com indIEDest, itens em centavos e o detPag; nenhum total', () => {
    const { id, c } = montar();
    const n = nota(id, c);
    expect(n.ide).toMatchObject({ cUF: '13', serie: 1, nNF: 7, dhEmi: '2026-11-21T14:30:00.000Z', fusoMinutos: FUSO_MANAUS_MINUTOS, tpNF: 1, idDest: 1, cMunFG: '1302603', tpAmb: 2, indFinal: 0, indPres: 9, cNF: '12345678' });
    expect(n.emit).toMatchObject({ CNPJ: '11222333000181', CRT: 3, IE: '012345679', enderEmit: { xMun: 'Manaus', CEP: '69000000' } });
    expect(n.dest).toMatchObject({ CNPJ: '45723174000110', indIEDest: 1, IE: '041234561', enderDest: { UF: 'AM' } });
    expect(n.itens[0]).toMatchObject({ cProd: 'P1', qCom: '2.0000', vUnCom: '10.00', vProd: 2000, imposto: { ICMS: { CST: '00', orig: 0, vBC: 1000, pICMS: '20.0000' }, PIS: { CST: '01', aliquota: '1.6500', valor: 10 } } });
    expect(n.pag.detPag).toEqual([{ indPag: 1, tPag: '15', vPag: 4500 }]);
    expect(n.transp.modFrete).toBe(9);
    expect(Object.keys(n)).not.toContain('total');
  });
  it('RF-FAT-01: sem cNF (primeira montagem) o campo não vai e o emissor sorteia', () => {
    const { id, c } = montar();
    expect(nota({ ...id, cnf: null }, c).ide).not.toHaveProperty('cNF');
  });
  it('RF-FAT-01: cliente de outra UF é idDest 2 e consumidor sem IE é indFinal 1 com CPF', () => {
    const { id, c } = montar();
    c.destinatario = { documento: '529.982.247-25', nome: 'PESSOA', ind_ie_dest: 9, ie: null, endereco: { ...endereco, uf: 'SP' } };
    const n = nota(id, c);
    expect(n.ide).toMatchObject({ idDest: 2, indFinal: 1 });
    expect(n.dest).toMatchObject({ CPF: '52998224725', indIEDest: 9 });
    expect(n.dest).not.toHaveProperty('IE');
  });
  it('RF-FAT-01: nota válida não tem violação; município sem nome (xMun) no destinatário ou no emitente é violação', () => {
    const { id, c } = montar();
    expect(violacoes(id, c)).toEqual([]);
    c.destinatario = { ...c.destinatario, endereco: { ...endereco, municipio_nome: null } };
    c.emitente = { ...c.emitente, endereco: { ...endereco, municipio_nome: ' ' } };
    expect(violacoes(id, c).map((v) => v.campo)).toEqual(['emitente.endereco.municipio_nome', 'destinatario.endereco.municipio_nome']);
  });
  it('RF-FAT-01: soma dos vPag diferente do vNF é violação', () => {
    const { id, c } = montar();
    c.pagamentos = [{ indPag: 1, tPag: '15', valor_centavos: 1 }];
    expect(violacoes(id, c)[0]?.campo).toBe('pagamentos');
  });
  it('NT 2024.001: MEI (CRT 4) não destaca crédito: CSOSN 101 e 201 são violação; 102, 103, 202, 203, 300 e 400 seguem', () => {
    for (const cs of ['101', '201']) {
      const { id, c } = montar(cs, 4);
      expect(violacoes(id, c)[0]?.mensagem).toContain('MEI');
    }
    for (const cs of ['102', '103', '300', '400']) {
      const { id, c } = montar(cs, 4);
      expect(violacoes(id, c)).toEqual([]);
    }
  });
  it('NT 2024.001: CRT 1 e 4 usam CSOSN (item com CST é violação); o Simples (CRT 1) ainda destaca crédito (101)', () => {
    const cst = montar(undefined, 4);
    expect(violacoes(cst.id, cst.c)[0]?.mensagem).toContain('CSOSN');
    const { id, c } = montar('101', 1);
    expect(violacoes(id, c)).toEqual([]);
  });
});
