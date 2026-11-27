import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ cookie: 'tok' as string | undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'mx_config' && estado.cookie ? { value: estado.cookie } : undefined), delete: vi.fn() }) }));
vi.mock('next/navigation', () => ({ redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { cargaCompletaFdvAcao, configurarFdvAcao, lerLogFdvAcao, lerMonitorFdvAcao, reprocessarFdvAcao, retomarFdvAcao, salvarCredencialFdvAcao, testarConexaoFdvAcao } from './acoes-integracao-fdv';

const ID = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'chave-secreta-do-conector-0123456789abcdef';
const chamadas: { url: string; metodo: string; corpo: string; h: Record<string, string> }[] = [];
let resposta: () => Response;
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const ENTIDADES: readonly string[] = ENTIDADES_ENVIO_FDV;
const integracao = (hab: string[]) => ({
  empresa_id: ID, modulo_licenciado: true, credencial_id: ID, conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: 'chave-se', criada_em: '2026-11-23T12:00:00.000Z',
  entidades_habilitadas: hab, limite_registros_lote: 500, ultimo_sinal: null,
  cadastros: ENTIDADES.map((entidade) => ({ entidade, ligada: hab.includes(entidade), ultimo_envio_em: null, falha: null, lote_em_voo: false })),
});

beforeEach(() => {
  estado.cookie = 'tok';
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
    chamadas.push({ url, metodo: init.method, corpo: init.body ?? '', h: init.headers });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ações da aba Integração (T-0056)', () => {
  it('salvar a credencial: PUT com o cabeçalho anti-CSRF, sem Idempotency-Key, e a chave não volta na resposta', async () => {
    resposta = () => json(integracao([]), 201);
    const r = await salvarCredencialFdvAcao(ID, { conector_id: ' erp-1 ', chave: CHAVE, ambiente: 'teste' });
    expect(r.ok).toBe(true);
    expect(chamadas[0]).toMatchObject({ metodo: 'PUT', corpo: JSON.stringify({ conector_id: 'erp-1', chave: CHAVE, ambiente: 'teste' }) });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${ID}/integracao-fdv/credencial`);
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });
  it('chave curta: recusa antes da API, com a mensagem fixa e sem repetir o valor', async () => {
    const r = await salvarCredencialFdvAcao(ID, { conector_id: 'erp-1', chave: 'curta', ambiente: 'teste' });
    expect(r).toMatchObject({ ok: false, campos: { chave: 'A chave tem pelo menos 32 caracteres' } });
    expect(JSON.stringify(r)).not.toContain('curta');
    expect(chamadas).toHaveLength(0);
  });
  it('ligar: PUT configuracao com a lista na ordem de carga e a Idempotency-Key', async () => {
    resposta = () => json(integracao(['produto', 'cliente']));
    const r = await configurarFdvAcao(ID, { entidades_habilitadas: ['produto', 'cliente'], limite_registros_lote: 500 }, 'k-cfg');
    expect(r.ok).toBe(true);
    expect(chamadas[0]).toMatchObject({ metodo: 'PUT', corpo: JSON.stringify({ entidades_habilitadas: ['produto', 'cliente'], limite_registros_lote: 500 }) });
    expect(chamadas[0]?.h['idempotency-key']).toBe('k-cfg');
  });
  it('desligar tudo: lista vazia é aceita', async () => {
    resposta = () => json(integracao([]));
    expect((await configurarFdvAcao(ID, { entidades_habilitadas: [], limite_registros_lote: 500 }, 'k')).ok).toBe(true);
  });
  it('cadastro fora da lista e repetido são recusados antes da API', async () => {
    expect((await configurarFdvAcao(ID, { entidades_habilitadas: ['titulo'], limite_registros_lote: 500 }, 'k')).ok).toBe(false);
    expect((await configurarFdvAcao(ID, { entidades_habilitadas: ['produto', 'produto'], limite_registros_lote: 500 }, 'k')).ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
  it('carga completa (aba Dados): POST com a Idempotency-Key; cadastro desconhecido não sai; lote em voo vira mensagem', async () => {
    resposta = () => json({ aceito: true }, 202);
    expect((await cargaCompletaFdvAcao(ID, 'produto', 'k-carga')).ok).toBe(true);
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${ID}/integracao-fdv/entidades/produto/carga-completa`);
    expect(chamadas[0]?.h['idempotency-key']).toBe('k-carga');
    expect((await cargaCompletaFdvAcao(ID, '../x', 'k')).ok).toBe(false);
    expect(chamadas).toHaveLength(1);
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'Há um envio em andamento neste cadastro.' }, 409);
    expect(await cargaCompletaFdvAcao(ID, 'produto', 'k2')).toMatchObject({ ok: false, erro: 'Há um envio em andamento neste cadastro.' });
  });
  it('reprocessar: POST com a Idempotency-Key, resposta validada pelo SDK; cadastro desconhecido não sai', async () => {
    resposta = () => json({ entidade: 'produto', falhas: 2, pendentes: 5, pedido_em: '2026-11-24T20:00:00.000Z' });
    const r = await reprocessarFdvAcao(ID, 'produto', 'k-rep');
    expect(r).toMatchObject({ ok: true, valor: { falhas: 2, pendentes: 5 } });
    expect(chamadas[0]).toMatchObject({ metodo: 'POST' });
    expect(chamadas[0]?.url).toContain(`/v1/plataforma/empresas/${ID}/integracao-fdv/entidades/produto/reprocessar`);
    expect(chamadas[0]?.h['idempotency-key']).toBe('k-rep');
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect((await reprocessarFdvAcao(ID, '../x', 'k')).ok).toBe(false);
    expect(chamadas).toHaveLength(1);
  });
  it('reprocessar com lote em voo: 409 CONFLITO vira mensagem e pede chave nova', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'Há um envio em andamento neste cadastro.' }, 409);
    expect(await reprocessarFdvAcao(ID, 'produto', 'k')).toMatchObject({ ok: false, erro: 'Há um envio em andamento neste cadastro.', chaveNova: true });
  });
  it('reprocessar com resposta fora do contrato: falha sem repassar o corpo', async () => {
    resposta = () => json({ entidade: 'produto', falhas: -1 });
    const r = await reprocessarFdvAcao(ID, 'produto', 'k');
    expect(r.ok).toBe(false);
  });
  it('monitor: GET validado pelo SDK, sem Idempotency-Key', async () => {
    const m = { identificador: 'erp-1', situacao: 'em_dia', versao: '1.4.2', ultimo_sinal_em: '2026-11-24T19:59:00.000Z', fila: { lotes: 1, linhas: 40 }, lido_em: '2026-11-24T20:00:00.000Z' };
    resposta = () => json(m);
    expect(await lerMonitorFdvAcao(ID)).toMatchObject({ ok: true, valor: { situacao: 'em_dia', fila: { lotes: 1, linhas: 40 } } });
    expect(chamadas[0]).toMatchObject({ metodo: 'GET' });
    expect(chamadas[0]?.url).toContain(`/integracao-fdv/monitor`);
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    resposta = () => json({ ...m, situacao: 'em_dia', ultimo_sinal_em: null });
    expect((await lerMonitorFdvAcao(ID)).ok).toBe(false);
  });
  it('log: GET por cadastro, só códigos, campos e contagens; cadastro desconhecido não sai', async () => {
    const l = { entidade: 'cliente', lido_em: '2026-11-24T20:00:00.000Z', envios: [{ em: '2026-11-24T19:00:00.000Z', origem: 'zerar', situacao: 'com_erros', registros: 10, com_erro: 2 }], total_erros: 3, motivo: 'erros_por_linha', erros: [{ codigo: 'cnpj_invalido', campo: 'documento', quantidade: 3 }] };
    resposta = () => json(l);
    const r = await lerLogFdvAcao(ID, 'cliente');
    expect(r).toMatchObject({ ok: true, valor: { total_erros: 3 } });
    expect(chamadas[0]?.url).toContain('/entidades/cliente/log');
    expect((await lerLogFdvAcao(ID, '../x')).ok).toBe(false);
    resposta = () => json({ ...l, erros: [{ codigo: 'cnpj_invalido', campo: 'documento', quantidade: 9 }] });
    expect((await lerLogFdvAcao(ID, 'cliente')).ok).toBe(false);
  });
  it('retomar: POST /retomar e devolve se havia pausa', async () => {
    resposta = () => json({ retomada: true });
    const r = await retomarFdvAcao(ID, 'cliente', 'k-ret');
    expect(r).toMatchObject({ ok: true, valor: { retomada: true } });
    expect(chamadas[0]?.url).toContain('/entidades/cliente/retomar');
  });
  it('testar conexão: 202 com o pedido_em', async () => {
    resposta = () => json({ aceito: true, pedido_em: '2026-11-23T12:00:00.000Z' }, 202);
    expect(await testarConexaoFdvAcao(ID, 'k-t')).toMatchObject({ ok: true, valor: { pedido_em: '2026-11-23T12:00:00.000Z' } });
  });
  it('409 (MXI01/MXI02): mostra a mensagem da API e pede chave nova', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'A credencial mudou. Recarregue a página e tente de novo.' }, 409);
    const r = await salvarCredencialFdvAcao(ID, { conector_id: 'erp-1', chave: CHAVE, ambiente: 'producao' });
    expect(r).toMatchObject({ ok: false, erro: 'A credencial mudou. Recarregue a página e tente de novo.' });
    const c = await reprocessarFdvAcao(ID, 'produto', 'k');
    expect(c).toMatchObject({ ok: false, erro: 'A credencial mudou. Recarregue a página e tente de novo.', chaveNova: true });
  });
  it('mensagem longa ou de várias linhas não passa: cai na mensagem de falha', async () => {
    resposta = () => json({ codigo: 'CONFLITO', mensagem: 'a\nb' }, 409);
    const r = await retomarFdvAcao(ID, 'produto', 'k');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).not.toContain('a\nb');
  });
});
