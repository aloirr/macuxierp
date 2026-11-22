/** Porta do Hub (T-0009 §6, contrato C-9): cliente HTTP com `fetch` dublê. A curva de espera é do domain do `integracao-fdv`. */
import { describe, expect, it } from 'vitest';
import * as sdk from './index';
import { criarClienteHub, ErroClienteHub, LIMITE_RESPOSTA_HUB_BYTES, retryAfterEmMs, validarUrlHub, type CredencialHub, type PedidoHub, type RespostaHub } from './hub';

const CHAVE = 'mfdv_SEGREDO-de-teste-0123456789abcdef';
const CRED: CredencialHub = { conectorId: 'conector-erp-1', chave: CHAVE, ambiente: 'teste' };
const URLS = { teste: 'https://hub-teste.exemplo.com.br/', producao: 'https://hub.exemplo.com.br' };

interface Chamada {
  url: string;
  init: RequestInit;
}

/** `fetch` dublê: grava a chamada e responde com a fábrica dada (ou lança). */
function dubla(responder: (c: Chamada) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const f = (async (url: URL | string, init: RequestInit = {}) => {
    const c = { url: String(url), init };
    chamadas.push(c);
    return responder(c);
  }) as typeof fetch;
  return { chamadas, cliente: criarClienteHub({ urls: URLS, versaoErp: '0.1.0', fetch: f }) };
}

const json = (status: number, corpo: unknown, cab: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cab } });

describe('retryAfterEmMs', () => {
  it('Retry-After em segundos ou data HTTP', () => {
    const agora = Date.parse('2026-11-21T15:00:00Z');
    expect(retryAfterEmMs('30', agora)).toBe(30_000);
    expect(retryAfterEmMs('Sat, 21 Nov 2026 15:01:00 GMT', agora)).toBe(60_000);
    expect(retryAfterEmMs('Sat, 21 Nov 2026 14:00:00 GMT', agora)).toBe(0);
    expect(retryAfterEmMs('amanhã', agora)).toBeNull();
    expect(retryAfterEmMs(null, agora)).toBeNull();
  });

  it('teto de 1 h (segundos ou data)', () => {
    const agora = Date.parse('2026-11-21T15:00:00Z');
    expect(retryAfterEmMs('3600', agora)).toBe(3_600_000);
    expect(retryAfterEmMs('3601', agora)).toBe(3_600_000);
    expect(retryAfterEmMs('99999999999999999999', agora)).toBe(3_600_000);
    expect(retryAfterEmMs('Sun, 22 Nov 2026 15:00:00 GMT', agora)).toBe(3_600_000);
  });
});

describe('criarClienteHub', () => {
  it('monta a URL da lista fixa e os cabeçalhos exatos (P-2 opção A: conector 1.4.0, ERP só no User-Agent)', async () => {
    const { chamadas, cliente } = dubla(() => json(202, { lote_id: 'x' }));
    const r = await cliente.chamar(CRED, { metodo: 'POST', caminho: '/lotes', corpo: { versao_contrato: 'v1' }, chaveIdempotencia: 'a'.repeat(64) });
    expect(r).toEqual({ tipo: 'ok', status: 202, corpo: { lote_id: 'x' }, replay: false });
    const [c] = chamadas;
    expect(c?.url).toBe('https://hub-teste.exemplo.com.br/integracao/v1/lotes');
    expect(c?.init.method).toBe('POST');
    expect(c?.init.redirect).toBe('manual');
    expect(c?.init.body).toBe('{"versao_contrato":"v1"}');
    expect(c?.init.headers).toEqual({
      Authorization: `Bearer ${CHAVE}`,
      'X-Macuxi-Conector-Id': 'conector-erp-1',
      'X-Macuxi-Conector-Versao': '1.4.0',
      'User-Agent': 'macuxierp/0.1.0',
      Accept: 'application/json',
      'Idempotency-Key': 'a'.repeat(64),
      'Content-Type': 'application/json',
    });
  });

  it('GET sem corpo não manda Content-Type nem Idempotency-Key; produção usa a URL de produção', async () => {
    const { chamadas, cliente } = dubla(() => new Response(null, { status: 204 }));
    expect(await cliente.chamar({ ...CRED, ambiente: 'producao' }, { metodo: 'GET', caminho: '/lotes/123?limite=10' })).toEqual({ tipo: 'ok', status: 204, corpo: null, replay: false });
    expect(chamadas[0]?.url).toBe('https://hub.exemplo.com.br/integracao/v1/lotes/123?limite=10');
    expect(Object.keys(chamadas[0]?.init.headers as object)).not.toContain('Content-Type');
    expect(Object.keys(chamadas[0]?.init.headers as object)).not.toContain('Idempotency-Key');
    expect(chamadas[0]?.init.body).toBeUndefined();
  });

  it('replay pelo cabeçalho Idempotent-Replay: true (sem diferenciar maiúsculas); outro valor é false', async () => {
    const valores: Record<string, string | null> = { '/a': 'true', '/b': 'TRUE', '/c': ' True ', '/d': 'false', '/e': '1', '/f': null };
    const { cliente } = dubla(({ url }) => {
      const v = valores[new URL(url).pathname.replace('/integracao/v1', '')];
      return json(201, { lote_id: 'x' }, v === null || v === undefined ? {} : { 'Idempotent-Replay': v });
    });
    const replays: boolean[] = [];
    for (const caminho of Object.keys(valores)) {
      const r = await cliente.chamar(CRED, { metodo: 'POST', caminho, corpo: {}, chaveIdempotencia: 'b'.repeat(64) });
      replays.push(r.tipo === 'ok' && r.replay);
    }
    expect(replays).toEqual([true, true, true, false, false, false]);
  });

  it('recusa caminho com host, esquema, .. ou sem barra, sem chamar o fetch', async () => {
    const { chamadas, cliente } = dubla(() => json(200, {}));
    for (const caminho of ['lotes', '//evil.com/x', '/x?u=http://evil.com', '/../admin', '/%2e%2e/%2e%2e/admin', '/a\\b', '/a b', '/a@evil.com', '/a%2Eb', '/%2e/x', '']) {
      await expect(cliente.chamar(CRED, { metodo: 'GET', caminho })).rejects.toBeInstanceOf(ErroClienteHub);
    }
    expect(chamadas).toHaveLength(0);
  });

  it('Idempotency-Key fora de ASCII visível (CRLF, espaço, vazia, > 255) ou corpo que não vira JSON: pedido_invalido, sem rede', async () => {
    const { chamadas, cliente } = dubla(() => json(200, {}));
    const ciclo: Record<string, unknown> = {};
    ciclo.eu = ciclo;
    const pedidos: PedidoHub[] = [
      { metodo: 'POST', caminho: '/lotes', corpo: {}, chaveIdempotencia: 'abc\r\nX-Injetado: 1' },
      { metodo: 'POST', caminho: '/lotes', corpo: {}, chaveIdempotencia: 'com espaço' },
      { metodo: 'POST', caminho: '/lotes', corpo: {}, chaveIdempotencia: '' },
      { metodo: 'POST', caminho: '/lotes', corpo: {}, chaveIdempotencia: 'a'.repeat(256) },
      { metodo: 'POST', caminho: '/lotes', corpo: { valor: 10n } },
      { metodo: 'POST', caminho: '/lotes', corpo: ciclo },
      { metodo: 'POST', caminho: '/lotes', corpo: () => 1 },
    ];
    for (const p of pedidos) {
      const erro = await cliente.chamar(CRED, p).then(() => null, (e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroClienteHub);
      expect((erro as ErroClienteHub).codigo).toBe('pedido_invalido');
      expect((erro as Error).message).toBe('cliente do Hub: pedido_invalido');
    }
    expect(chamadas).toHaveLength(0);
    expect(await cliente.chamar(CRED, { metodo: 'POST', caminho: '/lotes', corpo: {}, chaveIdempotencia: 'a'.repeat(255) })).toMatchObject({ tipo: 'ok' });
  });

  it('corpo acima de 4 MiB (content-length ou contando o fluxo): resposta_grande, recusa em 2xx/4xx e retentável em 5xx', async () => {
    let blocos = 0;
    const fluxo = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          blocos++;
          c.enqueue(new Uint8Array(1024 * 1024));
          if (blocos > 100) c.close();
        },
      });
    const { cliente } = dubla(({ url }) => {
      if (url.endsWith('/declarado')) return new Response('{}', { status: 200, headers: { 'content-length': String(LIMITE_RESPOSTA_HUB_BYTES + 1) } });
      if (url.endsWith('/fluxo')) return new Response(fluxo(), { status: 400 });
      if (url.endsWith('/limite')) return new Response(new Uint8Array(LIMITE_RESPOSTA_HUB_BYTES), { status: 200 });
      return new Response(fluxo(), { status: 503, headers: { 'retry-after': '7200' } });
    });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/declarado' })).toEqual({ tipo: 'recusa', status: 200, codigo: 'resposta_grande' });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/fluxo' })).toEqual({ tipo: 'recusa', status: 400, codigo: 'resposta_grande' });
    // parou de ler logo depois do limite (4 blocos de 1 MiB + o que estourou), não leu os 100
    expect(blocos).toBeLessThan(10);
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/cinco' })).toEqual({ tipo: 'retentavel', status: 503, codigo: 'resposta_grande', retryAfterMs: 3_600_000 });
    // exatamente no limite ainda é lido
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/limite' })).toEqual({ tipo: 'ok', status: 200, corpo: null, replay: false });
  });

  it('URL da configuração só https, sem credencial nem consulta', () => {
    for (const url of ['http://hub.exemplo.com.br', 'https://u:s@hub.exemplo.com.br', 'https://hub.exemplo.com.br/?a=1', 'nada']) {
      expect(() => criarClienteHub({ urls: { ...URLS, producao: url }, versaoErp: '0.1.0' })).toThrow(ErroClienteHub);
    }
  });

  it('base com ou sem o /integracao/v1 final chama o mesmo endereço (sem prefixo dobrado)', () => {
    for (const url of ['https://api.exemplo.com.br', 'https://api.exemplo.com.br/', 'https://api.exemplo.com.br/integracao/v1', 'https://api.exemplo.com.br/integracao/v1/']) {
      expect(validarUrlHub(url)).toBe('https://api.exemplo.com.br');
    }
    // prefixo próprio antes do /integracao/v1 continua (proxy com caminho)
    expect(validarUrlHub('https://h.exemplo.com.br/fdv/integracao/v1')).toBe('https://h.exemplo.com.br/fdv');
  });

  it('5xx e 429 são retentáveis, com Retry-After e o código do corpo', async () => {
    const { cliente } = dubla(({ url }) =>
      url.endsWith('/a') ? json(503, { erro: { codigo: 'manutencao', mensagem: 'cliente Fulano' } }, { 'retry-after': '120' }) : json(429, { codigo: 'limite_taxa' }),
    );
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/a' })).toEqual({ tipo: 'retentavel', status: 503, codigo: 'manutencao', retryAfterMs: 120_000 });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/b' })).toEqual({ tipo: 'retentavel', status: 429, codigo: 'limite_taxa', retryAfterMs: null });
  });

  it('4xx é recusa só com status e código (sem corpo); código fora de [a-z0-9_] ou > 64 vira null; 3xx não é seguido', async () => {
    const respostas: Record<string, () => Response> = {
      '/426': () => json(426, { codigo: 'abaixo_da_minima', mensagem: `chave ${CHAVE} abaixo da mínima` }),
      '/403': () => json(403, { codigo: 'a'.repeat(65) }),
      '/401': () => json(401, { codigo: 'Credencial Inválida de Fulano' }),
      '/400': () => new Response('<html>erro</html>', { status: 400 }),
      '/302': () => new Response(null, { status: 302, headers: { location: 'https://evil.com' } }),
    };
    const { cliente } = dubla(({ url }) => respostas[new URL(url).pathname.replace('/integracao/v1', '')]!());
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/426' })).toEqual({ tipo: 'recusa', status: 426, codigo: 'abaixo_da_minima' });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/403' })).toEqual({ tipo: 'recusa', status: 403, codigo: null });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/401' })).toEqual({ tipo: 'recusa', status: 401, codigo: null });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/400' })).toEqual({ tipo: 'recusa', status: 400, codigo: null });
    expect(await cliente.chamar(CRED, { metodo: 'GET', caminho: '/302' })).toEqual({ tipo: 'recusa', status: 302, codigo: null });
  });

  it('erro de rede e timeout viram retentáveis sem a mensagem original', async () => {
    const rede = dubla(() => Promise.reject(new TypeError(`fetch failed: ${CHAVE}`)));
    expect(await rede.cliente.chamar(CRED, { metodo: 'GET', caminho: '/sinal' })).toEqual({ tipo: 'retentavel', status: null, codigo: 'rede', retryAfterMs: null });

    const lento = dubla(
      ({ init }) =>
        new Promise<Response>((_ok, falha) => {
          init.signal?.addEventListener('abort', () => falha(new DOMException('abortado', 'AbortError')));
        }),
    );
    const inicio = performance.now();
    expect(await lento.cliente.chamar(CRED, { metodo: 'GET', caminho: '/sinal', timeoutMs: 20 })).toEqual({ tipo: 'retentavel', status: null, codigo: 'timeout', retryAfterMs: null });
    expect(performance.now() - inicio).toBeLessThan(2_000);
  });

  it('a chave nunca aparece em resposta, erro ou toString', async () => {
    const saidas: string[] = [];
    const guardar = (x: unknown) => {
      saidas.push(JSON.stringify(x) ?? '', String(x), x instanceof Error ? `${x.stack} ${JSON.stringify({ ...x })}` : '');
    };
    const { cliente } = dubla(({ url }) => {
      if (url.endsWith('/rede')) throw new Error(`conexão recusada com Authorization: Bearer ${CHAVE}`);
      if (url.endsWith('/eco')) return json(401, { codigo: 'credencial_invalida', mensagem: `Bearer ${CHAVE} recusada` });
      return json(url.endsWith('/ok') ? 200 : 500, { eco: 'nada' });
    });
    const pedidos: PedidoHub[] = [
      { metodo: 'GET', caminho: '/ok' },
      { metodo: 'GET', caminho: '/falha' },
      { metodo: 'GET', caminho: '/rede' },
      { metodo: 'GET', caminho: '/eco' },
      { metodo: 'GET', caminho: '//evil.com' },
    ];
    for (const p of pedidos) await cliente.chamar(CRED, p).then(guardar, guardar);
    for (const cred of [{ ...CRED, chave: `${CHAVE} com espaço` }, { ...CRED, conectorId: 'conector inválido' }]) {
      await cliente.chamar(cred, { metodo: 'GET', caminho: '/ok' }).then(guardar, guardar);
    }
    guardar(cliente);
    expect(saidas.length).toBeGreaterThan(0);
    for (const s of saidas) expect(s).not.toContain(CHAVE);
    const r: RespostaHub = await cliente.chamar(CRED, { metodo: 'GET', caminho: '/ok' });
    expect(Object.keys(r).sort()).toEqual(['corpo', 'replay', 'status', 'tipo']);
  });

  it('o SDK não expõe curva de retentativa do Hub (é do domain do integracao-fdv, T-0009 §5)', () => {
    expect(Object.keys(sdk).filter((k) => /espera|curva|ESPERA/.test(k))).toEqual([]);
  });
});
