import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigIndisponivel, ErroPlataforma } from './erros';
import { criarCredencialEntrada, lerEntrada, revogarCredencialEntrada } from './entrada-api';

const ID = '11111111-1111-4111-8111-111111111111';
const chamadas: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
let resposta: () => Response;

beforeEach(() => {
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid/';
  vi.stubGlobal('fetch', async (url: string, init: never) => {
    chamadas.push({ url, init });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const CRIADA = { conector_id: 'erp-cliente', chave: 'A'.repeat(43), prefixo: 'AAAAAAAA', criada_em: '2026-11-26T15:00:00.000Z' };

describe('cliente da entrada no portal (fetch simulado)', () => {
  it('lê pelo cookie do /config e valida o contrato', async () => {
    resposta = () => json({ credenciais: [], ultimo_sinal: null, lotes: [] });
    expect(await lerEntrada('tok', ID)).toEqual({ credenciais: [], ultimo_sinal: null, lotes: [] });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${ID}/entrada`);
    expect(chamadas[0]?.init.method).toBe('GET');
    expect(chamadas[0]?.init.headers.cookie).toBe('macuxierp_config=tok');
  });
  it('resposta fora do contrato (chave com tamanho errado) vira indisponível', async () => {
    resposta = () => json({ ...CRIADA, chave: 'curta' }, 201);
    await expect(criarCredencialEntrada('tok', ID, { conector_id: 'erp-cliente' })).rejects.toBeInstanceOf(ConfigIndisponivel);
  });
  it('POST da credencial: anti-CSRF, corpo só com o código e sem Idempotency-Key', async () => {
    resposta = () => json(CRIADA, 201);
    const r = await criarCredencialEntrada('tok', ID, { conector_id: 'erp-cliente' });
    expect(r.chave).toHaveLength(43);
    const c = chamadas[0]!;
    expect(c.url).toMatch(/\/entrada\/credencial$/);
    expect(c.init.method).toBe('POST');
    expect(c.init.headers['x-macuxierp-config']).toBe('1');
    expect(c.init.headers['idempotency-key']).toBeUndefined();
    expect(JSON.parse(String(c.init.body))).toEqual({ conector_id: 'erp-cliente' });
  });
  it('DELETE leva o código na query, codificado, e aceita 204', async () => {
    resposta = () => new Response(null, { status: 204 });
    await revogarCredencialEntrada('tok', ID, 'a b/c');
    expect(chamadas[0]?.url).toMatch(/\/entrada\/credencial\?conector_id=a%20b%2Fc$/);
    expect(chamadas[0]?.init.method).toBe('DELETE');
    expect(chamadas[0]?.init.headers['x-macuxierp-config']).toBe('1');
  });
  it('503 INDISPONIVEL e 409 CONFLITO chegam com o código; empresa fora do formato nunca vai ao caminho', async () => {
    resposta = () => json({ codigo: 'INDISPONIVEL', mensagem: 'x' }, 503);
    await expect(criarCredencialEntrada('tok', ID, { conector_id: 'a' })).rejects.toMatchObject({ status: 503, codigo: 'INDISPONIVEL' });
    resposta = () => json({ codigo: 'CONFLITO' }, 409);
    await expect(criarCredencialEntrada('tok', ID, { conector_id: 'a' })).rejects.toMatchObject({ status: 409, codigo: 'CONFLITO' });
    chamadas.length = 0;
    await expect(lerEntrada('tok', '../x')).rejects.toBeInstanceOf(ErroPlataforma);
    expect(chamadas).toHaveLength(0);
  });
});
