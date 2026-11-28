import { describe, expect, it } from 'vitest';
import type { RetornoErp } from '../contracts';
import { corpoComBandeira } from './retorno-pedidos';

const corpo: RetornoErp = {
  versao_contrato: 'v1',
  pedido_uuid: '00000000-0000-4000-8000-000000000002',
  status: 'faturado_total',
  ocorrido_em: '2026-11-21T18:00:00.000Z',
  nota: { numero: '10', serie: '1', chave: '1'.repeat(44), emitida_em: '2026-11-21T18:00:00.000Z', total_cents: 1000, v_icms_st_cents: 360, v_ipi_cents: 500 },
  itens_faturados: [{ sequencia: 1, produto_external_id: 'P001', quantidade: 1, valor_cents: 1000, v_icms_st_cents: 360, v_ipi_cents: 500 }],
};

describe('retorno-pedidos: bandeira de ST e IPI (T-0132)', () => {
  it('T-0132: desligada (padrão), o payload sai sem os dois campos, igual ao de hoje', () => {
    const c = corpoComBandeira('t1', corpo);
    expect(JSON.stringify(c)).not.toMatch(/v_icms_st_cents|v_ipi_cents/);
    expect(c.nota?.total_cents).toBe(1000);
  });
  it('T-0132: ligada, o payload sai com os campos do item e do total', () => {
    const c = corpoComBandeira('t1', corpo, (t) => t === 't1');
    expect(c).toEqual(corpo);
  });
});
