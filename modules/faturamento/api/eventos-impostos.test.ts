import { describe, expect, it } from 'vitest';
import { NotaAutorizadaPayload } from '../contracts';
import { baseEventoDaNota } from './eventos';
import type { NotaRegistro } from './portas';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const st = { v_bc: 10_000, p_aliq: 180_000, v_valor: 1800 };
const nota = (itens: NotaRegistro['itens']): NotaRegistro =>
  ({ id: U(1), pedido_id: U(2), filial_id: U(3), cliente_id: U(4), vendedor_id: null, ambiente: 'producao', serie: 1, numero: 5, chave_acesso: '13261112345678000199550010000000051000000010', emitida_em: '2026-11-28T12:00:00.000Z', total_centavos: 10_000, itens }) as NotaRegistro;
const valido = (n: NotaRegistro) => NotaAutorizadaPayload.parse({ ...baseEventoDaNota(n, '123456789012345'), pedido_uuid: null });

describe('ST e IPI nos eventos da nota (RN-FIS-05, @1 compatível)', () => {
  it('RN-FIS-05: com regra em todos os itens, item e total saem; calc_ipi omitido', () => {
    const p = valido(nota([{ sequencia: 1, quantidade: 10_000, valor_centavos: 10_000, regra_aplicada: { st: true, ipi: false }, calc_st: st }]));
    expect(p.itens[0]?.regra_aplicada).toEqual({ st: true, ipi: false });
    expect(p.itens[0]?.calc_st).toEqual(st);
    expect(p.totais).toEqual({ calc_st: { v_bc: 10_000, v_valor: 1800 } });
    expect(p.itens[0]).not.toHaveProperty('calc_ipi');
  });
  it('RN-FIS-05: item sem regra omite o total e o payload antigo (sem os campos) continua válido', () => {
    const p = valido(nota([{ sequencia: 1, quantidade: 10_000, valor_centavos: 5000, calc_st: st }, { sequencia: 2, quantidade: 10_000, valor_centavos: 5000 }]));
    expect(p).not.toHaveProperty('totais');
    expect(Object.keys(baseEventoDaNota(nota([{ sequencia: 1, quantidade: 1, valor_centavos: 1 }]), null))).not.toContain('totais');
  });
});
