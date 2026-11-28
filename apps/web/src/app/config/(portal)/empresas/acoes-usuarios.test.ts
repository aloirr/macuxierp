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

import { MENSAGEM_EMAIL_EM_USO, MENSAGEM_ULTIMO_ADMIN, type UsuarioConfig } from '@macuxierp/core/contracts';
import { criarUsuarioAcao, editarUsuarioAcao, excluirUsuarioAcao, inativarUsuarioAcao, reativarUsuarioAcao, redefinirSenhaUsuarioAcao } from './acoes-usuarios';
import { listarUsuarios } from '@/lib/config/api';

const EMP = '11111111-1111-4111-8111-111111111111';
const ADM = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const SENHA = 'Zq7-secreta-XYZ99';

/** API falsa da Config (RN-CORE-01, RN-CORE-17): guarda a lista, aplica as regras e devolve `acoes` e `ultimo_admin_ativo` como o core. */
let lista: UsuarioConfig[];
const chamadas: { metodo: string; caminho: string; corpo: string; chave?: string }[] = [];
const chavesUsadas = new Set<string>();
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const erro = (status: number, codigo: string, mensagem: string) => json({ codigo, mensagem }, status);

function recalcular(): void {
  const ativos = lista.filter((u) => u.perfil === 'administrador' && u.situacao !== 'inativo');
  for (const u of lista) {
    u.ultimo_admin_ativo = ativos.length === 1 && ativos[0]!.id === u.id;
    u.acoes = u.situacao === 'inativo' ? ['editar', 'reativar', 'excluir'] : u.ultimo_admin_ativo ? ['editar', 'redefinir_senha'] : ['editar', 'redefinir_senha', 'inativar', 'excluir'];
  }
}
const novo = (id: string, nome: string, perfil: UsuarioConfig['perfil']): UsuarioConfig => ({
  id, nome, email_mascarado: `${nome.slice(0, 2).toLowerCase()}****@exemplo.com`, perfil, filial_ids: [], situacao: 'ativo', ultimo_acesso_em: null, deve_trocar_senha: true, ultimo_admin_ativo: false, acoes: [],
});

function apiFalsa(url: string, init: { method: string; body?: string; headers: Record<string, string> }): Response {
  const caminho = new URL(url).pathname.replace('/v1/plataforma', '');
  const chave = init.headers['idempotency-key'];
  chamadas.push({ metodo: init.method, caminho, corpo: init.body ?? '', ...(chave ? { chave } : {}) });
  const m = /^\/empresas\/([^/]+)\/usuarios(?:\/([^/]+)(?:\/(senha|inativar|reativar|excluir))?)?$/.exec(caminho);
  if (!m || m[1] !== EMP) return erro(404, 'NAO_ENCONTRADO', 'não encontrado');
  const [, , id, sub] = m;
  const alvo = id ? lista.find((u) => u.id === id) : undefined;
  if (id && !alvo) return erro(404, 'NAO_ENCONTRADO', 'não encontrado');
  if (!id && init.method === 'GET') return json({ itens: lista });
  if (!id && init.method === 'POST') {
    if (!chave || chavesUsadas.has(chave)) return erro(409, 'CONFLITO', 'Requisição já concluída');
    chavesUsadas.add(chave);
    const c = JSON.parse(init.body ?? '{}') as { nome: string; email: string; perfil: UsuarioConfig['perfil'] };
    if (c.email === 'ana@exemplo.com') return erro(409, 'CONFLITO', MENSAGEM_EMAIL_EM_USO);
    const u = novo('9b3c5d7e-2f40-4b6c-8d8e-1f2a3b4c5d6e', c.nome, c.perfil);
    lista.push(u);
    recalcular();
    return json({ usuario: u, senha_provisoria: SENHA }, 201);
  }
  if (alvo && init.method === 'PATCH') {
    const e = JSON.parse(init.body ?? '{}') as Partial<UsuarioConfig>;
    if (e.perfil && e.perfil !== 'administrador' && alvo.ultimo_admin_ativo) return erro(422, 'RN-CORE-01', MENSAGEM_ULTIMO_ADMIN);
    Object.assign(alvo, e);
    recalcular();
    return json(alvo);
  }
  if (alvo && sub === 'senha') {
    if (!chave || chavesUsadas.has(chave)) return erro(409, 'CONFLITO', 'Requisição já concluída');
    chavesUsadas.add(chave);
    return json({ usuario: alvo, senha_provisoria: SENHA });
  }
  if (alvo && (sub === 'inativar' || sub === 'excluir')) {
    if (alvo.ultimo_admin_ativo) return erro(422, 'RN-CORE-01', MENSAGEM_ULTIMO_ADMIN);
    if (sub === 'excluir') {
      lista = lista.filter((u) => u.id !== alvo.id);
      recalcular();
      return json({ id: alvo.id, situacao: 'excluido' });
    }
    alvo.situacao = 'inativo';
    recalcular();
    return json(alvo);
  }
  if (alvo && sub === 'reativar') {
    alvo.situacao = 'ativo';
    recalcular();
    return json(alvo);
  }
  return erro(404, 'NAO_ENCONTRADO', 'não encontrado');
}

beforeEach(() => {
  Object.assign(estado, { cookie: 'tok', apagados: [], redirecionou: [] });
  chamadas.length = 0;
  chavesUsadas.clear();
  lista = [novo(ADM, 'Ana Exemplo', 'administrador')];
  recalcular();
  process.env.MACUXIERP_API_URL = 'https://api.exemplo.invalid';
  vi.stubGlobal('fetch', async (url: string, init: never) => apiFalsa(url, init));
});
afterEach(() => vi.unstubAllGlobals());

describe('Usuários da Config: fluxo completo contra a API falsa (criar → senha → inativar → reativar → excluir)', () => {
  it('cada passo chama a rota certa, a senha provisória só vem na resposta e a lista segue as acoes da API', async () => {
    const log = vi.spyOn(console, 'log');
    const criado = await criarUsuarioAcao(EMP, { nome: 'Bruno Exemplo', email: ' bruno@exemplo.com ', perfil: 'faturista' }, 'k-criar');
    expect(criado).toMatchObject({ ok: true, valor: { senha_provisoria: SENHA, usuario: { nome: 'Bruno Exemplo' } } });
    const BRUNO = criado.ok ? criado.valor.usuario.id : '';
    expect(chamadas[0]).toMatchObject({ metodo: 'POST', caminho: `/empresas/${EMP}/usuarios`, chave: 'k-criar' });
    expect(JSON.parse(chamadas[0]!.corpo)).toEqual({ nome: 'Bruno Exemplo', email: 'bruno@exemplo.com', perfil: 'faturista', filial_ids: [] });

    const senha = await redefinirSenhaUsuarioAcao(EMP, BRUNO, 'k-senha');
    expect(senha).toMatchObject({ ok: true, valor: { senha_provisoria: SENHA } });
    expect(chamadas[1]).toMatchObject({ metodo: 'POST', caminho: `/empresas/${EMP}/usuarios/${BRUNO}/senha`, chave: 'k-senha' });

    const inativo = await inativarUsuarioAcao(EMP, BRUNO);
    expect(inativo).toMatchObject({ ok: true, valor: { situacao: 'inativo', acoes: ['editar', 'reativar', 'excluir'] } });
    const reativo = await reativarUsuarioAcao(EMP, BRUNO);
    expect(reativo).toMatchObject({ ok: true, valor: { situacao: 'ativo', acoes: ['editar', 'redefinir_senha', 'inativar', 'excluir'] } });
    const fora = await excluirUsuarioAcao(EMP, BRUNO);
    expect(fora).toEqual({ ok: true, valor: { id: BRUNO, situacao: 'excluido' } });
    expect(chamadas.slice(2).map((c) => [c.metodo, c.caminho.split('/').pop()])).toEqual([['POST', 'inativar'], ['POST', 'reativar'], ['POST', 'excluir']]);

    const final = await listarUsuarios('tok', EMP);
    expect(final.itens.map((u) => u.nome)).toEqual(['Ana Exemplo']);
    expect(final.itens[0]).toMatchObject({ ultimo_admin_ativo: true, acoes: ['editar', 'redefinir_senha'] });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('editar manda só o que mudou (corpo estrito); nome curto é recusado antes da API', async () => {
    const r = await editarUsuarioAcao(EMP, ADM, { nome: 'Ana Maria' });
    expect(r).toMatchObject({ ok: true, valor: { nome: 'Ana Maria' } });
    expect(chamadas[0]).toMatchObject({ metodo: 'PATCH', corpo: JSON.stringify({ nome: 'Ana Maria' }) });
    chamadas.length = 0;
    expect(await editarUsuarioAcao(EMP, ADM, { nome: 'A' })).toMatchObject({ ok: false, campos: { nome: 'Informe o nome, de 2 a 80 caracteres.' } });
    expect(await editarUsuarioAcao(EMP, ADM, {})).toMatchObject({ ok: false });
    expect(chamadas).toHaveLength(0);
  });

  it('RN-CORE-01: inativar, excluir ou rebaixar o último administrador volta 422 com a mensagem do contrato', async () => {
    for (const r of [await inativarUsuarioAcao(EMP, ADM), await excluirUsuarioAcao(EMP, ADM), await editarUsuarioAcao(EMP, ADM, { perfil: 'fiscal' })]) {
      expect(r).toMatchObject({ ok: false, erro: MENSAGEM_ULTIMO_ADMIN });
    }
  });

  it('409 de e-mail em uso → MENSAGEM_EMAIL_EM_USO; e-mail inválido → campo, sem chamar a API', async () => {
    const r = await criarUsuarioAcao(EMP, { nome: 'Ana Repetida', email: 'ana@exemplo.com', perfil: 'fiscal' }, 'k1');
    expect(r).toMatchObject({ ok: false, erro: MENSAGEM_EMAIL_EM_USO, chaveNova: true });
    chamadas.length = 0;
    expect(await criarUsuarioAcao(EMP, { nome: 'Ana', email: 'sem-arroba', perfil: 'fiscal' }, 'k2')).toMatchObject({ ok: false, campos: { email: 'E-mail inválido. Confira o endereço.' } });
    expect(chamadas).toHaveLength(0);
  });

  it('repetir a Idempotency-Key da senha dá 409 com mensagem própria e pede chave nova; a senha não aparece na resposta de erro', async () => {
    await redefinirSenhaUsuarioAcao(EMP, ADM, 'k-igual');
    const r = await redefinirSenhaUsuarioAcao(EMP, ADM, 'k-igual');
    expect(r).toMatchObject({ ok: false, erro: 'A senha já foi exibida. Redefina para gerar outra.', chaveNova: true });
    expect(JSON.stringify(r)).not.toContain(SENHA);
  });

  it('404: usuário fora da empresa (ou id inválido, sem chamar a API)', async () => {
    const r = await inativarUsuarioAcao(EMP, '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d');
    expect(r).toMatchObject({ ok: false, erro: 'Usuário não encontrado nesta empresa. Atualize a lista.' });
    chamadas.length = 0;
    expect(await excluirUsuarioAcao(EMP, '../../x')).toMatchObject({ ok: false });
    expect(chamadas).toHaveLength(0);
  });

  it('sem sessão do superadmin, vai ao login e não chama a API', async () => {
    estado.cookie = undefined;
    await expect(inativarUsuarioAcao(EMP, ADM)).rejects.toThrow('REDIRECT /login?destino=%2Fconfig');
    expect(chamadas).toHaveLength(0);
  });
});
