import { describe, expect, it } from 'vitest';
import type { ItemResultado } from '@macuxierp/fiscal/contracts';
import { calc } from './fixtures';
import { impostosDoItemEvento, totaisImpostosEvento, valoresFiscais } from './nota';

const st = { v_bc: 10_000, p_aliq: 180_000, v_valor: 1800 };
const ipi = { v_bc: 10_000, p_aliq: 50_000, v_valor: 500 };
const comRegra = (extra: Partial<ItemResultado> = {}): ItemResultado => calc(1, { regra_aplicada: { st: true, ipi: true }, calc_st: st, calc_ipi: ipi, ...extra }).resultado;
const semRegra = (): ItemResultado => calc(2).resultado;

describe('ST e IPI do item nos eventos da nota (RN-FIS-05, regra 63 A)', () => {
  it('RN-FIS-05: item com regra publica calc_st e calc_ipi como o fiscal devolveu', () => {
    expect(impostosDoItemEvento(comRegra())).toEqual({ regra_aplicada: { st: true, ipi: true }, calc_st: st, calc_ipi: ipi });
  });
  it('RN-FIS-05: item sem regra (ou emissor antigo sem regra_aplicada) omite os dois campos', () => {
    expect(impostosDoItemEvento(semRegra())).toEqual({});
  });
  it('RN-FIS-05: o imposto sem regra é omitido e o outro continua (item misto)', () => {
    const r = comRegra({ regra_aplicada: { st: true, ipi: false }, calc_ipi: undefined });
    expect(impostosDoItemEvento(r)).toEqual({ regra_aplicada: { st: true, ipi: false }, calc_st: st });
  });
  it('RN-FIS-05: valor 0 com regra é publicado como 0, não omitido', () => {
    const zero = { v_bc: 0, p_aliq: 180_000, v_valor: 0 };
    expect(impostosDoItemEvento(comRegra({ calc_st: zero }))).toEqual({ regra_aplicada: { st: true, ipi: true }, calc_st: zero, calc_ipi: ipi });
  });
  it('RN-FIS-05: calc_* sem o indicador regra_aplicada = true não é publicado (não deduz de v_st/v_ipi)', () => {
    expect(impostosDoItemEvento(calc(1, { calc_st: st, icms: { orig: '0', cst: '10', v_icms_st: 1800 } }).resultado)).toEqual({});
  });
});

describe('totais de ST e IPI nos eventos da nota (RN-FIS-05)', () => {
  it('RN-FIS-05: soma dos itens quando TODOS têm regra do imposto', () => {
    const itens = [impostosDoItemEvento(comRegra()), impostosDoItemEvento(comRegra())];
    expect(totaisImpostosEvento(itens)).toEqual({ calc_st: { v_bc: 20_000, v_valor: 3600 }, calc_ipi: { v_bc: 20_000, v_valor: 1000 } });
  });
  it('RN-FIS-05: total omitido se algum item não tem regra daquele imposto', () => {
    const itens = [impostosDoItemEvento(comRegra()), impostosDoItemEvento(semRegra())];
    expect(totaisImpostosEvento(itens)).toBeUndefined();
  });
  it('RN-FIS-05: total de um imposto sai e o do outro não quando só ele cobre todos os itens', () => {
    const itens = [impostosDoItemEvento(comRegra()), impostosDoItemEvento(comRegra({ regra_aplicada: { st: true, ipi: false }, calc_ipi: undefined }))];
    expect(totaisImpostosEvento(itens)).toEqual({ calc_st: { v_bc: 20_000, v_valor: 3600 } });
  });
  it('RN-FIS-05: sem itens não há total', () => {
    expect(totaisImpostosEvento([])).toBeUndefined();
  });
});

describe('XML da NF-e segue o Manual, não o retorno ao FDV (RN-FIS-05, RF-FAT-01)', () => {
  it('RF-FAT-01: sem regra o XML continua com vST e vIPI em 0 (leiaute), mesmo que o retorno ao FDV os omita', () => {
    const v = valoresFiscais(semRegra());
    expect(v.vST).toBe(0);
    expect(v.vIPI).toBe(0);
    expect(impostosDoItemEvento(semRegra())).toEqual({});
  });
  it('RF-FAT-01: o XML continua lendo icms.v_icms_st e ipi.v_ipi, não calc_*', () => {
    const r = comRegra({ icms: { orig: '0', cst: '10', v_bc_st: 10_000, v_icms_st: 1800 }, ipi: { cst: '50', v_bc: 10_000, p_ipi: 50_000, v_ipi: 500 } as ItemResultado['ipi'] });
    expect(valoresFiscais(r)).toMatchObject({ vBCST: 10_000, vST: 1800, vIPI: 500 });
  });
});
