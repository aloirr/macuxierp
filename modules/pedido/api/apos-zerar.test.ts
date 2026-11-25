/** Porta `aposZerarPedidos` (RN-CAD-10, T-0093 critério 3) contra falsos: a tx, o Hub e o a_faturar são dublês em memória. */
import type { ContextoPlataforma, Transacao } from '@macuxierp/platform-sdk';
import { AuditoriaMemoria, OutboxMemoria, RelogioFixo } from '@macuxierp/platform-sdk/testes';
import { describe, expect, it } from 'vitest';
import { CAMINHOS_ZERAR_PEDIDOS } from '../contracts';
import { criarAposZerarPedidosSql, FUNCOES_APOS_ZERAR_PEDIDOS, type AposZerarPedidos } from './apos-zerar';
import { IDS, pedidoFdv, prepararCadastros } from './fixtures-teste';
import { dependenciasEmMemoria } from './memoria';
import { criarRecebedorFdv } from './recebedor';
import { criarPluginPlataformaPedidoZerar } from './zeragem';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ZERAR = { frase: 'autorizo zerar os dados' };

/** Dublê do Hub (`integracao_fdv.pedido_recebido`, único por pedido_uuid), do a_faturar e do banco de pedidos. */
function montar(opcoes: { falhaNaPorta?: boolean } = {}) {
  const m = dependenciasEmMemoria();
  prepararCadastros(m.cadastros);
  const entregues = new Set<string>(); // pedido_uuid já `entregue` ao ERP
  const aFaturar = new Map<string, 'a_faturar' | 'cancelado'>();
  const txDaPorta: boolean[] = [];
  const tx = {
    async consultar(sql: string) {
      if (sql.includes('portal_zeragem_fatos')) return [{ r: { pedidos: m.armazem.pedidos.map((p) => ({ id: p.id, status: p.status, origem: p.origem })) } }];
      if (sql.includes('portal_zerar')) {
        const n = m.armazem.pedidos.length;
        m.armazem.pedidos.length = 0;
        return [{ r: { apagados: [{ tabela: 'pedido', quantidade: n }] } }];
      }
      return [];
    },
  } as unknown as Transacao;
  const apos: AposZerarPedidos = {
    async aposZerarPedidos(t, _tenant, ids) {
      txDaPorta.push(t === tx);
      if (opcoes.falhaNaPorta) throw new Error('falha simulada');
      for (const id of ids) aFaturar.set(id, 'cancelado');
      const n = entregues.size;
      entregues.clear();
      return [
        { tabela: 'integracao_fdv.pedido_recebido', quantidade: n },
        { tabela: 'faturamento.pedido_a_faturar', quantidade: ids.length },
      ];
    },
  };
  const recebedor = criarRecebedorFdv({
    ...m.deps,
    licencas: { ler: async () => [{ modulo: 'pedido', ativo: true, valido_ate: null }] },
    outbox: new OutboxMemoria(),
    auditoria: new AuditoriaMemoria(),
    relogio: new RelogioFixo(new Date('2026-11-21T15:00:00Z')),
  });
  /** O Hub só entrega ao pedido se o pedido_uuid ainda não estiver `entregue` (o que o zerar precisa liberar). */
  const hubEntrega = async (uuid: string) => {
    if (entregues.has(uuid)) return { resultado: 'repetido_no_hub' as const };
    const r = await recebedor.receber(tx, pedidoFdv({ pedido_uuid: uuid }));
    entregues.add(uuid);
    return r;
  };
  const plugin = criarPluginPlataformaPedidoZerar({ aposZerar: apos, faturamento: { pedidosComNotaOuTitulo: async () => ({ comNota: [], comTitulo: [] }) } });
  const ctx: ContextoPlataforma = { sessao: { superadmin_id: 'a', sessao_id: 'b' }, tx, request_id: 'req-1', agora: new Date('2026-11-21T15:00:00Z'), auditar: async () => {} };
  const zerar = () => {
    const r = plugin.rotas.find((x) => x.caminho === CAMINHOS_ZERAR_PEDIDOS.zerar)!;
    return r.executar(ctx, { corpo: r.corpo!.parse(ZERAR), params: { id: TENANT } } as never);
  };
  return { ...m, aFaturar, hubEntrega, zerar, txDaPorta };
}

describe('porta aposZerarPedidos (T-0093, critério 3)', () => {
  it('RN-CAD-10: a porta roda dentro da tx recebida e as contagens entram no apagados da resposta', async () => {
    const t = montar();
    await t.hubEntrega(IDS.pedidoFdv);
    const { corpo } = await t.zerar();
    expect(t.txDaPorta).toEqual([true]);
    expect((corpo as { apagados: unknown[] }).apagados).toEqual([
      { tabela: 'pedido', quantidade: 1 },
      { tabela: 'integracao_fdv.pedido_recebido', quantidade: 1 },
      { tabela: 'faturamento.pedido_a_faturar', quantidade: 1 },
    ]);
  });

  it('RN-CAD-10: o a_faturar do pedido zerado é descartado (cancelado)', async () => {
    const t = montar();
    const r = await t.hubEntrega(IDS.pedidoFdv);
    const id = (r as { pedido_id: string }).pedido_id;
    t.aFaturar.set(id, 'a_faturar');
    await t.zerar();
    expect(t.aFaturar.get(id)).toBe('cancelado');
  });

  it('RN-PED-01 e RN-CAD-10: o pedido do FDV zerado é aceito de novo quando o Hub reenvia o mesmo pedido_uuid', async () => {
    const t = montar();
    expect(await t.hubEntrega(IDS.pedidoFdv)).toMatchObject({ resultado: 'criado' });
    // Antes do zerar o reenvio é barrado: é o bloqueio que a porta precisa liberar.
    expect(await t.hubEntrega(IDS.pedidoFdv)).toEqual({ resultado: 'repetido_no_hub' });
    await t.zerar();
    expect(t.armazem.pedidos).toHaveLength(0);
    expect(await t.hubEntrega(IDS.pedidoFdv)).toMatchObject({ resultado: 'criado', status: 'aprovado' });
    expect(t.armazem.pedidos).toHaveLength(1);
  });

  it('RN-CAD-10: se a porta falha, o erro sobe (a tx do comPlataforma desfaz o zerar inteiro)', async () => {
    const t = montar({ falhaNaPorta: true });
    await t.hubEntrega(IDS.pedidoFdv);
    await expect(t.zerar()).rejects.toThrow('falha simulada');
  });

  it('RN-CAD-10: a ligação SQL chama as duas funções de lista fechada na tx e devolve só contagens (ponto único)', async () => {
    const chamadas: { sql: string; p: readonly unknown[] }[] = [];
    const tx = {
      async consultar(sql: string, p: readonly unknown[]) {
        chamadas.push({ sql, p });
        return [{ r: sql.includes('liberar') ? { pedidos_liberados: 2, retornos_descartados: 1 } : { a_faturar_cancelados: 3 } }];
      },
    } as unknown as Transacao;
    const r = await criarAposZerarPedidosSql().aposZerarPedidos(tx, TENANT, ['a', 'b']);
    expect(chamadas.map((c) => c.sql.match(/SELECT (\S+)\(/)![1])).toEqual([FUNCOES_APOS_ZERAR_PEDIDOS.liberarReenvio, FUNCOES_APOS_ZERAR_PEDIDOS.descartarAFaturar]);
    expect(chamadas.every((c) => c.p[0] === TENANT)).toBe(true);
    expect(r).toEqual([
      { tabela: 'integracao_fdv.pedido_recebido', quantidade: 2 },
      { tabela: 'integracao_fdv.retorno_enviado', quantidade: 1 },
      { tabela: 'faturamento.pedido_a_faturar', quantidade: 3 },
    ]);
    expect(await criarAposZerarPedidosSql().aposZerarPedidos(tx, TENANT, [])).toEqual([]);
  });
});
