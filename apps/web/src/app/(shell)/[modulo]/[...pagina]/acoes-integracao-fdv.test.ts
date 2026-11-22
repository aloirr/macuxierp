import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Perfil } from '@macuxierp/platform-sdk';

const estado = vi.hoisted(() => ({ perfil: 'administrador' as Perfil, licenciado: true, chamadas: [] as { url: string; metodo: string; corpo: string }[] }));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'mx_acesso' ? { value: 'tok' } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/sessao', () => ({
  COOKIE_ACESSO: 'mx_acesso',
  contexto: async () => ({ eu: { usuario: { perfil: estado.perfil }, modulos: estado.licenciado ? [{ id: 'integracao-fdv', menus: [] }] : [] } }),
}));

import { agirIntegracaoFdv } from './acoes-integracao-fdv';

const CHAVE = 'k'.repeat(40);

beforeEach(() => {
  estado.perfil = 'administrador';
  estado.licenciado = true;
  estado.chamadas = [];
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  // dublê do cliente: nada sai para o Hub real
  vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
    estado.chamadas.push({ url, metodo: init.method, corpo: init.body ?? '' });
    return new Response(JSON.stringify({ aceito: true, pedido_em: '2026-11-22T14:00:00.000Z' }), { status: 202, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('ações da tela Integração FDV', () => {
  it('só o administrador com a licença chama a API', async () => {
    for (const perfil of ['gerente', 'leitura'] as Perfil[]) {
      estado.perfil = perfil;
      expect((await agirIntegracaoFdv({ tipo: 'testar' })).ok).toBe(false);
    }
    estado.perfil = 'administrador';
    estado.licenciado = false;
    expect((await agirIntegracaoFdv({ tipo: 'testar' })).ok).toBe(false);
    expect(estado.chamadas).toHaveLength(0);
  });
  it('testar conexão faz POST na rota do módulo', async () => {
    expect((await agirIntegracaoFdv({ tipo: 'testar' })).ok).toBe(true);
    expect(estado.chamadas[0]).toMatchObject({ url: 'https://api.exemplo.invalid/v1/integracao-fdv/credencial/testar', metodo: 'POST' });
  });
  it('chave inválida não chega à API e a resposta nunca repete a chave', async () => {
    const r = await agirIntegracaoFdv({ tipo: 'credencial', conector_id: 'erp 1', chave: 'curta', ambiente: 'teste' });
    expect(r.ok).toBe(false);
    expect(estado.chamadas).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('curta');
  });
  it('salva a credencial: a chave só vai no corpo e a resposta traz só o prefixo', async () => {
    vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
      estado.chamadas.push({ url, metodo: init.method, corpo: init.body ?? '' });
      return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'kkkkkkkk', criada_em: '2026-11-22T14:00:00.000Z', ultimo_uso_em: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = await agirIntegracaoFdv({ tipo: 'credencial', conector_id: 'erp-1', chave: CHAVE, ambiente: 'teste' });
    expect(r).toEqual({ ok: true, mensagem: 'Credencial salva.' });
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    expect(estado.chamadas[0]).toMatchObject({ metodo: 'PUT', url: 'https://api.exemplo.invalid/v1/integracao-fdv/credencial' });
  });
  it('resposta sem o resumo da credencial é recusada sem expor a chave', async () => {
    const r = await agirIntegracaoFdv({ tipo: 'credencial', conector_id: 'erp-1', chave: CHAVE, ambiente: 'teste' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });
  it('salva a configuração e recusa limite 0', async () => {
    vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string }) => {
      estado.chamadas.push({ url, metodo: init.method, corpo: init.body ?? '' });
      return new Response(JSON.stringify({ entidades_habilitadas: ['produto'], limite_registros_lote: 100 }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const zero = await agirIntegracaoFdv({ tipo: 'configuracao', entidades_habilitadas: ['produto'], limite_registros_lote: '0' });
    expect(zero.ok).toBe(false);
    expect(estado.chamadas).toHaveLength(0);
    const r = await agirIntegracaoFdv({ tipo: 'configuracao', entidades_habilitadas: ['produto'], limite_registros_lote: '100' });
    expect(r).toEqual({ ok: true, mensagem: 'Configuração salva.' });
    expect(estado.chamadas[0]).toMatchObject({ metodo: 'PUT', url: 'https://api.exemplo.invalid/v1/integracao-fdv/configuracao' });
  });
  it('tentar de novo (todas): entidades inválidas são recusadas e falha no meio informa quantas foram', async () => {
    expect((await agirIntegracaoFdv({ tipo: 'retomar', entidades: 'produto' as never })).ok).toBe(false);
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n += 1;
      return n === 1 ? new Response('{"retomada":true}', { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 500 });
    });
    const r = await agirIntegracaoFdv({ tipo: 'retomar', entidades: ['produto', 'cliente'] });
    expect(r.ok).toBe(false);
    expect(r.recarregar).toBe(true);
    expect(r.mensagem).toContain('1 de 2');
  });
  it('carga completa e limite fora de 1 a 5.000 são conferidos antes da API', async () => {
    expect((await agirIntegracaoFdv({ tipo: 'carga', entidade: 'inexistente' })).ok).toBe(false);
    const c = await agirIntegracaoFdv({ tipo: 'configuracao', entidades_habilitadas: ['produto'], limite_registros_lote: '5001' });
    expect(c.ok).toBe(false);
    expect(c.erros?.limite_registros_lote).toBeTruthy();
    expect(estado.chamadas).toHaveLength(0);
    expect((await agirIntegracaoFdv({ tipo: 'carga', entidade: 'produto' })).ok).toBe(true);
  });
});
