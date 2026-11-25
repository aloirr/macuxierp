/** Plugin "Zerar pedidos não faturados" (RN-CAD-10, T-0093) com tx e porta do faturamento falsas. */
import { ErroApi, MENSAGEM_FRASE_ZERAR, corpoErroApi, type ContextoPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CAMINHOS_ZERAR_PEDIDOS, ZeragemPedidosResposta } from '../contracts';
import type { AposZerarPedidos } from './apos-zerar';
import { criarPluginPlataformaPedidoZerar } from './zeragem';

const TENANT = '11111111-1111-4111-8111-111111111111';
const C = CAMINHOS_ZERAR_PEDIDOS;

const PEDIDOS = [
  { id: 'p-livre', status: 'aprovado', origem: 'bko' },
  { id: 'p-fdv', status: 'recebido', origem: 'fdv' },
  { id: 'p-nota', status: 'aprovado', origem: 'bko' },
  { id: 'p-titulo', status: 'cancelado', origem: 'bko' },
  { id: 'p-faturado', status: 'faturado', origem: 'fdv' },
];

function montar(pedidos: unknown[] = PEDIDOS, apos: AposZerarPedidos = { aposZerarPedidos: async () => [] }) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const consultasFat: string[][] = [];
  const tx = {
    async consultar(sql: string, p: readonly unknown[] = []) {
      chamadas.push({ sql, p });
      if (sql.includes('portal_zeragem_fatos')) return [{ r: { pedidos } }];
      if (sql.includes('portal_zerar')) return [{ r: { apagados: [{ tabela: 'pedido', quantidade: 2 }, { tabela: 'pedido_item', quantidade: 5 }] } }];
      return [];
    },
  } as unknown as Transacao;
  const plugin = criarPluginPlataformaPedidoZerar({
    aposZerar: apos,
    faturamento: {
      pedidosComNotaOuTitulo: async (_tx, _t, ids) => {
        consultasFat.push([...ids]);
        return { comNota: ['p-nota'], comTitulo: ['p-titulo'] };
      },
    },
  });
  const auditorias: unknown[] = [];
  const ctx: ContextoPlataforma = { sessao: { superadmin_id: 'a', sessao_id: 'b' }, tx, request_id: 'req-1', agora: new Date(), auditar: async (d) => { auditorias.push(d); } };
  const chamar = (caminho: string, corpo?: unknown) => {
    const r = plugin.rotas.find((x) => x.caminho === caminho)!;
    return r.executar(ctx, { corpo: r.corpo ? r.corpo.parse(corpo) : undefined, params: { id: TENANT } } as never);
  };
  return { plugin, chamar, chamadas, consultasFat, auditorias };
}

describe('plugin de plataforma "Zerar pedidos não faturados" (RN-CAD-10)', () => {
  it('RN-CAD-10: declara prévia (sem idempotência) e zerar (obrigatória), ambas com a ação plataforma.cadastros.zerar', () => {
    expect(montar().plugin.rotas.map((r) => `${r.caminho} ${r.acao} ${r.idempotencia ?? '-'}`).sort()).toEqual([
      `${C.previa} plataforma.cadastros.zerar -`,
      `${C.zerar} plataforma.cadastros.zerar obrigatoria`,
    ].sort());
  });

  it('RN-CAD-10: a prévia é simulado, não chama o efeito e mantém o pedido com nota, título ou faturado', async () => {
    const m = montar();
    const r = ZeragemPedidosResposta.parse((await m.chamar(C.previa)).corpo);
    expect(r).toMatchObject({ simulado: true, apagados: [{ tabela: 'pedido', quantidade: 2 }], apagados_fdv: 1, mantidos: [{ motivo: 'nota', quantidade: 2 }, { motivo: 'titulo', quantidade: 1 }] });
    expect(m.chamadas.some((c) => c.sql.includes('portal_zerar'))).toBe(false);
    expect(m.consultasFat).toEqual([PEDIDOS.map((p) => p.id)]);
  });

  it('RN-CAD-10: o zerar manda ao banco só os ids sem nota e sem título e devolve as contagens do banco', async () => {
    const m = montar();
    const r = ZeragemPedidosResposta.parse((await m.chamar(C.zerar, { frase: 'Autorizo zerar os dados.' })).corpo);
    const efeito = m.chamadas.find((c) => c.sql.includes('portal_zerar'))!;
    expect(efeito.p).toEqual([TENANT, JSON.stringify({ apagar: ['p-livre', 'p-fdv'] }), 'req-1']);
    expect(r.simulado).toBe(false);
    expect(r.apagados).toEqual([{ tabela: 'pedido', quantidade: 2 }, { tabela: 'pedido_item', quantidade: 5 }]);
  });

  it('RN-CAD-10: a auditoria é só da função do banco (a rota não audita) e a resposta não traz dado do pedido', async () => {
    const m = montar();
    const { corpo } = await m.chamar(C.zerar, { frase: 'autorizo zerar os dados' });
    expect(m.auditorias).toEqual([]);
    expect(JSON.stringify(corpo)).not.toMatch(/p-livre|p-fdv|p-nota/);
  });

  it('RN-CAD-10: sem pedido a apagar, o zerar não chama o banco', async () => {
    const m = montar([{ id: 'p-nota', status: 'aprovado', origem: 'bko' }]);
    const r = ZeragemPedidosResposta.parse((await m.chamar(C.zerar, { frase: 'autorizo zerar os dados' })).corpo);
    expect(m.chamadas.some((c) => c.sql.includes('portal_zerar'))).toBe(false);
    expect(r.apagados).toEqual([]);
    expect(r.mantidos).toEqual([{ motivo: 'nota', quantidade: 1 }]);
  });

  it('RN-CAD-10: sem nenhum pedido, não consulta o faturamento', async () => {
    const m = montar([]);
    await m.chamar(C.previa);
    expect(m.consultasFat).toEqual([]);
  });

  it('RN-CAD-10 (T-0093): frase errada é 422 de regra, sem tocar o banco', async () => {
    const m = montar();
    for (const frase of ['', 'autorizo zerar', 'AM2808']) {
      const e = await m.chamar(C.zerar, { frase }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroApi);
      expect(corpoErroApi(e as ErroApi)).toEqual({ codigo: 'RN-CAD-10', mensagem: MENSAGEM_FRASE_ZERAR, detalhes: { codigo: 'frase_nao_confere' } });
      expect((e as ErroApi).status).toBe(422);
    }
    expect(m.chamadas).toEqual([]);
  });

  it('RN-CAD-10 (T-0093): corpo malformado segue 400 pelo Zod', () => {
    const rota = montar().plugin.rotas.find((r) => r.caminho === C.zerar)!;
    for (const corpo of [{}, { frase: 1 }, { frase: 'x'.repeat(201) }]) expect(rota.corpo!.safeParse(corpo).success).toBe(false);
  });
});
