import { describe, expect, it } from 'vitest';
import { modFreteDoPedido, montarPagamento, somarDias } from './pagamento';

const emissao = new Date('2026-11-21T14:30:00Z');
const base = { total_centavos: 10_000, emissao, numero: 123 };

describe('pagamento da NF-e (indPag, detPag, card e cobr/dup)', () => {
  it('RN-CAD-09: PIX com prazo 0 é à vista (indPag 0), sem cobr e sem card', () => {
    const r = montarPagamento({ ...base, forma_tpag: '17', prazos_dias: [0] });
    expect(r.pagamentos).toEqual([{ indPag: 0, tPag: '17', valor_centavos: 10_000 }]);
    expect(r.cobranca).toBeNull();
  });
  it('RN-CAD-09: o indPag vem só da classe da forma (ehAVista do cadastros): 01 é 0 mesmo com prazo; cartão de crédito, boleto e 99 são 1', () => {
    expect(montarPagamento({ ...base, forma_tpag: '01', prazos_dias: [30] }).pagamentos[0]?.indPag).toBe(0);
    for (const f of ['03', '15', '99']) expect(montarPagamento({ ...base, forma_tpag: f, prazos_dias: [30] }).pagamentos[0]?.indPag).toBe(1);
  });
  it('RF-FAT-01: forma nula vira tPag 99 com xPag "Conforme condição combinada" e indPag 1', () => {
    const r = montarPagamento({ ...base, forma_tpag: null, prazos_dias: null });
    expect(r.pagamentos).toEqual([{ indPag: 1, tPag: '99', xPag: 'Conforme condição combinada', valor_centavos: 10_000 }]);
    expect(r.cobranca).toBeNull();
  });
  it('RF-FAT-01: boleto (15) a prazo gera cobr/dup com vencimentos pela data civil de Manaus e rateio sem perder centavo', () => {
    const r = montarPagamento({ ...base, total_centavos: 10_001, forma_tpag: '15', prazos_dias: [30, 60, 90] });
    expect(r.pagamentos).toEqual([{ indPag: 1, tPag: '15', valor_centavos: 10_001 }]);
    expect(r.cobranca).toEqual({
      nFat: '123',
      vOrig: 10_001,
      vLiq: 10_001,
      parcelas: [
        { nDup: '001', vencimento: '2026-12-21', valor_centavos: 3335 },
        { nDup: '002', vencimento: '2027-01-20', valor_centavos: 3333 },
        { nDup: '003', vencimento: '2027-02-19', valor_centavos: 3333 },
      ],
    });
    expect(r.cobranca?.parcelas.reduce((a, p) => a + p.valor_centavos, 0)).toBe(10_001);
  });
  it('RF-FAT-01: só o boleto leva cobr/dup (cheque 02 e transferência 18 não)', () => {
    for (const f of ['02', '18', '05', '99']) expect(montarPagamento({ ...base, forma_tpag: f, prazos_dias: [30] }).cobranca).toBeNull();
  });
  it('RF-FAT-01: cartão (03 e 04) leva o grupo card com tpIntegra 2; as outras formas não', () => {
    expect(montarPagamento({ ...base, forma_tpag: '03', prazos_dias: [30] }).pagamentos[0]?.card).toEqual({ tpIntegra: 2 });
    expect(montarPagamento({ ...base, forma_tpag: '04', prazos_dias: [0] }).pagamentos[0]).toMatchObject({ indPag: 0, card: { tpIntegra: 2 } });
    expect(montarPagamento({ ...base, forma_tpag: '15', prazos_dias: [0] }).pagamentos[0]?.card).toBeUndefined();
  });
  it('RF-FAT-01: a emissão perto da meia-noite UTC usa a data civil de Manaus no vencimento', () => {
    const r = montarPagamento({ ...base, emissao: new Date('2026-11-22T02:00:00Z'), forma_tpag: '15', prazos_dias: [0, 10] });
    expect(r.cobranca?.parcelas.map((p) => p.vencimento)).toEqual(['2026-11-21', '2026-12-01']);
  });
  it('RF-FAT-01: somarDias vira mês e ano e respeita o bissexto', () => {
    expect(somarDias('2027-12-31', 1)).toBe('2028-01-01');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('RF-FAT-01: modFrete pela modalidade do pedido (CIF 0, FOB 1, sem frete 9)', () => {
    expect(modFreteDoPedido({ modalidade: 'CIF' })).toBe(0);
    expect(modFreteDoPedido({ modalidade: 'FOB' })).toBe(1);
    expect(modFreteDoPedido(null)).toBe(9);
  });
});
