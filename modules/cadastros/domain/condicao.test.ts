import { describe, expect, it } from 'vitest';
import { FORMAS_A_VISTA, MAX_DIAS } from '../contracts';
import {
  MOTIVO_A_VISTA, MOTIVO_BOLETO, MOTIVO_CARTAO_PRAZOS, MOTIVO_DESCRICAO, MOTIVO_FORMA_NAO_ACEITA, MOTIVO_PRAZO_MEDIO, MOTIVO_PRAZO_MEDIO_FAIXA, completarPrazoMedio, decidirPrazoMedioGravado, derivarParcelasCartao, faixaClientesAfetados, faixaSeAplica, prazoMedioForaDaFaixa, prazoMedioEfetivo, validarCondicaoPagamento as v,
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
    expect(v({ forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 5 })).toEqual(rn(MOTIVO_PRAZO_MEDIO_FAIXA, 'prazo_medio_dias', 'RN-CAD-15'));
  });
  it('RN-CAD-15 (T-0112): prazo médio digitado fica entre a menor e a maior parcela, inclusive', () => {
    for (const m of [28, 42, 56]) expect(v({ forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: m })).toEqual([]);
    for (const m of [27, 57]) expect(v({ forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: m })).toEqual(rn('O prazo médio precisa ficar entre a menor e a maior parcela.', 'prazo_medio_dias', 'RN-CAD-15'));
    expect(v({ forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 0 })).toEqual([]);
    expect(v({ forma_tpag: '01', prazos_dias: [0], prazo_medio_dias: 1 })).toEqual(rn(MOTIVO_PRAZO_MEDIO_FAIXA, 'prazo_medio_dias', 'RN-CAD-15'));
  });
  it('RN-CAD-15 (T-0112): quem inativa a condição não é recusado pela faixa; as demais regras seguem; parcelas inválidas não geram a faixa', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 90, inativa: true })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 90, descricao: ' ', inativa: true })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [], prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_BOLETO, 'prazos_dias'));
    expect(v({ forma_tpag: '15', prazos_dias: [30, 366], prazo_medio_dias: 400 })).toHaveLength(2);
  });
  it('RN-CAD-15 (decisão 14 A): prazo médio vazio (ausente ou nulo) não é erro; o ERP preenche; fora de 0..365 recusa', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [30] })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: null })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: MAX_DIAS + 1 })).toEqual(rn(MOTIVO_PRAZO_MEDIO, 'prazo_medio_dias', 'RN-CAD-15'));
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: -1 })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [365], prazo_medio_dias: 365 })).toEqual([]);
  });
  it('RN-CAD-15: descrição em branco é recusada no campo descricao', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30, descricao: '  ' })).toEqual(rn(MOTIVO_DESCRICAO, 'descricao', 'RN-CAD-15'));
    expect(v({ forma_tpag: '15', prazos_dias: [30], prazo_medio_dias: 30, descricao: 'Boleto 30' })).toEqual([]);
  });
  it('RN-CAD-09 emendada pela RN-CAD-15: cartão tem os dias digitados (1 a 12 parcelas, qualquer dia de 0 a 365)', () => {
    expect(v({ forma_tpag: '03', prazos_dias: [30], prazo_medio_dias: 30 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: [7, 21, 45], prazo_medio_dias: 24 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: Array(12).fill(30), prazo_medio_dias: 30 })).toEqual([]);
    expect(v({ forma_tpag: '03', prazos_dias: Array(13).fill(30), prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_CARTAO_PRAZOS, 'prazos_dias'));
    expect(v({ forma_tpag: '03', prazos_dias: [], prazo_medio_dias: 30 })).toHaveLength(1);
    expect(v({ forma_tpag: '03', prazos_dias: [366], prazo_medio_dias: 30 })).toHaveLength(1);
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
  it('RN-CAD-15: boleto aceita 1 a 24 parcelas de 0 a 365 dias (365 vale, 366 e 25 parcelas não) e recusa parcelas_cartao', () => {
    expect(v({ forma_tpag: '15', prazos_dias: [0], prazo_medio_dias: 0 })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: [30, 60], prazo_medio_dias: 45 })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: Array(24).fill(365), prazo_medio_dias: 365 })).toEqual([]);
    expect(v({ forma_tpag: '15', prazos_dias: Array(25).fill(30), prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_BOLETO, 'prazos_dias'));
    expect(v({ forma_tpag: '15', prazos_dias: [366], prazo_medio_dias: 30 })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [], prazo_medio_dias: 30 })).toHaveLength(1);
    expect(v({ forma_tpag: '15', prazos_dias: [30], parcelas_cartao: 3, prazo_medio_dias: 30 })).toEqual(rn(MOTIVO_BOLETO, 'parcelas_cartao'));
  });
  it('RN-CAD-09: outra forma (cheque 02, depósito 16, 99) é recusada com a mensagem exata, sem ecoar o valor', () => {
    expect(MOTIVO_FORMA_NAO_ACEITA).toBe('forma não aceita: use Dinheiro, PIX, Cartão ou Boleto');
    for (const f of ['02', '16', '18', '99']) expect(v({ forma_tpag: f, prazos_dias: [0], prazo_medio_dias: 0 })).toEqual(rn(MOTIVO_FORMA_NAO_ACEITA, 'forma_tpag'));
  });
});

describe('prazo médio efetivo (RN-CAD-15, decisão 14 A)', () => {
  it('RN-CAD-15: prazo médio digitado, inclusive 0, vale ele mesmo', () => {
    expect(prazoMedioEfetivo([30, 60], 10)).toBe(10);
    expect(prazoMedioEfetivo([30, 60], 0)).toBe(0);
  });
  it('RN-CAD-15: vazio (nulo ou ausente) vira a média simples das parcelas, meio para cima', () => {
    expect(prazoMedioEfetivo([30, 45], null)).toBe(38);
    expect(prazoMedioEfetivo([28, 56, 84], undefined)).toBe(56);
    expect(prazoMedioEfetivo([0], null)).toBe(0);
    expect(prazoMedioEfetivo([30], null)).toBe(30);
    expect(prazoMedioEfetivo([30, 60], null)).toBe(45);
  });
  it('RN-CAD-15: sem parcelas devolve null', () => {
    expect(prazoMedioEfetivo([], null)).toBeNull();
    expect(prazoMedioEfetivo(null, undefined)).toBeNull();
  });
  it('RN-CAD-15: o efetivo fica entre a menor e a maior parcela (exigência do Hub)', () => {
    const casos = [[30, 45], [28, 56, 84], [0], [1, 2], [0, 1, 1], [7, 14, 21, 28, 35], [0, 365], [364, 365, 365]];
    for (const c of casos) {
      const m = prazoMedioEfetivo(c, null) as number;
      expect(m).toBeGreaterThanOrEqual(Math.min(...c));
      expect(m).toBeLessThanOrEqual(Math.max(...c));
      expect(v({ forma_tpag: '15', prazos_dias: c, prazo_medio_dias: m })).toEqual([]); // T-0112: o calculado passa pela faixa
    }
  });
  it('RN-CAD-15 (decisão 17 B): na criação, vazio calcula e marca prazo_medio_calculado = true; digitado, inclusive 0, vale e marca false', () => {
    expect(completarPrazoMedio({ prazos_dias: [30, 45] })).toMatchObject({ prazo_medio_dias: 38, prazo_medio_calculado: true });
    expect(completarPrazoMedio({ prazos_dias: [30, 45], prazo_medio_dias: null })).toMatchObject({ prazo_medio_dias: 38, prazo_medio_calculado: true });
    expect(completarPrazoMedio({ prazos_dias: [30, 45], prazo_medio_dias: 0 })).toMatchObject({ prazo_medio_dias: 0, prazo_medio_calculado: false });
    expect(completarPrazoMedio({ prazos_dias: [30, 45], prazo_medio_dias: 7 })).toMatchObject({ prazo_medio_dias: 7, prazo_medio_calculado: false });
  });
  it('RN-CAD-15 (decisão 17 B): PATCH com a marca true e parcelas novas recalcula e a marca continua true', () => {
    const calculado = { prazos_dias: [30], prazo_medio_dias: 30, prazo_medio_calculado: true };
    expect(completarPrazoMedio({ prazos_dias: [30, 60] }, calculado)).toMatchObject({ prazo_medio_dias: 45, prazo_medio_calculado: true });
  });
  it('RN-CAD-15 (decisão 17 B): PATCH com a marca false e parcelas novas mantém o digitado (corpo sem o campo)', () => {
    const digitado = { prazos_dias: [30], prazo_medio_dias: 30, prazo_medio_calculado: false };
    expect(completarPrazoMedio({ prazos_dias: [30, 60] }, digitado)).toEqual({ prazos_dias: [30, 60] });
    expect(completarPrazoMedio({ prazos_dias: [30, 60] }, { prazos_dias: [30], prazo_medio_dias: 30 })).toEqual({ prazos_dias: [30, 60] });
  });
  it('RN-CAD-15 (decisão 17 B): PATCH com valor digitado vale e marca false, mesmo se estava calculado', () => {
    const calculado = { prazos_dias: [30], prazo_medio_dias: 30, prazo_medio_calculado: true };
    expect(completarPrazoMedio({ prazo_medio_dias: 0 }, calculado)).toMatchObject({ prazo_medio_dias: 0, prazo_medio_calculado: false });
    expect(completarPrazoMedio({ prazos_dias: [30, 60], prazo_medio_dias: 7 }, calculado)).toMatchObject({ prazo_medio_dias: 7, prazo_medio_calculado: false });
  });
  it('RN-CAD-15 (decisão 17 B): PATCH que apaga o valor (null explícito) calcula de novo, com as parcelas do corpo ou as gravadas, e marca true', () => {
    const digitado = { prazos_dias: [30, 60], prazo_medio_dias: 7, prazo_medio_calculado: false };
    expect(completarPrazoMedio({ prazo_medio_dias: null }, digitado)).toMatchObject({ prazo_medio_dias: 45, prazo_medio_calculado: true });
    expect(completarPrazoMedio({ prazos_dias: [10, 20], prazo_medio_dias: null }, digitado)).toMatchObject({ prazo_medio_dias: 15, prazo_medio_calculado: true });
  });
  it('RN-CAD-15 (decisão 17 B): legado vazio no banco (sem valor e sem marca) com parcelas no PATCH calcula e marca true; sem parcelas no corpo, volta como veio', () => {
    const vazio = { prazos_dias: [30], prazo_medio_dias: null };
    expect(completarPrazoMedio({ prazos_dias: [30, 60] }, vazio)).toMatchObject({ prazo_medio_dias: 45, prazo_medio_calculado: true });
    expect(completarPrazoMedio({ forma_tpag: 'x' } as { prazos_dias?: number[] }, vazio)).toEqual({ forma_tpag: 'x' });
  });
});

describe('v0.3.18: prazos médios gravados (RN-CAD-15, RN-CAD-16)', () => {
  it('RN-CAD-15: validarCondicaoPagamento com semFaixa não confere a faixa (linha que muda só a forma)', () => {
    const c = { forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 90 };
    expect(v(c)).toHaveLength(1);
    expect(v({ ...c, semFaixa: true })).toEqual([]);
  });

  it('RN-CAD-15: prazoMedioForaDaFaixa só vale com número e parcelas', () => {
    expect(prazoMedioForaDaFaixa([28, 56], 57)).toBe(true);
    expect(prazoMedioForaDaFaixa([28, 56], 27)).toBe(true);
    expect(prazoMedioForaDaFaixa([28, 56], 28)).toBe(false);
    expect(prazoMedioForaDaFaixa([], 5)).toBe(false);
    expect(prazoMedioForaDaFaixa([28], null)).toBe(false);
  });

  it('RN-CAD-15 (D1 A): decide completar o nulo, corrigir o fora da faixa e deixar o resto', () => {
    expect(decidirPrazoMedioGravado({ prazos_dias: [30, 45], prazo_medio_dias: null })).toEqual({ acao: 'completar', antes: null, depois: 38 });
    expect(decidirPrazoMedioGravado({ prazos_dias: [30, 60], prazo_medio_dias: 90 })).toEqual({ acao: 'corrigir', antes: 90, depois: 45 });
    expect(decidirPrazoMedioGravado({ prazos_dias: [30, 60], prazo_medio_dias: 0 })).toEqual({ acao: 'corrigir', antes: 0, depois: 45 });
    expect(decidirPrazoMedioGravado({ prazos_dias: [30, 60], prazo_medio_dias: 30 })).toEqual({ acao: 'nenhuma' });
    expect(decidirPrazoMedioGravado({ prazos_dias: [], prazo_medio_dias: null })).toEqual({ acao: 'nenhuma' });
  });

  it('RN-CAD-16: faixa de prazo médio de cliente afetada; o cartão (03) não depende dele', () => {
    expect(faixaClientesAfetados('15', 90, 45)).toEqual({ de: 45, ate: 90 });
    expect(faixaClientesAfetados('15', 10, 45)).toEqual({ de: 10, ate: 45 });
    expect(faixaClientesAfetados('15', null, 38)).toEqual({ de: 38, ate: null });
    expect(faixaClientesAfetados('03', 90, 45)).toBeNull();
  });
});

describe('RN-CAD-15: faixaSeAplica (única para a carga e o PATCH)', () => {
  const gravada = { forma_tpag: '15', prazos_dias: [28, 56], prazo_medio_dias: 90, inativo: false };
  it('RN-CAD-15: mudar só a forma não confere a faixa', () => expect(faixaSeAplica({ gravada, nova: { forma_tpag: '17', prazos_dias: [28, 56] } })).toBe(false));
  it('RN-CAD-15: mudar parcelas ou prazo médio, com a condição ativa, confere', () => {
    expect(faixaSeAplica({ gravada, nova: { prazos_dias: [30, 60] } })).toBe(true);
    expect(faixaSeAplica({ gravada, nova: { prazo_medio_dias: 40 } })).toBe(true);
  });
  it('RN-CAD-15: reativar confere; inativar nunca', () => {
    expect(faixaSeAplica({ gravada: { ...gravada, inativo: true }, nova: { inativo: false } })).toBe(true);
    expect(faixaSeAplica({ gravada, nova: { inativo: true, prazos_dias: [30, 60] } })).toBe(false);
  });
});
