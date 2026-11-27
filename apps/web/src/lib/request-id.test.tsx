import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CodigoDoErro } from '@/components/codigo-do-erro';
import { ConfigIndisponivel } from './config/erros';
import { destinoErroEmpresa } from './config/empresa';
import { FalhaIndisponivel } from '@/components/falha-indisponivel';
import { idDaRequisicao, ROTULO_CODIGO_SUPORTE } from './request-id';
import { TEXTO_INDISPONIVEL } from './telas/comum';

vi.setConfig({ testTimeout: 15000 });

const resp = (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: cabecalhos });

describe('request_id do 5xx na tela de indisponível', () => {
  it('prefere o request_id do corpo; sem corpo usa x-request-id; sem nenhum, nada', async () => {
    expect(await idDaRequisicao(resp(503, { codigo: 'X', mensagem: 'm', request_id: 'req-abc123' }, { 'x-request-id': 'outro' }))).toBe('req-abc123');
    expect(await idDaRequisicao(resp(502, 'bad gateway html', { 'x-request-id': 'req-cab-9' }))).toBe('req-cab-9');
    expect(await idDaRequisicao(resp(500, { codigo: 'X' }))).toBeUndefined();
    expect(await idDaRequisicao(resp(500, ''))).toBeUndefined();
  });
  it('só 5xx; 4xx não mostra código', async () => {
    expect(await idDaRequisicao(resp(404, { request_id: 'req-1' }))).toBeUndefined();
  });
  it('descarta valor fora do formato (nada de texto livre ou dado pessoal na tela)', async () => {
    expect(await idDaRequisicao(resp(500, { request_id: 'a b <script>' }))).toBeUndefined();
    expect(await idDaRequisicao(resp(500, { request_id: 'x'.repeat(100) }))).toBeUndefined();
    expect(await idDaRequisicao(resp(500, { request_id: 42 }))).toBeUndefined();
  });
  it('o rótulo e o componente: "Código para o suporte: <id>" com o id em <code>, ou nada', () => {
    expect(ROTULO_CODIGO_SUPORTE).toBe('Código para o suporte:');
    const h = renderToStaticMarkup(<CodigoDoErro id="req-1" />);
    expect(h).toContain('Código para o suporte: <code class="codigo">req-1</code>');
    expect(h).not.toContain('<input');
    expect(renderToStaticMarkup(<CodigoDoErro id={undefined} />)).toBe('');
  });
  it('FalhaIndisponivel: texto único, título opcional e o código só quando há id (RD-X3)', () => {
    const h = renderToStaticMarkup(<FalhaIndisponivel requestId="req-9" titulo="Pedidos" />);
    expect(h).toContain(TEXTO_INDISPONIVEL);
    expect(h).toContain('<h1>Pedidos</h1>');
    expect(h).toContain('role="alert"');
    expect(h).toContain('<code class="codigo">req-9</code>');
    expect(renderToStaticMarkup(<FalhaIndisponivel requestId={undefined} />)).not.toContain('Código para o suporte');
  });
  it('/config: o 5xx vira ConfigIndisponivel com o request_id e a ficha da empresa o repassa', async () => {
    const { recusar } = await import('./config/api');
    const e = await recusar(resp(503, { codigo: '', mensagem: 'x', request_id: 'req-77' })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConfigIndisponivel);
    expect((e as ConfigIndisponivel).requestId).toBe('req-77');
    expect(destinoErroEmpresa(e)).toMatchObject({ tipo: 'tela', requestId: 'req-77' });
    const sem = await recusar(resp(500, 'x')).catch((x: unknown) => x);
    expect((sem as ConfigIndisponivel).requestId).toBeUndefined();
  });
});

describe('shell do BKO: ApiIndisponivel leva o request_id', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it('getValidado e buscarRegistro', async () => {
    vi.resetModules();
    vi.stubEnv('MACUXIERP_API_URL', 'https://api.exemplo.invalid');
    vi.stubGlobal('fetch', vi.fn(async () => resp(503, { codigo: 'IND', mensagem: 'm', request_id: 'req-bko-1' })));
    const { getValidado, buscarRegistro, ApiIndisponivel } = await import('./api');
    const a = await getValidado('/v1/x', z.unknown(), 't', 'x', true).catch((x: unknown) => x);
    expect(a).toBeInstanceOf(ApiIndisponivel);
    expect((a as InstanceType<typeof ApiIndisponivel>).requestId).toBe('req-bko-1');
    const b = await buscarRegistro('/v1/x', z.unknown(), 't', 'x').catch((x: unknown) => x);
    expect((b as InstanceType<typeof ApiIndisponivel>).requestId).toBe('req-bko-1');
    vi.stubGlobal('fetch', vi.fn(async () => resp(500, 'x')));
    const c = await getValidado('/v1/x', z.unknown(), 't', 'x', true).catch((x: unknown) => x);
    expect((c as InstanceType<typeof ApiIndisponivel>).requestId).toBeUndefined();
  });
});
