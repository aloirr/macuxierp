/**
 * Logos do e-mail pelo domínio (conferir-logos.mjs, v0.3.21): a lista sai do modelo do e-mail da senha temporária e cada
 * logo precisa responder 200 com image/png. Com um `fetch` falso: nada de rede no teste.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { conferirLogo, logosDoModelo, main } from './producao/conferir-logos.mjs';

const pasta = mkdtempSync(join(tmpdir(), 'logos-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

const resposta = (status, tipo) => ({ status, headers: new Headers(tipo ? { 'content-type': tipo } : {}) });
const rapido = { tentativas: 2, esperaMs: 0 };

describe('conferir-logos.mjs', () => {
  it('lê do modelo real os dois logos (claro e escuro), em https e .png, sem repetição', async () => {
    const { readFileSync } = await import('node:fs');
    const modelo = readFileSync(new URL('../../packages/platform-sdk/src/email-senha-temporaria-html.ts', import.meta.url), 'utf8');
    const logos = logosDoModelo(modelo);
    assert.equal(logos.length, 2);
    for (const u of logos) assert.match(u, /^https:\/\/erp\.macuxifdv\.com\.br\/email\/[a-z0-9-]+\.png$/);
    assert.deepEqual(logosDoModelo(`${modelo}${modelo}`), logos);
  });

  it('200 image/png passa; com charset no content-type também', async () => {
    assert.equal((await conferirLogo('https://x/email/a.png', { ...rapido, buscar: async () => resposta(200, 'image/png') })).ok, true);
    assert.equal((await conferirLogo('https://x/email/a.png', { ...rapido, buscar: async () => resposta(200, 'IMAGE/PNG; charset=binary') })).ok, true);
  });

  it('404, 200 com text/html (a página de erro do Next) ou sem resposta: falha com o detalhe, depois das tentativas', async () => {
    let chamadas = 0;
    const r404 = await conferirLogo('https://x/email/a.png', { ...rapido, buscar: async () => (chamadas++, resposta(404, 'text/html')) });
    assert.deepEqual([r404.ok, r404.detalhe, chamadas], [false, '404 text/html', 2]);
    assert.equal((await conferirLogo('https://x/email/a.png', { ...rapido, buscar: async () => resposta(200, 'text/html') })).detalhe, '200 text/html');
    const semRede = await conferirLogo('https://x/email/a.png', { ...rapido, buscar: async () => { throw new TypeError('fetch failed'); } });
    assert.equal(semRede.detalhe, 'sem resposta (TypeError)');
  });

  it('o segundo intervalo acerta: o túnel pode demorar depois do compose up', async () => {
    let n = 0;
    const r = await conferirLogo('https://x/email/a.png', { ...rapido, buscar: async () => (n++ ? resposta(200, 'image/png') : resposta(502, 'text/html')) });
    assert.equal(r.ok, true);
  });

  it('main: 0 com todos ok, 1 com algum falhando, 2 com modelo sem logo; manda HEAD sem seguir redirecionamento', async () => {
    const modelo = join(pasta, 'modelo.ts');
    writeFileSync(modelo, '<img src="https://erp.exemplo/email/a.png"><img src="https://erp.exemplo/email/b.png">');
    const pedidos = [];
    const buscar = async (url, init) => (pedidos.push([url, init.method, init.redirect]), resposta(url.endsWith('a.png') ? 200 : 404, url.endsWith('a.png') ? 'image/png' : 'text/html'));
    assert.equal(await main([modelo], { ...rapido, buscar: async () => resposta(200, 'image/png') }), 0);
    assert.equal(await main([modelo], { ...rapido, buscar }), 1);
    assert.deepEqual(pedidos[0], ['https://erp.exemplo/email/a.png', 'HEAD', 'manual']);
    writeFileSync(modelo, 'sem logo');
    assert.equal(await main([modelo], rapido), 2);
  });
});
