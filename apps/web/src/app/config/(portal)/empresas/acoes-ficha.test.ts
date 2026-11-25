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
  razao_social: 'Empresa Ficticia Ltda', nome_fantasia: null, cnpj: '11222333000181', situacao_cadastral: 'Ativa', data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais',
  cnae_principal: { codigo: '4711302', descricao: 'Comércio varejista' }, cnae_secundarios: [], endereco: { logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', cep: '69000000', municipio: 'Manaus', municipio_ibge: '1302603', uf: 'AM' },
  regime: 'simples', consultado_em: '2026-11-24T12:00:00.000Z', fonte: 'brasilapi', email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234',
};

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
  it('Revelar: POST na rota do campo, no-store, anti-CSRF, sem Idempotency-Key; o valor só vai na resposta e nunca ao log', async () => {
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
  it('Revelar o telefone usa a rota do telefone; campo fora da lista nem chega à API', async () => {
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
  it('409 sem core.empresa: "Cadastre a filial padrão antes."', async () => {
    resposta = () => erroApi(409, 'CONFLITO', undefined, 'Cadastre a filial padrão antes');
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: 'Cadastre a filial padrão antes.', chaveNova: true });
  });
  it.each([
    ['fonte_indisponivel', /Receita não respondeu/],
    ['nao_encontrado', /não encontrou este CNPJ/],
    ['cnpj_invalido', /CNPJ da empresa é inválido/],
  ])('falha da fonte %s (erro da API) tem a sua mensagem, sem o corpo cru', async (codigo, texto) => {
    resposta = () => erroApi(422, 'VALIDACAO', { codigo }, 'corpo cru com 11222333000181');
    const r = await atualizarReceitaAcao(ID, 'k');
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.erro).toMatch(texto);
    expect(JSON.stringify(r)).not.toContain('11222333000181');
  });
  it('falha da fonte no resultado do contrato (estado erro, 200) vira a mensagem do motivo', async () => {
    resposta = () => json({ estado: 'erro', motivo: 'fonte_indisponivel', mensagem: 'x', ficha });
    const r = await atualizarReceitaAcao(ID, 'k');
    expect(r.ok ? '' : r.erro).toMatch(/Receita não respondeu/);
    resposta = () => json({ estado: 'erro', motivo: 'cnpj_nao_encontrado', mensagem: 'x', ficha: null });
    expect((await atualizarReceitaAcao(ID, 'k')).ok).toBe(false);
  });
  it('422 de dado inválido, 404 e 401', async () => {
    resposta = () => erroApi(422, 'VALIDACAO');
    expect(await atualizarReceitaAcao(ID, 'k')).toMatchObject({ ok: false, erro: expect.stringContaining('não passaram na conferência') });
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
