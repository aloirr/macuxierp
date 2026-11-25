import type { Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarUsosPedidosFaturamento } from './usos-pedidos';

const T = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function txFalso(r: unknown) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const tx = { consultar: async (sql: string, p: readonly unknown[] = []) => { chamadas.push({ sql, p }); return [{ r }]; } } as unknown as Transacao;
  return { tx, chamadas };
}

const { pedidosComNotaOuTitulo } = criarUsosPedidosFaturamento();

describe('pedidosComNotaOuTitulo (Zerar por cadastro)', () => {
  it('RN-CAD-10: lista vazia de ids não vai ao banco', async () => {
    const { tx, chamadas } = txFalso({});
    expect(await pedidosComNotaOuTitulo(tx, T, [])).toEqual({ comNota: [], comTitulo: [] });
    expect(chamadas).toHaveLength(0);
  });
  it('RN-CAD-10: chama portal_pedidos_com_uso com ids deduplicados e mapeia com_nota/com_titulo', async () => {
    const { tx, chamadas } = txFalso({ com_nota: [A, A], com_titulo: [B] });
    expect(await pedidosComNotaOuTitulo(tx, T, [A, B, A])).toEqual({ comNota: [A], comTitulo: [B] });
    expect(chamadas[0]?.sql).toContain('faturamento.portal_pedidos_com_uso');
    expect(chamadas[0]?.p).toEqual([T, [A, B]]);
  });
  it('RN-CAD-10: retorno fora do contrato é recusado (não zera às cegas)', async () => {
    await expect(pedidosComNotaOuTitulo(txFalso({ com_nota: ['x'], com_titulo: [] }).tx, T, [A])).rejects.toThrow();
    await expect(pedidosComNotaOuTitulo(txFalso(null).tx, T, [A])).rejects.toThrow();
  });
});
