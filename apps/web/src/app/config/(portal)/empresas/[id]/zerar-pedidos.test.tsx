import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ZeragemPedidosResposta } from '@macuxierp/pedido/contracts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import { AVISO_ZERAR } from '@/lib/config/cargas';
import { ZerarPedidos } from './zerar-pedidos';

const EMP = '11111111-1111-4111-8111-111111111111';
const previa = (extra: Record<string, unknown> = {}) => ZeragemPedidosResposta.parse({
  empresa_id: EMP, simulado: true, apagados: [{ tabela: 'pedido', quantidade: 7 }], apagados_fdv: 4,
  mantidos: [{ motivo: 'nota', quantidade: 3 }, { motivo: 'titulo', quantidade: 1 }], ...extra,
});
const tela = (p: ZeragemPedidosResposta | null) =>
  renderToStaticMarkup(<ZerarPedidos empresaId={EMP} aoFechar={() => undefined} aoZerar={() => undefined} previaInicial={p} />);

describe('Zerar Pedidos não faturados (T-0093)', () => {
  it('a prévia mostra o que apaga e "Mantidos: N" com uma linha por motivo (nota e título)', () => {
    const h = tela(previa());
    expect(h).toContain('Zerar Pedidos não faturados?');
    expect(h).toContain('Vai apagar 7 pedidos.');
    expect(h).toContain('Mantidos: 4');
    expect(h).toContain('3 pedidos com nota.');
    expect(h).toContain('1 pedido com título.');
    expect(h).toContain(AVISO_ZERAR);
  });
  it('só avisa que o pedido do FDV volta pelo reenvio do FDV quando há pedido do FDV', () => {
    expect(tela(previa())).toContain('Do FDV: 4 (só voltam quando o FDV reenviar).');
    expect(tela(previa({ apagados_fdv: 0 }))).not.toContain('Do FDV');
  });
  it('sem mantidos não mostra a linha; sem o que apagar diz isso uma vez só', () => {
    const h = tela(previa({ mantidos: [], apagados: [{ tabela: 'pedido', quantidade: 0 }], apagados_fdv: 0 }));
    expect(h).not.toContain('Mantidos');
    expect(h.split('sem nota e sem título').length - 1).toBe(1);
    expect(h).toContain('Não há pedidos sem nota e sem título para apagar.');
  });
});
