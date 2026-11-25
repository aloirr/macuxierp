/** Porta `aposZerarPedidos` (RN-CAD-10, T-0093 critério 3) contra falsos: a tx e o banco de pedidos são dublês em memória. */
import type { ContextoPlataforma, Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CAMINHOS_ZERAR_PEDIDOS } from '../contracts';
import { criarAposZerarPedidosSql, FUNCOES_APOS_ZERAR_PEDIDOS, type AposZerarPedidos } from './apos-zerar';
import { criarPluginPlataformaPedidoZerar } from './zeragem';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ZERAR = { frase: 'autorizo zerar os dados' };

function montar(opcoes: { falhaNaPorta?: boolean } = {}) {
  const pedidos = [{ id: 'p-fdv', status: 'aprovado', origem: 'fdv' }];
  const txDaPorta: boolean[] = [];
  const tx = {
    async consultar(sql: string) {
      if (sql.includes('portal_zeragem_fatos')) return [{ r: { pedidos } }];
      if (sql.includes('portal_zerar')) return [{ r: { apagados: [{ tabela: 'pedido', quantidade: pedidos.length }] } }];
      return [];
    },
  } as unknown as Transacao;
  const apos: AposZerarPedidos = {
    async aposZerarPedidos(t, _tenant, ids) {
      txDaPorta.push(t === tx);
      if (opcoes.falhaNaPorta) throw new Error('falha simulada');
      return [{ tabela: 'faturamento.pedido_a_faturar', quantidade: ids.length }];
    },
  };
  const plugin = criarPluginPlataformaPedidoZerar({ aposZerar: apos, faturamento: { pedidosComNotaOuTitulo: async () => ({ comNota: [], comTitulo: [] }) } });
  const ctx: ContextoPlataforma = { sessao: { superadmin_id: 'a', sessao_id: 'b' }, tx, request_id: 'req-1', agora: new Date('2026-11-21T15:00:00Z'), auditar: async () => {} };
  const zerar = () => {
    const r = plugin.rotas.find((x) => x.caminho === CAMINHOS_ZERAR_PEDIDOS.zerar)!;
    return r.executar(ctx, { corpo: r.corpo!.parse(ZERAR), params: { id: TENANT } } as never);
  };
  return { zerar, txDaPorta };
}

describe('porta aposZerarPedidos (T-0093, critério 3)', () => {
  it('RN-CAD-10: a porta roda dentro da tx recebida e as contagens entram no apagados da resposta', async () => {
    const t = montar();
    const { corpo } = await t.zerar();
    expect(t.txDaPorta).toEqual([true]);
    expect((corpo as { apagados: unknown[] }).apagados).toEqual([
      { tabela: 'pedido', quantidade: 1 },
      { tabela: 'faturamento.pedido_a_faturar', quantidade: 1 },
    ]);
  });

  it('RN-CAD-10: se a porta falha, o erro sobe (a tx do comPlataforma desfaz o zerar inteiro)', async () => {
    const t = montar({ falhaNaPorta: true });
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
