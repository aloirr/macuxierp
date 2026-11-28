import { describe, expect, it } from 'vitest';
import { PedidoFaturadoV1 } from '../contracts';
import { faturadoDaNota } from './eventos';
import { NotaAutorizadaLida } from './leitores';
import type { PedidoGravado } from './portas';

const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const nota = (extra: Record<string, unknown> = {}) => ({
  pedido_id: U(1),
  ambiente: 'producao',
  nota: { id: U(2), numero: 123, serie: 1, chave_acesso: '13261112345678000199550010000001231876543210', emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 5000 },
  itens: [{ sequencia: 2, quantidade: 10_000, valor_centavos: 3000 }, { sequencia: 1, quantidade: 20_000, valor_centavos: 2000 }],
  campo_futuro: 'x',
  ...extra,
});
const pedido = {
  id: U(1), numero: 7, origem: 'fdv', external_id: U(9), status: 'faturado', filial_id: U(3), cliente_id: U(4), vendedor_id: null, total_centavos: 5000,
  itens: [{ sequencia: 1, produto_id: U(5) }, { sequencia: 2, produto_id: U(6) }],
} as unknown as PedidoGravado;
const gerar = (n: Record<string, unknown>) => faturadoDaNota(NotaAutorizadaLida.parse(n), pedido, 'faturado', 'aprovado');

describe('faturadoDaNota (T-0015)', () => {
  it('T-0015: conta_como_real true é copiado, também em homologação', () => {
    const p = gerar(nota({ ambiente: 'homologacao', conta_como_real: true }));
    expect(p.ambiente).toBe('homologacao');
    expect(p.conta_como_real).toBe(true);
    expect(PedidoFaturadoV1.safeParse(p).success).toBe(true);
  });
  it('T-0015: conta_como_real false é copiado', () => {
    expect(gerar(nota({ conta_como_real: false })).conta_como_real).toBe(false);
  });
  it('T-0015: conta_como_real ausente continua ausente', () => {
    expect('conta_como_real' in gerar(nota())).toBe(false);
  });
  it('T-0015: itens vêm com o produto do pedido pela sequência', () => {
    const p = gerar(nota());
    expect(p.nota).toEqual({ id: U(2), numero: 123, serie: 1, chave: '13261112345678000199550010000001231876543210', emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 5000 });
    expect(p.itens_faturados).toEqual([
      { sequencia: 2, produto_id: U(6), quantidade: 10_000, valor_centavos: 3000 },
      { sequencia: 1, produto_id: U(5), quantidade: 20_000, valor_centavos: 2000 },
    ]);
    expect(p.status).toBe('faturado');
    expect(p.status_anterior).toBe('aprovado');
    expect(PedidoFaturadoV1.safeParse(p).success).toBe(true);
  });
  it('T-0015: nota de outro pedido é erro', () => {
    expect(() => gerar(nota({ pedido_id: U(8) }))).toThrow(/pedido/);
  });
  it('T-0015: sequência sem item no pedido é erro', () => {
    expect(() => gerar(nota({ itens: [{ sequencia: 9, quantidade: 1, valor_centavos: 1 }] }))).toThrow();
  });
  describe('RN-FIS-05 (63 A): ST e IPI por regra (T-0132)', () => {
    const calc = (v_bc: number, p_aliq: number, v_valor: number) => ({ v_bc, p_aliq, v_valor });
    const itemFiscal = (sequencia: number, valor: number) => ({
      sequencia, quantidade: 10_000, valor_centavos: valor, regra_aplicada: { st: true, ipi: true }, calc_st: calc(valor, 180000, 180), calc_ipi: calc(valor, 50000, 25),
    });
    it('RN-FIS-05: nota sem regra gera o evento idêntico ao antigo (nada de calc_*)', () => {
      const p = gerar(nota());
      expect(p.itens_faturados.every((i) => !('regra_aplicada' in i) && !('calc_st' in i) && !('calc_ipi' in i))).toBe(true);
      expect('calc_st' in p.nota || 'calc_ipi' in p.nota).toBe(false);
    });
    it('RN-FIS-05: itens com regra propagam regra_aplicada e calc_*; nota.calc_* soma os itens', () => {
      const p = gerar(nota({ itens: [itemFiscal(2, 3000), itemFiscal(1, 2000)] }));
      expect(p.itens_faturados[0]).toEqual({
        sequencia: 2, produto_id: U(6), quantidade: 10_000, valor_centavos: 3000, regra_aplicada: { st: true, ipi: true }, calc_st: calc(3000, 180000, 180), calc_ipi: calc(3000, 50000, 25),
      });
      expect(p.nota.calc_st).toEqual({ v_bc: 5000, v_valor: 360 });
      expect(p.nota.calc_ipi).toEqual({ v_bc: 5000, v_valor: 50 });
      expect(PedidoFaturadoV1.safeParse(p).success).toBe(true);
    });
    it('RN-FIS-05: item sem regra na nota omite os totais; os outros itens mantêm o calc_*', () => {
      const p = gerar(nota({ itens: [itemFiscal(2, 3000), { sequencia: 1, quantidade: 20_000, valor_centavos: 2000 }] }));
      expect('calc_st' in p.nota || 'calc_ipi' in p.nota).toBe(false);
      expect(p.itens_faturados[0]?.calc_st).toBeDefined();
      expect(p.itens_faturados[1]).toEqual({ sequencia: 1, produto_id: U(5), quantidade: 20_000, valor_centavos: 2000 });
    });
    it('RN-FIS-05: nota parcial (um item) leva o total só dele', () => {
      const p = gerar(nota({ itens: [itemFiscal(1, 2000)] }));
      expect(p.nota.calc_st).toEqual({ v_bc: 2000, v_valor: 180 });
    });
    it('RN-FIS-05: calc_* sem regra_aplicada na nota (emissor antigo) é descartado', () => {
      const p = gerar(nota({ itens: [{ sequencia: 1, quantidade: 1, valor_centavos: 1, calc_st: calc(1, 1, 1) }] }));
      expect(p.itens_faturados[0]).not.toHaveProperty('calc_st');
      expect(p.nota).not.toHaveProperty('calc_st');
    });
  });
});
