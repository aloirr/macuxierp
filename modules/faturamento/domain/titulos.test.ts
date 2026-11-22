import { describe, expect, it } from 'vitest';
import { TituloBaixadoPayload, TituloGeradoPayload } from '../contracts';
import { dataCivilManaus } from './fuso';
import { nfeVaiAoFdv } from './nota';
import { baixar, cancelarTitulosDaNota, contaComoReal, estornarBaixa, gerarParcelas, podeBaixarTitulo, prazosDaNota, payloadTituloBaixado, payloadTituloGerado, validarTitulosDoBoleto, type NotaParaTitulos, type Titulo } from './titulos';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nota: NotaParaTitulos = { id: U(1), pedido_id: U(2), cliente_id: U(3), ambiente: 'producao', numero: 10, serie: 1, total_centavos: 10_001, emissao: new Date('2026-11-21T14:30:00Z'), status: 'autorizada' };
const titulo = (o: Partial<Titulo> = {}): Titulo => ({ id: U(9), nota_id: U(1), ambiente: 'producao', parcela: 1, total_parcelas: 1, vencimento: '2026-12-21', valor_centavos: 1000, saldo_centavos: 1000, status: 'aberto', ...o });

describe('gerarParcelas', () => {
  it('RN-FAT-06: boleto gera uma parcela por prazo, vencimento pela data civil de Manaus + prazo, rateio sem perder centavo (RN-CORE-03)', () => {
    const p = gerarParcelas(nota, { prazos_dias: [30, 60, 90] }, 'boleto');
    expect(p.map((x) => x.valor_centavos)).toEqual([3335, 3333, 3333]);
    expect(p.reduce((a, x) => a + x.valor_centavos, 0)).toBe(10_001);
    expect(p.map((x) => x.vencimento)).toEqual(['2026-12-21', '2027-01-20', '2027-02-19']);
    expect(p.map((x) => [x.parcela, x.total_parcelas])).toEqual([[1, 3], [2, 3], [3, 3]]);
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
  it('RN-FAT-04: a nota de homologação gera título marcado homologação; só produção vai ao FDV (nfeVaiAoFdv, único lugar)', () => {
    expect(gerarParcelas({ ...nota, ambiente: 'homologacao' }, { prazos_dias: [30] }, 'boleto')[0]).toMatchObject({ ambiente: 'homologacao' });
    expect([nfeVaiAoFdv('homologacao'), nfeVaiAoFdv('producao')]).toEqual([false, true]);
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
    expect(r.divergentes).toEqual([]);
    expect(r.cancelar).toEqual([U(9)]);
  });
  it('RN-FAT-06: título com baixa (parcial ou total) NÃO bloqueia o cancelamento da nota: fica como está e vira divergência para o financeiro', () => {
    const r = cancelarTitulosDaNota([titulo({ saldo_centavos: 600 }), titulo({ id: U(8), parcela: 2, status: 'baixado', saldo_centavos: 0 }), titulo({ id: U(7), parcela: 3 })]);
    expect(r.cancelar).toEqual([U(7)]);
    expect(r.divergentes).toEqual([{ id: U(9), parcela: 1 }, { id: U(8), parcela: 2 }]);
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

describe('bandeira faturamento real com NF-e simulada', () => {
  const homolog: NotaParaTitulos = { ...nota, ambiente: 'homologacao' };
  it('RN-FAT-04: sem a bandeira, o payload do título de homologação não traz conta_como_real', () => {
    expect(payloadTituloGerado(homolog, titulo({ ambiente: 'homologacao' })).conta_como_real).toBeUndefined();
    expect(contaComoReal('homologacao', false)).toBe(false);
  });
  it('RN-FAT-04: com a bandeira ligada e a nota em homologação, o título conta como real e os payloads levam conta_como_real: true', () => {
    expect(contaComoReal('homologacao', true)).toBe(true);
    const t = titulo({ ambiente: 'homologacao' });
    expect(payloadTituloGerado(homolog, t, true).conta_como_real).toBe(true);
    expect(payloadTituloBaixado(homolog, t, 100, '2026-11-25', true).conta_como_real).toBe(true);
  });
  it('RN-FAT-04: em produção a bandeira não muda nada (já é real; conta_como_real ausente)', () => {
    expect(contaComoReal('producao', true)).toBe(false);
  });
});

describe('perfis e prazos', () => {
  it('RN-FAT-06: baixa e estorno só para administrador, gerente e faturista', () => {
    expect(['administrador', 'gerente', 'faturista', 'fiscal', 'leitura', 'vendedor'].filter(podeBaixarTitulo)).toEqual(['administrador', 'gerente', 'faturista']);
  });
  it('RN-FAT-06: os prazos vêm do conteúdo; sem eles, dos vencimentos da cobrança', () => {
    const e = new Date('2026-11-21T14:30:00Z');
    expect(prazosDaNota([30, 60], null, e)).toEqual([30, 60]);
    expect(prazosDaNota(null, { parcelas: [{ vencimento: '2026-12-21' }, { vencimento: '2027-01-20' }] }, e)).toEqual([30, 60]);
    expect(prazosDaNota(null, null, e)).toEqual([]);
  });
});

describe('RN-FAT-06: validação do boleto antes de reservar o número', () => {
  it('RN-FAT-06: boleto sem prazos é violação ("A condição de pagamento do boleto não tem prazos")', () => {
    for (const prazos of [null, []]) expect(validarTitulosDoBoleto({ forma_tpag: '15', prazos_dias: prazos, total_centavos: 100 })).toMatchObject([{ rn: 'RN-FAT-06', mensagem: 'A condição de pagamento do boleto não tem prazos.' }]);
  });
  it('RN-FAT-06: total menor que o número de parcelas é violação; cartão, à vista e sem forma não validam título', () => {
    expect(validarTitulosDoBoleto({ forma_tpag: '15', prazos_dias: [30, 60, 90], total_centavos: 2 })).toMatchObject([{ rn: 'RN-FAT-06', campo: 'total' }]);
    expect(validarTitulosDoBoleto({ forma_tpag: '15', prazos_dias: [30, 60], total_centavos: 2 })).toEqual([]);
    for (const f of ['03', '01', '17', null]) expect(validarTitulosDoBoleto({ forma_tpag: f, prazos_dias: null, total_centavos: 1 })).toEqual([]);
  });
});

describe('dataCivilManaus (RD-0617)', () => {
  it('RN-FAT-06: 01h UTC ainda é o dia anterior em Manaus', () => {
    expect(dataCivilManaus(new Date('2026-11-22T01:00:00Z'))).toBe('2026-11-21');
    expect(dataCivilManaus(new Date('2026-11-22T04:00:00Z'))).toBe('2026-11-22');
  });
});
