import { ErroApi, pode, type ContextoRota, type Perfil, type RotaModulo, type Sessao } from '@macuxierp/platform-sdk';
import { EVENTO_PEDIDO_APROVADO } from '@macuxierp/pedido/contracts';
import { describe, expect, it } from 'vitest';
import { IDS, itemPedido, pedidoAprovado } from '../domain/fixtures';
import { TRABALHO_TRANSMITIR_NOTA } from '../contracts';
import { depsFake, NPROT, tx, TENANT, uuid } from './apoio-teste';
import { criarConsumidorPedidoAprovado } from './consumidor';
import { criarPluginFaturamento } from './index';

const sessao = (perfil: Perfil): Sessao => ({ usuario_id: uuid(5), tenant_id: TENANT, perfil, filial_ids: [] });

function ambiente(perfil: Perfil = 'faturista') {
  const f = depsFake();
  const plugin = criarPluginFaturamento(f.deps);
  const trabalhos: { tipo: string; payload: Record<string, unknown>; external_id?: string }[] = [];
  const auditoria: string[] = [];
  const ctx: ContextoRota = {
    sessao: sessao(perfil),
    tx,
    request_id: 'req-1',
    agora: new Date('2026-11-21T14:30:00Z'),
    publicar: async () => {
      throw new Error('a API não publica evento de nota');
    },
    auditar: async (d) => void auditoria.push(d.acao),
    enfileirar: async (p) => (trabalhos.push(p), { id: uuid(9) }),
  };
  const rota = (metodo: string, caminho: string): RotaModulo => plugin.rotas.find((r) => r.metodo === metodo && r.caminho === caminho) as RotaModulo;
  const chamar = async (metodo: string, caminho: string, e: { corpo?: unknown; consulta?: unknown; params?: Record<string, string> } = {}) => {
    const r = rota(metodo, caminho);
    const corpo = r.corpo ? r.corpo.parse(e.corpo) : undefined;
    const consulta = r.consulta ? r.consulta.parse(e.consulta ?? {}) : undefined;
    return r.executar(ctx, { corpo, consulta, params: e.params ?? {} } as never);
  };
  return { ...f.r, deps: f.deps, pedido: f.pedido, plugin, trabalhos, auditoria, chamar, rota };
}
const emitirCorpo = { pedido_id: IDS.pedido, idempotencia: 'idem-0000001' };

describe('rotas /v1/faturamento', () => {
  it('RN-CORE-02: toda rota declara ação do módulo; a emissão e o XML pedem faturista/fiscal/administrador; leitura é aberta aos perfis de leitura', () => {
    const a = ambiente();
    expect(a.plugin.rotas.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`).sort()).toEqual([
      'GET /notas faturamento.ver',
      'GET /notas/:id faturamento.ver',
      'GET /notas/:id/xml faturamento.nota.emitir',
      'GET /rejeicoes faturamento.ver',
      'POST /notas faturamento.nota.emitir',
      'POST /notas/:id/reenviar faturamento.nota.emitir',
    ]);
    expect(pode('leitura', 'faturamento.nota.emitir')).toBe(false);
    expect(pode('faturista', 'faturamento.nota.emitir')).toBe(true);
  });

  it('RF-FAT-01: POST /notas emite (201), audita e enfileira a transmissão; a repetição devolve 200 sem novo número nem novo trabalho', async () => {
    const a = ambiente();
    const r = await a.chamar('POST', '/notas', { corpo: emitirCorpo });
    expect(r.status).toBe(201);
    expect(r.corpo).toMatchObject({ status: 'em_autorizacao', numero: 100, total_centavos: 4500 });
    expect(a.trabalhos).toHaveLength(1);
    expect(a.trabalhos[0]).toMatchObject({ tipo: TRABALHO_TRANSMITIR_NOTA, payload: { nota_id: (r.corpo as { id: string }).id } });
    expect(a.auditoria).toEqual(['faturamento.nota.emitir']);
    const repetida = await a.chamar('POST', '/notas', { corpo: emitirCorpo });
    expect(repetida.status).toBe(200);
    expect(a.trabalhos).toHaveLength(1);
    expect(a.estado.reservas).toBe(1);
  });

  it('RN-PED-02: violação de regra vira 422 com a RN; violação de dado, 400; nenhum número é queimado', async () => {
    const a = ambiente();
    const svc = a.deps;
    svc.situacao = { situacao: async () => ({ status: 'cancelado', itens: [] }) };
    const e1 = await criarPluginFaturamento(svc).rotas.find((r) => r.metodo === 'POST')!.executar({ ...({} as ContextoRota), tx, sessao: sessao('faturista'), enfileirar: async () => ({ id: 'x' }), auditar: async () => undefined } as ContextoRota, { corpo: emitirCorpo, params: {}, cabecalhos: {}, arquivos: {}, todosArquivos: {} } as never).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ErroApi);
    expect(e1).toMatchObject({ status: 422, codigo: 'RN-PED-02' });
    expect(a.estado.reservas).toBe(0);
  });

  it('RF-FAT-01: corpo sem idempotência é 400 de validação (Zod)', async () => {
    await expect(ambiente().chamar('POST', '/notas', { corpo: { pedido_id: IDS.pedido } })).rejects.toThrow();
  });

  it('RN-FAT-07: POST /notas/:id/reenviar só aceita a rejeitada e enfileira de novo', async () => {
    const a = ambiente();
    const emitida = await a.chamar('POST', '/notas', { corpo: emitirCorpo });
    const id = (emitida.corpo as { id: string }).id;
    await expect(a.chamar('POST', '/notas/:id/reenviar', { params: { id } })).rejects.toMatchObject({ codigo: 'RN-FAT-07' });
    a.notas.set(id, { ...a.notas.get(id)!, status: 'rejeitada' });
    const r = await a.chamar('POST', '/notas/:id/reenviar', { params: { id } });
    expect(r.corpo).toMatchObject({ status: 'em_autorizacao', numero: 100 });
    expect(a.trabalhos).toHaveLength(2);
    expect(a.trabalhos[1]?.external_id).toBe(`${id}:req-1`);
  });

  it('RF-FAT-01: GET /notas lista, GET /notas/:id detalha e id inexistente é 404', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    expect(((await a.chamar('GET', '/notas')).corpo as { itens: unknown[] }).itens).toHaveLength(1);
    expect((await a.chamar('GET', '/notas/:id', { params: { id } })).corpo).toMatchObject({ id, itens: [{ sequencia: 1 }, { sequencia: 2 }] });
    await expect(a.chamar('GET', '/notas/:id', { params: { id: uuid(404) } })).rejects.toMatchObject({ status: 404 });
    await expect(a.chamar('GET', '/notas/:id', { params: { id: 'lixo' } })).rejects.toMatchObject({ status: 404 });
  });

  it('RN-FAT-03: GET /notas/:id/xml devolve o nfeProc guardado; sem guarda, 404', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    await expect(a.chamar('GET', '/notas/:id/xml', { params: { id } })).rejects.toMatchObject({ status: 404 });
    a.xmls.push({ id, conteudo: '<nfeProc/>', protocolo: NPROT });
    const r = await a.chamar('GET', '/notas/:id/xml', { params: { id } });
    expect(r.corpo).toBe('<nfeProc/>');
    expect(r.cabecalhos).toMatchObject({ 'content-type': expect.stringContaining('application/xml') });
  });

  it('RF-FAT-08: GET /rejeicoes lista as rejeitadas com a ação sugerida', async () => {
    const a = ambiente();
    const id = ((await a.chamar('POST', '/notas', { corpo: emitirCorpo })).corpo as { id: string }).id;
    a.notas.set(id, { ...a.notas.get(id)!, status: 'rejeitada' });
    const r = await a.chamar('GET', '/rejeicoes');
    expect((r.corpo as { itens: { acao_sugerida: string }[] }).itens[0]?.acao_sugerida).toContain('NCM');
  });

  it('RF-FAT-08: vendedor não acessa as notas (403), mesmo que o perfil leia o módulo', async () => {
    const a = ambiente('vendedor');
    await expect(a.chamar('GET', '/notas')).rejects.toMatchObject({ status: 403 });
    await expect(a.chamar('GET', '/rejeicoes')).rejects.toMatchObject({ status: 403 });
  });
});

describe('consumidor de pedido.pedido.aprovado@1', () => {
  it('RF-FAT-01: grava o pedido aprovado na fila a faturar, idempotente', async () => {
    const gravados: string[] = [];
    const vistos = new Set<string>();
    const c = criarConsumidorPedidoAprovado({
      obter: async () => null,
      gravar: async (_t, p) => {
        gravados.push(p.pedido_id);
        if (vistos.has(p.pedido_id)) return 'repetido';
        vistos.add(p.pedido_id);
        return 'novo';
      },
    });
    expect(c.eventos).toEqual([EVENTO_PEDIDO_APROVADO]);
    const evento = { id: uuid(1), nome: EVENTO_PEDIDO_APROVADO, tenant_id: TENANT, agregado_id: IDS.pedido, versao: 1, ocorrido_em: '2026-11-21T14:00:00.000Z', ator: 'sistema' as const, request_id: 'r', payload: pedidoAprovado([itemPedido(1, 10_000, 1000)]) as unknown as Record<string, unknown> };
    await c.tratar(evento, tx);
    await c.tratar(evento, tx);
    expect(gravados).toEqual([IDS.pedido, IDS.pedido]);
    await expect(c.tratar({ ...evento, payload: { lixo: true } }, tx)).rejects.toThrow();
  });
});

