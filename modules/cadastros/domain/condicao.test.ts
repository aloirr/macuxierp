import { describe, expect, it } from 'vitest';
import { FORMAS_A_VISTA } from '../contracts';
import {
  MOTIVO_A_VISTA, MOTIVO_BOLETO, MOTIVO_CARTAO_PARCELAS, MOTIVO_CARTAO_PRAZOS, MOTIVO_FORMA_NAO_ACEITA, completarPrazos, completarPrazosNoPatch, prazosDoCartao, validarCondicaoPagamento as v,
} from './condicao';

const rn = (m: string, campo: string) => [{ rn: 'RN-CAD-09', campo, mensagem: m }];

describe('condição de pagamento', () => {
  it('RN-CAD-09: à vista (01, 17, 04) aceita só o prazo [0] e sem parcelas de cartão', () => {
    for (const f of FORMAS_A_VISTA) expect(v({ forma_tpag: f, prazos_dias: [0] })).toEqual([]);
    expect(v({ forma_tpag: '04', prazos_dias: [0], parcelas_cartao: null })).toEqual([]);
  });
  it('RN-CAD-09: à vista recusa prazo diferente de [0] (débito [30], [0,30], [0,0]) e parcelas_cartao', () => {
    expect(v({ forma_tpag: '04', prazos_dias: [30] })).toEqual(rn(MOTIVO_A_VISTA, 'prazos_dias'));
    expect(v({ forma_tpag: '01', prazos_dias: [0, 30] })).toHaveLength(1);
    expect(v({ forma_tpag: '17', prazos_dias: [0, 0] })).toHaveLength(1);
    expect(v({ forma_tpag: '17', prazos_dias: [0], parcelas_cartao: 1 })).toHaveLength(1);
    expect(v({ forma_tpag: '01', prazos_dias: [] })).toHaveLength(1);
  });
  it('RN-CAD-09: cartão 1x e 12x passam com os prazos gerados; 13x e 0x recusam', () => {
    expect(v({ forma_tpag: '03', prazos_dias: [30], parcelas_cartao: 1 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: prazosDoCartao(12), parcelas_cartao: 12 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: prazosDoCartao(13), parcelas_cartao: 13 })).toEqual(rn(MOTIVO_CARTAO_PARCELAS, 'parcelas_cartao'));
    expect(v({ forma_tpag: '03', prazos_dias: [0], parcelas_cartao: 0 })).toHaveLength(1);
    expect(v({ forma_tpag: '03', prazos_dias: [30], parcelas_cartao: null })).toEqual(rn(MOTIVO_CARTAO_PARCELAS, 'parcelas_cartao'));
  });
  it('RN-CAD-09: cartão com prazos diferentes dos gerados (30×N) é recusado', () => {
    expect(prazosDoCartao(3)).toEqual([30, 60, 90]);
    expect(v({ forma_tpag: '03', prazos_dias: [30, 60, 90], parcelas_cartao: 3 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: [0, 30, 60], parcelas_cartao: 3 })).toEqual(rn(MOTIVO_CARTAO_PRAZOS, 'prazos_dias'));
    expect(v({ forma_tpag: '03', prazos_dias: [30, 60], parcelas_cartao: 3 })).toHaveLength(1);
  });
  it('RN-CAD-09: ao criar cartão sem prazos_dias o domain preenche; fora do cartão não mexe', () => {
    expect(completarPrazos({ forma_tpag: '03', parcelas_cartao: 3 }).prazos_dias).toEqual([30, 60, 90]);
    expect(completarPrazos({ forma_tpag: '03', parcelas_cartao: 13 }).prazos_dias).toBeUndefined();
    expect(completarPrazos({ forma_tpag: '15', parcelas_cartao: 3 }).prazos_dias).toBeUndefined();
    expect(completarPrazos({ forma_tpag: '03', parcelas_cartao: 3, prazos_dias: [7] }).prazos_dias).toEqual([7]);
  });
  it('RN-CAD-09: boleto aceita 1 a 36 parcelas de 0 a 999 dias e recusa parcelas_cartao', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [0] })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [30, 60] })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: Array(36).fill(999) })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: Array(37).fill(30) })).toEqual(rn(MOTIVO_BOLETO, 'prazos_dias'));
    expect(v({ forma_tpag: '15', prazos_dias: [1000] })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [] })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [30], parcelas_cartao: 3 })).toEqual(rn(MOTIVO_BOLETO, 'parcelas_cartao'));
  });
  it('RN-CAD-09: outra forma (cheque 02, depósito 16, 99) é recusada com a mensagem exata, sem ecoar o valor', () => {
    expect(MOTIVO_FORMA_NAO_ACEITA).toBe('forma não aceita: use Dinheiro, PIX, Cartão ou Boleto');
    for (const f of ['02', '16', '18', '99']) expect(v({ forma_tpag: f, prazos_dias: [0] })).toEqual(rn(MOTIVO_FORMA_NAO_ACEITA, 'forma_tpag'));
  });

  it('RN-CAD-09: PATCH do cartão regera 30×N só quando parcelas_cartao muda e prazos_dias não vem', () => {
    const antes = { forma_tpag: '03', parcelas_cartao: 3 };
    expect(completarPrazosNoPatch({ parcelas_cartao: 6 }, antes).prazos_dias).toEqual(prazosDoCartao(6));
    expect(completarPrazosNoPatch({ parcelas_cartao: 3 }, antes).prazos_dias).toBeUndefined();
    expect(completarPrazosNoPatch({ parcelas_cartao: 6, prazos_dias: [7] }, antes).prazos_dias).toEqual([7]);
    expect(completarPrazosNoPatch({ parcelas_cartao: 6 }, { forma_tpag: '15', parcelas_cartao: null }).prazos_dias).toBeUndefined();
  });
});
