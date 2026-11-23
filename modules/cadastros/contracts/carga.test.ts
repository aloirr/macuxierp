import { describe, expect, it } from 'vitest';
import { LinhaCondicaoPagamento, CargaPedido, CLASSE_FORMA, CondicaoPagamentoDados, CondicaoPagamentoAtualizacao, classeForma, ehAVista, FORMAS_A_VISTA, MAX_ARQUIVOS_LOTE } from './index';

describe('contrato da carga de CSV', () => {
  it('CargaPedido aceita até MAX_ARQUIVOS_LOTE arquivos (o literal do .max() é lido pelo teste de sincronia da CLI)', () => {
    const arquivo = { nome: 'cliente.csv', bytes: new Uint8Array() };
    expect(CargaPedido.safeParse({ modo: 'validar', arquivos: Array(MAX_ARQUIVOS_LOTE).fill(arquivo) }).success).toBe(true);
    expect(CargaPedido.safeParse({ modo: 'validar', arquivos: Array(MAX_ARQUIVOS_LOTE + 1).fill(arquivo) }).success).toBe(false);
  });
});

describe('critério único de à vista e classe da forma (RN-CAD-09)', () => {
  it('RN-CAD-09: classeForma deriva do tPag: 01, 17, 04 à vista; 03 cartão; 15 boleto; o resto não é aceito', () => {
    expect([...FORMAS_A_VISTA].sort()).toEqual(['01', '04', '17']); // único lugar que fixa a lista
    for (const f of FORMAS_A_VISTA) expect(classeForma(f)).toBe('a_vista');
    expect(classeForma('03')).toBe('cartao');
    expect(classeForma('15')).toBe('boleto');
    for (const f of ['02', '05', '16', '18', '99', '', 'toString', 'constructor']) expect(classeForma(f)).toBeNull();
    expect(Object.keys(CLASSE_FORMA).sort()).toEqual(['01', '03', '04', '15', '17']);
  });
  it('RN-CAD-09: ehAVista olha só a forma (tPag 01, 17 e 04)', () => {
    for (const f of FORMAS_A_VISTA) expect(ehAVista({ forma_tpag: f })).toBe(true);
    for (const f of ['03', '15', '02', '99']) expect(ehAVista({ forma_tpag: f })).toBe(false);
  });
  it('RN-CAD-09: a linha de condição aceita 1 a 99 parcelas; a faixa 1 a 12 do cartão é do domain', () => {
    const l = (parcelas_cartao: number) => LinhaCondicaoPagamento.safeParse({ linha: 2, external_id: 'z', avisos: [], dados: { parcelas_cartao } }).success;
    expect(l(13)).toBe(true);
    expect(l(99)).toBe(true);
    expect(l(100)).toBe(false);
    expect(l(0)).toBe(false);
  });
  it('RN-CAD-09: parcelas_cartao é aditivo (1 a 12, ausente = nulo) e opcional na atualização', () => {
    const base = { codigo: 'C', descricao: 'D', forma_tpag: '03', prazos_dias: [30], forma_external_id: 'f1', external_id: 'c1' };
    expect(CondicaoPagamentoDados.parse(base).parcelas_cartao ?? null).toBeNull();
    expect(CondicaoPagamentoDados.safeParse({ ...base, parcelas_cartao: 12 }).success).toBe(true);
    expect(CondicaoPagamentoDados.safeParse({ ...base, parcelas_cartao: 13 }).success).toBe(false);
    expect(CondicaoPagamentoDados.safeParse({ ...base, parcelas_cartao: 0 }).success).toBe(false);
    expect(CondicaoPagamentoAtualizacao.parse({ descricao: 'X' })).toEqual({ descricao: 'X' });
  });
});
