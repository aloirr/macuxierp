import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ cookie: 'tok-config' as string | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'mx_config' && estado.cookie ? { value: estado.cookie } : undefined), delete: vi.fn() }) }));
vi.mock('next/navigation', () => ({ redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));

import { pedirPreviaZerarPedidos, pedirZerarPedidos, textoPedidosZerados } from './pedidos-zerar';
import { tratarPreviaZerarPedidos, tratarZerarPedidos } from './pedidos-zerar-rotas';

const EMP = '11111111-1111-4111-8111-111111111111';
const CHAVE = '33333333-3333-4333-8333-333333333333';
const FRASE = 'autorizo zerar os dados';
const chamadas: { url: string; h: Record<string, string>; corpo: unknown }[] = [];
let resposta: () => Response;
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const zeragem = (extra: Record<string, unknown> = {}) => ({
  empresa_id: EMP, simulado: false, apagados: [{ tabela: 'pedido', quantidade: 5 }], apagados_fdv: 2,
  mantidos: [{ motivo: 'nota', quantidade: 2 }, { motivo: 'titulo', quantidade: 1 }], ...extra,
});
const req = (corpo: unknown, chave: string | null = CHAVE) => new Request('http://portal.invalid/x', { method: 'POST', body: JSON.stringify(corpo), headers: chave ? { 'idempotency-key': chave } : {} });

beforeEach(() => {
  estado.cookie = 'tok-config';
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  resposta = () => json(zeragem());
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    chamadas.push({ url, h: Object.fromEntries(new Headers(init.headers).entries()), corpo: init.body });
    return resposta();
  });
});

describe('rotas do Zerar pedidos não faturados (T-0093)', () => {
  it('prévia: POST sem corpo em pedidos/zerar/previa, sem chave, com o CSRF', async () => {
    resposta = () => json(zeragem({ simulado: true }));
    const r = await tratarPreviaZerarPedidos(new Request('http://portal.invalid/x', { method: 'POST' }), EMP);
    expect(await r.json()).toMatchObject({ ok: true, previa: { simulado: true, apagados_fdv: 2 } });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${EMP}/pedidos/zerar/previa`);
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    expect(chamadas[0]?.corpo).toBeUndefined();
    expect((await tratarPreviaZerarPedidos(new Request('http://portal.invalid/x', { method: 'GET' }), EMP)).status).toBe(405);
  });
  it('zerar: leva só a frase, a Idempotency-Key e o CSRF', async () => {
    const r = await tratarZerarPedidos(req({ frase: 'AUTORIZO ZERAR OS DADOS.' }), EMP);
    expect(await r.json()).toMatchObject({ ok: true, zeragem: { apagados_fdv: 2 } });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${EMP}/pedidos/zerar`);
    expect(chamadas[0]?.h['idempotency-key']).toBe(CHAVE);
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(JSON.parse(chamadas[0]?.corpo as string)).toEqual({ frase: 'AUTORIZO ZERAR OS DADOS.' });
  });
  it('frase errada, vazia ou sem chave: 400 e nada chega à API', async () => {
    expect((await tratarZerarPedidos(req({ frase: 'ERRADO' }), EMP)).status).toBe(400);
    expect((await tratarZerarPedidos(req({ frase: '' }), EMP)).status).toBe(400);
    expect((await tratarZerarPedidos(req({ frase: FRASE }, null), EMP)).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });
  it('409 MXC03 (ganhou nota ou título): "dados mudaram" para refazer a prévia', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'x', detalhes: { codigo: 'MXC03' } }, 409);
    const r = await tratarZerarPedidos(req({ frase: FRASE }), EMP);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ ok: false, codigo: 'dados_mudaram', chaveNova: true });
  });
});

describe('chamadas do navegador ao Zerar pedidos', () => {
  it('prévia: POST sem corpo e devolve a resposta validada pelo contrato', async () => {
    const vistos: { url: string; init: RequestInit }[] = [];
    const r = await pedirPreviaZerarPedidos(EMP, async (url, init) => { vistos.push({ url, init }); return json({ ok: true, previa: zeragem({ simulado: true }) }); });
    expect(r.ok && r.valor.mantidos).toHaveLength(2);
    expect(vistos[0]?.url).toBe(`/config/empresas/${EMP}/pedidos/zerar/previa`);
    expect(vistos[0]?.init.body).toBeUndefined();
  });
  it('zerar: envia {frase} com a Idempotency-Key e devolve apagados e mantidos', async () => {
    const vistos: RequestInit[] = [];
    const r = await pedirZerarPedidos(EMP, `  ${FRASE} `, CHAVE, async (_u, init) => { vistos.push(init); return json({ ok: true, zeragem: zeragem() }); });
    expect(r).toEqual({ ok: true, valor: { apagados: 5, mantidos: 3 } });
    expect(JSON.parse(vistos[0]?.body as string)).toEqual({ frase: FRASE });
    expect((vistos[0]?.headers as Record<string, string>)['idempotency-key']).toBe(CHAVE);
  });
  it('mensagem de sucesso', () => {
    expect(textoPedidosZerados({ apagados: 5, mantidos: 3 })).toBe('Pedidos zerados: 5. Mantidos: 3 (com nota ou título).');
    expect(textoPedidosZerados({ apagados: 0, mantidos: 0 })).toBe('Pedidos zerados: 0.');
  });
});
