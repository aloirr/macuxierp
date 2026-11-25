import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ cookie: 'tok' as string | undefined, apagados: [] as unknown[], redirecionou: [] as string[] }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'mx_config' && estado.cookie ? { value: estado.cookie } : undefined), delete: (x: unknown) => estado.apagados.push(x) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    estado.redirecionou.push(d);
    throw new Error(`REDIRECT ${d}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { atualizarReceitaAcao, revelarContatoAcao } from './acoes-ficha';

const ID = '11111111-1111-4111-8111-111111111111';
const EMAIL = 'maria@exemplo.com.br';
const chamadas: { url: string; metodo: string; cache?: string; h: Record<string, string> }[] = [];
let resposta: () => Response;
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const erroApi = (status: number, codigo: string, detalhes?: Record<string, string>, mensagem = 'x') => json({ codigo, mensagem, ...(detalhes ? { detalhes } : {}) }, status);
const ficha = {
  nome_fantasia: null, ie: null, logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', cep: '69000000', municipio_ibge: '1302603', uf: 'AM',
  email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'Ativa', situacao_cadastral_data: '2020-01-31',
  data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais', cnae_secundarios: [], receita_fonte: 'fonte-ficticia', receita_consultada_em: '2026-11-24T12:00:00.000Z',
};
// Textos fictícios: a tela exibe a `mensagem` do core como vem, então os testes não dependem do texto real.
const MSG = 'Mensagem fictícia do core.';

beforeEach(() => {
  Object.assign(estado, { cookie: 'tok', apagados: [], redirecionou: [] });
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  vi.stubGlobal('fetch', async (url: string, init: { method: string; cache?: string; headers: Record<string, string> }) => {
    chamadas.push({ url, metodo: init.method, cache: init.cache, h: init.headers });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ações da ficha da Receita (T-0101)', () => {
  it('Mostrar: POST na rota do campo, no-store, anti-CSRF, sem Idempotency-Key; o valor só vai na resposta e nunca ao log', async () => {
    const log = vi.spyOn(console, 'log');
    const erro = vi.spyOn(console, 'error');
    resposta = () => json({ valor: EMAIL });
    const r = await revelarContatoAcao(ID, 'email');
    expect(r).toEqual({ ok: true, valor: { valor: EMAIL } });
    expect(chamadas[0]).toMatchObject({ metodo: 'POST', cache: 'no-store' });
    expect(chamadas[0]?.url).toMatch(new RegExp(`/empresas/${ID}/contato/email$`));
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    expect(JSON.stringify([log.mock.calls, erro.mock.calls])).not.toContain('maria@');
  });
  it('Mostrar o telefone usa a rota do telefone; campo fora da lista nem chega à API', async () => {
    resposta = () => json({ valor: '(92) 99999-1234' });
    await revelarContatoAcao(ID, 'telefone');
    expect(chamadas[0]?.url).toMatch(/\/contato\/telefone$/);
    chamadas.length = 0;
    expect(await revelarContatoAcao(ID, 'senha')).toMatchObject({ ok: false });
    expect(chamadas).toHaveLength(0);
  });
  it('Atualizar: POST em /receita com a Idempotency-Key e o anti-CSRF; devolve só os nomes dos campos e a ficha mascarada', async () => {
    resposta = () => json({ estado: 'ok', campos_alterados: ['razao_social'], ficha });
    const r = await atualizarReceitaAcao(ID, 'chave-receita');
    expect(r).toMatchObject({ ok: true, valor: { campos_alterados: ['razao_social'] } });
    expect(chamadas[0]).toMatchObject({ metodo: 'POST' });
    expect(chamadas[0]?.url).toMatch(new RegExp(`/empresas/${ID}/receita$`));
    expect(chamadas[0]?.h['idempotency-key']).toBe('chave-receita');
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
  });
  it('409 (formato padrão da API): exibe a mensagem dela', async () => {
    resposta = () => erroApi(409, 'CONFLITO', undefined, MSG);
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: MSG, chaveNova: true });
  });
  it.each(['fonte_indisponivel', 'cnpj_nao_encontrado', 'cnpj_invalido', 'resposta_invalida', 'cnpj_divergente'])('falha da fonte %s (200, estado erro): exibe a mensagem do core como vem', async (motivo) => {
    resposta = () => json({ estado: 'erro', motivo, mensagem: MSG, ficha });
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: MSG, chaveNova: true });
    resposta = () => json({ estado: 'erro', motivo, mensagem: MSG, ficha: null });
    expect((await atualizarReceitaAcao(ID, 'k')).ok).toBe(false);
  });
  it('422 RN-CORE-14 (campo acima do limite): a mensagem do core; sem ela, o texto da tela', async () => {
    resposta = () => erroApi(422, 'REGRA', undefined, MSG);
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: MSG, chaveNova: true });
    resposta = () => json({ codigo: 'REGRA' }, 422);
    const r = await atualizarReceitaAcao(ID, 'k');
    expect(r.ok ? '' : r.erro).toContain('Tente de novo mais tarde');
  });
  it('503 (porta de CNPJ ainda sem ligar): indisponibilidade da fonte, com ou sem código no corpo', async () => {
    resposta = () => json({ codigo: 'INDISPONIVEL', mensagem: MSG }, 503);
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: 'Não foi possível consultar a Receita agora. Tente de novo em alguns minutos.' });
    resposta = () => new Response('', { status: 503 });
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: 'Não foi possível consultar a Receita agora. Tente de novo em alguns minutos.' });
  });
  it('404 e 401', async () => {
    resposta = () => erroApi(404, 'NAO_ENCONTRADO');
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: 'Empresa não encontrada. Volte à lista.' });
    resposta = () => erroApi(401, 'NAO_AUTENTICADO');
    estado.redirecionou.length = 0;
    await expect(atualizarReceitaAcao(ID, 'k')).rejects.toThrow(/REDIRECT/);
    expect(estado.redirecionou).toHaveLength(1);
  });
  it('só superadmin: sem sessão nem chama a API; 403 mostra "sem permissão"', async () => {
    estado.cookie = undefined;
    await expect(revelarContatoAcao(ID, 'email')).rejects.toThrow(/REDIRECT/);
    await expect(atualizarReceitaAcao(ID, 'k')).rejects.toThrow(/REDIRECT/);
    expect(chamadas).toHaveLength(0);
    estado.cookie = 'tok';
    resposta = () => erroApi(403, 'SEM_PERMISSAO');
    expect(await revelarContatoAcao(ID, 'email')).toMatchObject({ ok: false, erro: 'Você não tem permissão para esta ação.' });
  });
});
