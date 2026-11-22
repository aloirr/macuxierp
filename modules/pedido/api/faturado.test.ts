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
  it('T-0015: conta_como_real true é copiado', () => {
    const p = gerar(nota({ conta_como_real: true }));
    expect(p.conta_como_real).toBe(true);
    expect(PedidoFaturadoV1.safeParse(p).success).toBe(true);
  });
  it('T-0015: conta_como_real false é copiado', () => {
    expect(gerar(nota({ conta_como_real: false })).conta_como_real).toBe(false);
  });
  it('T-0015: conta_como_real ausente continua ausente', () => {
    expect('conta_como_real' in gerar(nota())).toBe(false);
  });
  it('T-0015: homologação com conta_como_real true (NF-e simulada conta como real)', () => {
    const p = gerar(nota({ ambiente: 'homologacao', conta_como_real: true }));
    expect(p.ambiente).toBe('homologacao');
    expect(p.conta_como_real).toBe(true);
    expect(PedidoFaturadoV1.safeParse(p).success).toBe(true);
  });
  it('T-0015: chave alfanumérica passa e os itens vêm com o produto do pedido pela sequência', () => {
    const chave = '13261112AB34CD01DE3555001000000123187654321' + '0';
    const p = gerar(nota({ nota: { ...nota().nota, chave_acesso: chave } }));
    expect(p.nota).toEqual({ id: U(2), numero: 123, serie: 1, chave, emitida_em: '2026-11-22T10:00:00.000Z', total_centavos: 5000 });
    expect(p.itens_faturados).toEqual([
      { sequencia: 2, produto_id: U(6), quantidade: 10_000, valor_centavos: 3000 },
      { sequencia: 1, produto_id: U(5), quantidade: 20_000, valor_centavos: 2000 },
    ]);
    expect(p.status).toBe('faturado');
    expect(p.status_anterior).toBe('aprovado');
    expect(PedidoFaturadoV1.safeParse(p).success).toBe(true);
  });
  it('T-0015: sequência sem item no pedido é erro', () => {
    expect(() => gerar(nota({ itens: [{ sequencia: 9, quantidade: 1, valor_centavos: 1 }] }))).toThrow();
  });
});
