import { describe, expect, it } from 'vitest';
import { FORMAS_A_VISTA, prazoCompleto, prazoPermitidoAoCliente } from '../contracts';
import {
  MOTIVO_A_VISTA, MOTIVO_BOLETO, MOTIVO_CARTAO_PRAZOS, MOTIVO_DESCRICAO, MOTIVO_FORMA_NAO_ACEITA, MOTIVO_PRAZO_MEDIO, MOTIVO_PRAZO_MEDIO_A_VISTA, derivarParcelasCartao, validarCondicaoPagamento as v,
} from './condicao';

const rn = (m: string, campo: string, r = 'RN-CAD-09') => [{ rn: r, campo, mensagem: m }];

describe('condição de pagamento', () => {
  it('RN-CAD-15: à vista (01, 17, 04) aceita só as parcelas [0] e o prazo médio 0', () => {
    for (const f of FORMAS_A_VISTA) expect(v({ forma_tpag: f, prazos_dias: [0], prazo_medio_dias: 0 })).toEqual([]);
    expect(v({ forma_tpag: '04', prazos_dias: [0], parcelas_cartao: null, prazo_medio_dias: 0 })).toEqual([]);
  });
  it('RN-CAD-15: à vista recusa parcelas diferentes de [0] ([30], [0,30], [0,0], vazio) e parcelas_cartao', () => {
    expect(v({ forma_tpag: '04', prazos_dias: [30], prazo_medio_dias: 0 })).toEqual(rn(MOTIVO_A_VISTA, 'prazos_dias', 'RN-CAD-15'));
    expect(v({ forma_tpag: '01', prazos_dias: [0, 30], prazo_medio_dias: 0 })).toHaveLength(1);
    expect(v({ forma_tpag: '17', prazos_dias: [0, 0], prazo_medio_dias: 0 })).toHaveLength(1);
    expect(v({ forma_tpag: '17', prazos_dias: [0], parcelas_cartao: 1, prazo_medio_dias: 0 })).toHaveLength(1);
    expect(v({ forma_tpag: '01', prazos_dias: [], prazo_medio_dias: 0 })).toHaveLength(1);
  });
  it('RN-CAD-15: à vista com prazo médio diferente de 0 é recusado no campo prazo_medio_dias', () => {
    expect(v({ forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 5 })).toEqual(rn(MOTIVO_PRAZO_MEDIO_A_VISTA, 'prazo_medio_dias', 'RN-CAD-15'));
  });
  it('RN-CAD-15: prazo médio é obrigatório na entrada (ausente recusa) e o legado nulo passa', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [30] })).toEqual(rn(MOTIVO_PRAZO_MEDIO, 'prazo_medio_dias', 'RN-CAD-15'));
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: null })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 1000 })).toEqual(rn(MOTIVO_PRAZO_MEDIO, 'prazo_medio_dias', 'RN-CAD-15'));
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: -1 })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 999 })).toEqual([]);
  });
  it('RN-CAD-15: descrição em branco é recusada no campo descricao', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30, descricao: '  ' })).toEqual(rn(MOTIVO_DESCRICAO, 'descricao', 'RN-CAD-15'));
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30, descricao: 'Boleto 30' })).toEqual([]);
  });
  it('RN-CAD-09 emendada pela RN-CAD-15: cartão tem os dias digitados (1 a 12 parcelas, qualquer dia de 0 a 999)', () => {
    expect(v({ forma_tpag: '03', prazos_dias: [30], prazo_medio_dias: 30 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: [7, 21, 45], prazo_medio_dias: 24 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: Array(12).fill(30), prazo_medio_dias: 30 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: Array(13).fill(30), prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_CARTAO_PRAZOS, 'prazos_dias'));
    expect(v({ forma_tpag: '03', prazos_dias: [], prazo_medio_dias: 30 })).toHaveLength(1);
    expect(v({ forma_tpag: '03', prazos_dias: [1000], prazo_medio_dias: 30 })).toHaveLength(1);
  });
  it('RN-CAD-09: parcelas_cartao legado, quando vem, tem de bater com o número de parcelas', () => {
    expect(v({ forma_tpag: '03', prazos_dias: [30, 60], parcelas_cartao: 2, prazo_medio_dias: 45 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: [30, 60], parcelas_cartao: 3, prazo_medio_dias: 45 })).toEqual(rn(MOTIVO_CARTAO_PRAZOS, 'parcelas_cartao'));
  });
  it('RN-CAD-09: o domain deriva parcelas_cartao dos prazos (cartão = nº de parcelas; outras formas = nulo), p/ o CHECK do banco', () => {
    expect(derivarParcelasCartao({ forma_tpag: '03', prazos_dias: [7, 21] })).toBe(2);
    expect(derivarParcelasCartao({ forma_tpag: '15', prazos_dias: [7, 21] })).toBeNull();
    expect(derivarParcelasCartao({ forma_tpag: '03', prazos_dias: Array(13).fill(30) })).toBeNull();
    expect(derivarParcelasCartao({ forma_tpag: '01', prazos_dias: [0] })).toBeNull();
  });
  it('RN-CAD-15: boleto aceita 1 a 36 parcelas de 0 a 999 dias e recusa parcelas_cartao', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [0], prazo_medio_dias: 0 })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: Array(36).fill(999), prazo_medio_dias: 999 })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: Array(37).fill(30), prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_BOLETO, 'prazos_dias'));
    expect(v({ forma_tpag: '15', prazos_dias: [1000], prazo_medio_dias: 30 })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [], prazo_medio_dias: 30 })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [30], parcelas_cartao: 3, prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_BOLETO, 'parcelas_cartao'));
  });
  it('RN-CAD-09: outra forma (cheque 02, depósito 16, 99) é recusada com a mensagem exata, sem ecoar o valor', () => {
    expect(MOTIVO_FORMA_NAO_ACEITA).toBe('forma não aceita: use Dinheiro, PIX, Cartão ou Boleto');
    for (const f of ['02', '16', '18', '99']) expect(v({ forma_tpag: f, prazos_dias: [0], prazo_medio_dias: 0 })).toEqual(rn(MOTIVO_FORMA_NAO_ACEITA, 'forma_tpag'));
  });
});

describe('prazo completo e prazo permitido ao cliente (contracts)', () => {
  const prazo = { codigo: 'B30', descricao: 'Boleto 30', prazos_dias: [30], prazo_medio_dias: 30 as number | null };
  it('RN-CAD-15: completo = código, descrição, ao menos uma parcela e prazo médio não nulo', () => {
    expect(prazoCompleto(prazo)).toBe(true);
    expect(prazoCompleto({ ...prazo, prazo_medio_dias: 0 })).toBe(true);
    expect(prazoCompleto({ ...prazo, prazo_medio_dias: null })).toBe(false);
    expect(prazoCompleto({ ...prazo, prazos_dias: [] })).toBe(false);
    expect(prazoCompleto({ ...prazo, descricao: ' ' })).toBe(false);
    expect(prazoCompleto({ ...prazo, codigo: '' })).toBe(false);
  });
  it('RN-CAD-16: cliente sem prazo médio vê todos os prazos completos; com prazo médio, só os de prazo médio <= o dele', () => {
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: null })).toBe(true);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 30 })).toBe(true);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 45 })).toBe(true);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 29 })).toBe(false);
    expect(prazoPermitidoAoCliente(prazo, { prazo_medio_dias: 0 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: 0, prazos_dias: [0] }, { prazo_medio_dias: 0 })).toBe(true);
  });
  it('RN-CAD-16: prazo incompleto (legado) nunca é permitido, nem a cliente sem prazo médio', () => {
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: null }, { prazo_medio_dias: null })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: null }, { prazo_medio_dias: 999 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...prazo, prazo_medio_dias: undefined }, {})).toBe(false);
  });
  it('RN-CAD-16: exceção do cartão de crédito (tPag 03) fica fora do limite do prazo médio', () => {
    const cartao = { ...prazo, forma_tpag: '03', prazos_dias: [30, 60, 90], prazo_medio_dias: 90 as number | null };
    expect(prazoPermitidoAoCliente(cartao, { prazo_medio_dias: 30 })).toBe(true);
    expect(prazoPermitidoAoCliente(cartao, { prazo_medio_dias: 0 })).toBe(true);
    expect(prazoPermitidoAoCliente({ ...cartao, prazo_medio_dias: null }, { prazo_medio_dias: 30 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...cartao, prazos_dias: [] }, { prazo_medio_dias: 999 })).toBe(false);
    expect(prazoPermitidoAoCliente({ ...cartao, forma_tpag: '15' }, { prazo_medio_dias: 30 })).toBe(false);
  });
});
