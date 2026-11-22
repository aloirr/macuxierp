import { describe, expect, it } from 'vitest';
import { TituloBaixadoPayload, TituloGeradoPayload } from '../contracts';
import { baixar, cancelarTitulosDaNota, estornarBaixa, gerarParcelas, payloadTituloBaixado, payloadTituloGerado, type NotaParaTitulos, type Titulo } from './titulos';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nota: NotaParaTitulos = { id: U(1), pedido_id: U(2), cliente_id: U(3), ambiente: 'producao', numero: 10, serie: 1, total_centavos: 10_001, emissao: new Date('2026-11-21T14:30:00Z'), status: 'autorizada' };
const titulo = (o: Partial<Titulo> = {}): Titulo => ({ id: U(9), nota_id: U(1), ambiente: 'producao', parcela: 1, total_parcelas: 1, vencimento: '2026-12-21', valor_centavos: 1000, saldo_centavos: 1000, status: 'aberto', ...o });

describe('gerarParcelas', () => {
  it('RN-FAT-06: boleto gera uma parcela por prazo, vencimento pela data civil de Manaus + prazo, rateio sem perder centavo (RN-CORE-03)', () => {
    const p = gerarParcelas(nota, { prazos_dias: [30, 60, 90] }, 'boleto');
    expect(p.map((x) => x.valor_centavos)).toEqual([3335, 3333, 3333]);
    expect(p.reduce((a, x) => a + x.valor_centavos, 0)).toBe(10_001);
    expect(p.map((x) => x.vencimento)).toEqual(['2026-12-21', '2027-01-20', '2027-02-19']);
    expect(p.map((x) => [x.parcela, x.total_parcelas, x.saldo_centavos === x.valor_centavos])).toEqual([[1, 3, true], [2, 3, true], [3, 3, true]]);
  });
  it('RN-FAT-06: a data civil é a de Manaus (emissão 01h UTC ainda é o dia anterior)', () => {
    const p = gerarParcelas({ ...nota, emissao: new Date('2026-11-22T01:00:00Z') }, { prazos_dias: [0] }, 'boleto');
    expect(p[0]?.vencimento).toBe('2026-11-21');
  });
  it('RN-FAT-06: cartão e à vista não geram título', () => {
    expect(gerarParcelas(nota, { prazos_dias: [30] }, 'cartao')).toEqual([]);
    expect(gerarParcelas(nota, { prazos_dias: [0] }, 'a_vista')).toEqual([]);
    expect(gerarParcelas(nota, { prazos_dias: [0] }, null)).toEqual([]);
  });
  it('RN-FAT-04: nota de homologação gera título marcado homologação (não vai ao FDV)', () => {
    const p = gerarParcelas({ ...nota, ambiente: 'homologacao' }, { prazos_dias: [30] }, 'boleto');
    expect(p[0]).toMatchObject({ ambiente: 'homologacao', vai_ao_fdv: false });
    expect(gerarParcelas(nota, { prazos_dias: [30] }, 'boleto')[0]?.vai_ao_fdv).toBe(true);
  });
  it('RN-FAT-03: só nota autorizada gera título', () => {
    expect(() => gerarParcelas({ ...nota, status: 'rejeitada' }, { prazos_dias: [30] }, 'boleto')).toThrow(/RN-FAT-03/);
  });
  it('RN-FAT-06: total que não dá um centavo por parcela é violação', () => {
    expect(() => gerarParcelas({ ...nota, total_centavos: 2 }, { prazos_dias: [30, 60, 90] }, 'boleto')).toThrow(/RN-FAT-06/);
  });
});

describe('baixar', () => {
  it('RN-FAT-06: baixa parcial deixa o título aberto com o saldo restante', () => {
    const r = baixar(titulo(), 400, '2026-11-25');
    expect(r).toMatchObject({ saldo_centavos: 600, status: 'aberto', baixa: { valor_centavos: 400, data: '2026-11-25' } });
  });
  it('RN-FAT-06: baixa total zera o saldo e baixa o título', () => {
    expect(baixar(titulo(), 1000, '2026-11-25')).toMatchObject({ saldo_centavos: 0, status: 'baixado' });
  });
  it('RN-FAT-06: valor deve ser inteiro > 0 e ≤ saldo', () => {
    for (const v of [0, -1, 1001, 1.5]) expect(() => baixar(titulo(), v, '2026-11-25')).toThrow(/RN-FAT-06/);
  });
  it('RN-FAT-06: título baixado ou cancelado não recebe baixa', () => {
    expect(() => baixar(titulo({ status: 'baixado', saldo_centavos: 0 }), 1, '2026-11-25')).toThrow(/RN-FAT-06/);
    expect(() => baixar(titulo({ status: 'cancelado' }), 1, '2026-11-25')).toThrow(/RN-FAT-06/);
  });
});

describe('estornarBaixa', () => {
  const baixas = [{ id: 'b1', valor_centavos: 400, estornada: false }, { id: 'b2', valor_centavos: 600, estornada: false }];
  it('RN-FAT-06: estorno recalcula saldo = valor − baixas não estornadas e reabre o título baixado', () => {
    const r = estornarBaixa(titulo({ status: 'baixado', saldo_centavos: 0 }), baixas, 'b2');
    expect(r).toMatchObject({ saldo_centavos: 600, status: 'aberto' });
    expect(r.baixas.find((b) => b.id === 'b2')?.estornada).toBe(true);
  });
  it('RN-FAT-06: estornar tudo volta ao saldo cheio; baixa inexistente ou já estornada é violação', () => {
    const r = estornarBaixa(titulo({ status: 'aberto', saldo_centavos: 0 + 0 }), [{ id: 'b1', valor_centavos: 400, estornada: false }], 'b1');
    expect(r.saldo_centavos).toBe(1000);
    expect(() => estornarBaixa(titulo(), baixas, 'x')).toThrow(/RN-FAT-06/);
    expect(() => estornarBaixa(titulo(), [{ id: 'b1', valor_centavos: 400, estornada: true }], 'b1')).toThrow(/RN-FAT-06/);
  });
  it('RN-FAT-06: título cancelado não tem estorno', () => {
    expect(() => estornarBaixa(titulo({ status: 'cancelado' }), baixas, 'b1')).toThrow(/RN-FAT-06/);
  });
});

describe('cancelarTitulosDaNota', () => {
  it('RN-FAT-06: nota cancelada cancela os títulos abertos sem baixa e ignora os já cancelados', () => {
    const r = cancelarTitulosDaNota([titulo(), titulo({ id: U(8), parcela: 2, status: 'cancelado' })]);
    expect(r.violacoes).toEqual([]);
    expect(r.cancelar).toEqual([U(9)]);
  });
  it('RN-FAT-06: título com baixa (parcial ou total) bloqueia o cancelamento da nota até o estorno', () => {
    const r = cancelarTitulosDaNota([titulo({ saldo_centavos: 600 }), titulo({ id: U(8), status: 'baixado', saldo_centavos: 0 })]);
    expect(r.cancelar).toEqual([]);
    expect(r.violacoes).toHaveLength(2);
    expect(r.violacoes[0]?.rn).toBe('RN-FAT-06');
  });
});

describe('payloads', () => {
  const base = { nota, pedido_id: U(2), cliente_id: U(3) };
  it('titulo.gerado@1 e titulo.baixado@1 passam no contrato, com ambiente e valor_baixado_centavos', () => {
    const t = titulo({ saldo_centavos: 600 });
    const g = payloadTituloGerado(nota, t);
    expect(TituloGeradoPayload.parse(g)).toMatchObject({ titulo_id: U(9), ambiente: 'producao', emissao: '2026-11-21', numero: 10, serie: 1 });
    const b = payloadTituloBaixado(nota, t, 400, '2026-11-25');
    expect(TituloBaixadoPayload.parse(b)).toMatchObject({ valor_baixado_centavos: 400, baixado_em: '2026-11-25', saldo_centavos: 600 });
    expect(base.nota.id).toBe(U(1));
  });
});
