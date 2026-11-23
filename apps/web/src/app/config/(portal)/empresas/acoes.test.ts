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

import { mostrarEmailAcao, criarAdminAcao, criarEmpresaAcao, redefinirSenhaAcao, situacaoAcao, alterarModulosAcao, maisEmpresasAcao } from './acoes';

const ID = '11111111-1111-4111-8111-111111111111';
const SENHA = 'Zq7-secreta-XYZ99';
const chamadas: { url: string; metodo: string; corpo: string; h: Record<string, string> }[] = [];
let resposta: () => Response;
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const empresa = { id: ID, slug: 'acme', nome: 'Acme', fuso: 'America/Manaus', situacao: 'suspenso', modulos: [], primeiro_admin: null, created_at: '2026-11-23T12:00:00.000Z', updated_at: '2026-11-23T12:00:00.000Z' };

beforeEach(() => {
  Object.assign(estado, { cookie: 'tok', apagados: [], redirecionou: [] });
  chamadas.length = 0;
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  vi.stubGlobal('fetch', async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
    chamadas.push({ url, metodo: init.method, corpo: init.body ?? '', h: init.headers });
    return resposta();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('ações do portal', () => {
  it('suspender manda a chave e o motivo sem espaços', async () => {
    resposta = () => json(empresa);
    const r = await situacaoAcao(ID, 'suspenso', '  inadimplência  ', 'chave-situacao');
    expect(r.ok).toBe(true);
    expect(chamadas[0]).toMatchObject({ metodo: 'PUT', corpo: JSON.stringify({ situacao: 'suspenso', motivo: 'inadimplência' }) });
    expect(chamadas[0]?.h['idempotency-key']).toBe('chave-situacao');
  });
  it('motivo curto é recusado antes da API, com a mensagem da spec', async () => {
    const r = await situacaoAcao(ID, 'suspenso', 'ab', 'k');
    expect(r).toMatchObject({ ok: false, campos: { motivo: 'Informe o motivo (3 a 200 caracteres).' } });
    expect(chamadas).toHaveLength(0);
  });
  it('redefinir a senha: a senha vai só no valor da resposta, com a chave, e nunca a log', async () => {
    const log = vi.spyOn(console, 'log');
    const erro = vi.spyOn(console, 'error');
    resposta = () => json({ usuario_id: ID, senha_provisoria: SENHA });
    const r = await redefinirSenhaAcao(ID, 'chave-senha');
    expect(r).toEqual({ ok: true, valor: { senha: SENHA } });
    expect(chamadas[0]?.h['idempotency-key']).toBe('chave-senha');
    expect(chamadas[0]?.url).toMatch(/\/primeiro-admin\/senha$/);
    expect(JSON.stringify([log.mock.calls, erro.mock.calls])).not.toContain(SENHA);
  });
  it('mostrar e-mail: POST com x-macuxierp-config, sem Idempotency-Key, e o e-mail só no valor', async () => {
    const log = vi.spyOn(console, 'log');
    const erro = vi.spyOn(console, 'error');
    resposta = () => json({ email: 'admin@exemplo.com.br' });
    const r = await mostrarEmailAcao(ID);
    expect(r).toEqual({ ok: true, valor: { email: 'admin@exemplo.com.br' } });
    expect(chamadas[0]).toMatchObject({ metodo: 'POST' });
    expect(chamadas[0]?.url).toMatch(/\/primeiro-admin\/email$/);
    expect(chamadas[0]?.h['x-macuxierp-config']).toBe('1');
    expect(chamadas[0]?.h['idempotency-key']).toBeUndefined();
    expect(JSON.stringify([log.mock.calls, erro.mock.calls])).not.toContain('admin@exemplo');
  });
  it('mostrar e-mail: erro da API vira mensagem fixa, sem corpo', async () => {
    resposta = () => json({ mensagem: 'admin@exemplo.com.br' }, 503);
    const r = await mostrarEmailAcao(ID);
    expect(r).toMatchObject({ ok: false, erro: 'Não foi possível concluir. Tente de novo.' });
    expect(JSON.stringify(r)).not.toContain('admin@');
  });
  it('criar administrador: e-mail inválido fica junto do campo, antes da API', async () => {
    expect(await criarAdminAcao(ID, { email: 'sem-arroba', nome: 'Administrador' }, 'k')).toMatchObject({ ok: false, campos: { email: 'E-mail inválido. Confira o endereço.' } });
    expect(chamadas).toHaveLength(0);
  });
  it('criar empresa: código reservado e fora do padrão ficam junto do campo; sucesso redireciona à empresa', async () => {
    expect(await criarEmpresaAcao({ slug: 'config', nome: 'Acme', fuso: 'America/Manaus' }, 'k')).toMatchObject({ campos: { slug: 'Código reservado. Escolha outro.' } });
    expect(await criarEmpresaAcao({ slug: 'Acme!', nome: 'Acme', fuso: '' }, 'k')).toMatchObject({ campos: { slug: 'Código fora do padrão. Veja a regra acima.' } });
    expect(await criarEmpresaAcao({ slug: 'acme', nome: ' ', fuso: '' }, 'k')).toMatchObject({ campos: { nome: 'Informe o nome da empresa (2 a 120 caracteres).' } });
    expect(chamadas).toHaveLength(0);
    resposta = () => json(empresa, 201);
    await expect(criarEmpresaAcao({ slug: 'acme', nome: 'Acme', fuso: '' }, 'chave-criar')).rejects.toThrow(`REDIRECT /config/empresas/${ID}?criada=1`);
    expect(chamadas[0]?.h['idempotency-key']).toBe('chave-criar');
  });
  it('módulos: o 422 volta com os campos para a faixa de pendências', async () => {
    resposta = () => json({ codigo: 'RN-CORE-02', campos: { 'modulos.faturamento': 'exige fiscal' } }, 422);
    const r = await alterarModulosAcao(ID, [{ modulo: 'faturamento', ativo: true, valido_ate: null }]);
    expect(r).toMatchObject({ ok: false, campos: { 'modulos.faturamento': 'exige fiscal' } });
  });
  it('módulos: o corpo enviado traz só os módulos editáveis, nunca o core', async () => {
    resposta = () => json(empresa);
    const r = await alterarModulosAcao(ID, [{ modulo: 'pedido', ativo: true, valido_ate: null }]);
    expect(r.ok).toBe(true);
    const corpo = JSON.parse(chamadas[0]?.corpo ?? '{}') as { modulos: { modulo: string }[] };
    expect(corpo.modulos.map((m) => m.modulo)).toEqual(['pedido']);
    expect(chamadas[0]?.corpo).not.toContain('"core"');
  });
  it('401 apaga o cookie do /config e volta ao login; sem cookie, vai direto ao login', async () => {
    resposta = () => json({}, 401);
    await expect(situacaoAcao(ID, 'ativo', 'volta', 'k')).rejects.toThrow('REDIRECT /config/entrar');
    expect(estado.apagados).toEqual([{ name: 'mx_config', path: '/config' }]);
    estado.cookie = undefined;
    chamadas.length = 0;
    await expect(redefinirSenhaAcao(ID, 'k')).rejects.toThrow('REDIRECT /config/entrar');
    expect(chamadas).toHaveLength(0);
  });
  it('403 e 5xx viram mensagem fixa, sem corpo da API', async () => {
    resposta = () => json({ mensagem: 'dado@pessoal.com' }, 403);
    expect(await situacaoAcao(ID, 'ativo', 'volta', 'k')).toMatchObject({ ok: false, erro: 'Você não tem permissão para esta ação.' });
    resposta = () => json({ mensagem: 'dado@pessoal.com' }, 503);
    const r = await situacaoAcao(ID, 'ativo', 'volta', 'k');
    expect(r).toMatchObject({ ok: false, erro: 'Não foi possível concluir. Tente de novo.', chaveNova: false });
    expect(JSON.stringify(r)).not.toContain('dado@');
  });
});

describe('maisEmpresasAcao', () => {
  it('manda busca e cursor à API e devolve a página; cursor inválido nem chama', async () => {
    resposta = () => json({ itens: [empresa], proximo_cursor: null });
    const r = await maisEmpresasAcao('acme', ID);
    expect(r.ok && r.valor.itens).toHaveLength(1);
    expect(chamadas[0]?.url).toContain(`busca=acme&cursor=${ID}`);
    chamadas.length = 0;
    const ruim = await maisEmpresasAcao('', 'x');
    expect(ruim.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});
