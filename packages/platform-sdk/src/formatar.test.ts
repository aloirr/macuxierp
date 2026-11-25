import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pacote from '../package.json';
import { centavos } from './dinheiro';
import * as indice from './index';
import {
  formatarCentavos,
  formatarCep,
  formatarDataCivil,
  formatarDataHora,
  formatarDocumento,
  formatarPontosBase,
  formatarQuantidade,
  formatarReaisDecimal,
  formatarValorCentavos,
  interpretarCentavos,
  interpretarQuantidade,
  PREFIXO_REAL,
} from './formatar';

// Casos trazidos de modules/cadastros/web/formatar.test.ts, modules/pedido/web/web.test.ts (RD-0362) e apps/web/src/lib/cnpj.test.ts.
describe('formatação de exibição do BKO (RD-0362)', () => {
  it('data civil e CEP (fonte única do faturamento e do apps): formato válido mascarado; o resto volta como está', () => {
    expect(formatarDataCivil('2026-11-25')).toBe('25/11/2026');
    for (const d of ['', '25/11/2026', '2026-11-25T10:00:00Z', '2026-1-5']) expect(formatarDataCivil(d)).toBe(d);
    expect(formatarCep('69000000')).toBe('69000-000');
    for (const c of ['', '69000-000', '6900000', '690000000']) expect(formatarCep(c)).toBe(c);
  });

  it('RN-CAD-01: mostra CNPJ e CPF com máscara; CNPJ alfanumérico também', () => {
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(formatarDocumento('123')).toBe('123');
  });

  it('dinheiro: centavos inteiros viram R$ e voltam sem float; R-20261122-035009: R$ e valor juntos por U+00A0 (PREFIXO_REAL)', () => {
    expect(PREFIXO_REAL).toBe('R$\u00a0');
    expect(formatarCentavos(123456)).toBe('R$\u00a01.234,56');
    expect(formatarCentavos(123456)).not.toContain('R$ ');
    expect(formatarCentavos(5)).toBe('R$\u00a00,05');
    expect(formatarCentavos(-250)).toBe('-R$\u00a02,50');
    expect(formatarCentavos(centavos(100_000_000_00))).toBe('R$\u00a0100.000.000,00');
    expect(formatarCentavos(0)).toBe('R$\u00a00,00');
    expect(interpretarCentavos('1.234,56')).toBe(123456);
    expect(interpretarCentavos('0,05')).toBe(5);
    expect(interpretarCentavos(' 12,5 ')).toBe(1250);
    expect(interpretarCentavos('abc')).toBeNull();
    expect(interpretarCentavos('1,234')).toBeNull();
  });

  it('dinheiro fora de centavo inteiro não é formatado (regra 4: nunca float)', () => {
    expect(() => formatarCentavos(1.5)).toThrow(RangeError);
  });

  it('RD-0706: o valor em centavos sem o prefixo R$, com a mesma conta e o mesmo RangeError do formatarCentavos', () => {
    expect(formatarValorCentavos(123456)).toBe('1.234,56');
    expect(formatarValorCentavos(-250)).toBe('-2,50');
    expect(formatarValorCentavos(5)).toBe('0,05');
    expect(formatarValorCentavos(0)).toBe('0,00');
    expect(formatarValorCentavos(centavos(100_000_000_00))).toBe('100.000.000,00');
    expect(() => formatarValorCentavos(1.5)).toThrow(RangeError);
    for (const c of [0, 5, 123456, -250, -1, 100_000_000_00]) {
      expect(formatarCentavos(c)).toBe(`${c < 0 ? '-' : ''}R$\u00a0${formatarValorCentavos(Math.abs(c))}`);
    }
  });

  it('D11: quantidade × 10^4 vira decimal e volta sem float', () => {
    expect(formatarQuantidade(125_000)).toBe('12,5');
    expect(formatarQuantidade(-10_000)).toBe('-1');
    expect(formatarQuantidade(1)).toBe('0,0001');
    expect(formatarQuantidade(12_345_670_000)).toBe('1.234.567');
    expect(interpretarQuantidade('12,5')).toBe(125_000);
    expect(interpretarQuantidade('0,0001')).toBe(1);
    expect(interpretarQuantidade('-1')).toBe(-10_000);
    expect(interpretarQuantidade('1,00001')).toBeNull();
  });

  it('R-20261122-055654: interpretarQuantidade aceita o ponto de milhar pt-BR só em grupos de 3 dígitos', () => {
    expect(interpretarQuantidade('1.500')).toBe(15_000_000);
    expect(interpretarQuantidade('1.500,25')).toBe(15_002_500);
    expect(interpretarQuantidade('1.234.567,0001')).toBe(12_345_670_001);
    expect(interpretarQuantidade('-1.500')).toBe(-15_000_000);
    expect(interpretarQuantidade(' 1.500 ')).toBe(15_000_000);
    expect(interpretarQuantidade('1500')).toBe(15_000_000);
    for (const ruim of ['1.5', '1.50', '1.5000', '.500', '1.', '1..500', '1.500.', '1234.567', '+1.500', '--1', '1,500.25']) {
      expect(interpretarQuantidade(ruim), ruim).toBeNull();
    }
  });

  it('RD-0735: decimal em texto do XML da NF-e vira R$ sem float (DANFE do faturamento)', () => {
    expect(formatarReaisDecimal('1234.5', 2)).toBe('R$\u00a01.234,50');
    expect(formatarReaisDecimal('10', 2)).toBe('R$\u00a010,00');
    expect(formatarReaisDecimal('-2.5', 2)).toBe('-R$\u00a02,50');
    expect(formatarReaisDecimal('-0.00', 2)).toBe('R$\u00a00,00');
    expect(formatarReaisDecimal('12.3456', 4)).toBe('R$\u00a012,3456');
    expect(formatarReaisDecimal('12.3', 4)).toBe('R$\u00a012,3000');
    expect(formatarReaisDecimal('7', 0)).toBe('R$\u00a07');
    // zero à direita além das casas não muda o valor e é aceito (o XML traz vUnCom com até 10 casas)
    expect(formatarReaisDecimal('1.2300000000', 2)).toBe('R$\u00a01,23');
    // acima de 2^53: a conta é em BigInt, sem perder dígito
    expect(formatarReaisDecimal('123456789012345678.91', 2)).toBe('R$\u00a0123.456.789.012.345.678,91');
    // mesmo texto que o formatarCentavos para o mesmo valor
    for (const c of [0, 5, 123456, -250, 100_000_000_00]) {
      const t = `${c < 0 ? '-' : ''}${Math.trunc(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
      expect(formatarReaisDecimal(t, 2)).toBe(formatarCentavos(c));
    }
  });

  it('RD-0735: decimal fora do formato ou com mais casas que as pedidas é RangeError (o DANFE não arredonda por conta própria)', () => {
    for (const ruim of ['', 'abc', '1,5', '1.', '.5', '1e3', ' 1.5', '+1.5', '1.234.5', 'NaN']) {
      expect(() => formatarReaisDecimal(ruim, 2), ruim).toThrow(RangeError);
    }
    expect(() => formatarReaisDecimal('1.234', 2)).toThrow(RangeError);
    expect(() => formatarReaisDecimal('1.5', -1)).toThrow(RangeError);
    expect(() => formatarReaisDecimal('1.5', 1.5)).toThrow(RangeError);
  });

  it('pontos-base viram percentual sem zeros à direita', () => {
    expect(formatarPontosBase(1250)).toBe('12,5%');
    expect(formatarPontosBase(500)).toBe('5%');
    expect(formatarPontosBase(1)).toBe('0,01%');
    expect(formatarPontosBase(0)).toBe('0%');
    expect(formatarPontosBase(-50)).toBe('-0,5%');
  });

  it('regra 4: instante UTC exibido no fuso do tenant, que entra como parâmetro', () => {
    expect(formatarDataHora('2026-11-21T23:05:00Z', 'America/Manaus')).toBe('21/11/2026 19:05');
    expect(formatarDataHora('2026-11-22T02:30:00Z', 'America/Manaus')).toBe('21/11/2026 22:30');
    expect(formatarDataHora('2026-11-21T23:05:00Z', 'America/Sao_Paulo')).toBe('21/11/2026 20:05');
    expect(formatarDataHora('2026-11-21T23:05:00Z', 'UTC')).toBe('21/11/2026 23:05');
    expect(formatarDataHora('2026-11-22T04:00:00Z', 'America/Manaus')).toBe('22/11/2026 00:00');
    expect(formatarDataHora('não é data', 'America/Manaus')).toBe('não é data');
  });

  it('sai pelo índice do pacote, além do subcaminho ./formatar', () => {
    expect(indice.formatarCentavos).toBe(formatarCentavos);
    expect(indice.formatarDataHora).toBe(formatarDataHora);
    expect(indice.formatarDocumento).toBe(formatarDocumento);
    expect(indice.formatarPontosBase).toBe(formatarPontosBase);
    expect(indice.formatarQuantidade).toBe(formatarQuantidade);
    expect(indice.formatarValorCentavos).toBe(formatarValorCentavos);
    expect(indice.interpretarCentavos).toBe(interpretarCentavos);
    expect(indice.interpretarQuantidade).toBe(interpretarQuantidade);
    expect(indice.formatarReaisDecimal).toBe(formatarReaisDecimal);
    expect(indice.PREFIXO_REAL).toBe(PREFIXO_REAL);
  });

  it('subcaminho @macuxierp/platform-sdk/formatar, sem dependência de Node (o shell importa no navegador)', () => {
    expect((pacote.exports as Record<string, string>)['./formatar']).toBe('./src/formatar.ts');
    const fonte = readFileSync(new URL('./formatar.ts', import.meta.url), 'utf8');
    expect(fonte).not.toMatch(/^\s*import\s/m);
  });
});
