/**
 * Troca obrigatória da senha provisória no tenant (T-0052, RN-CORE-10) no PostgreSQL migrado (0036), com os adaptadores
 * de produção no papel `macuxierp_app` (RLS valendo): `deve_trocar_senha` no login e no `/eu`, o 403 `TROCAR_SENHA` nas
 * rotas de módulo e o `POST /v1/auth/senha` (204; senha atual errada é 400; nova igual e fora da regra ficam no app.test.ts).
 */
import { randomUUID } from 'node:crypto';
import { CODIGO_TROCAR_SENHA } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COOKIE_REFRESH } from './app';
import { appPgDeTeste, ARGON2_RAPIDO, inserirAdministradorDeTeste, SENHA_DE_TESTE } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';
import { MENSAGEM_TROCAR_SENHA } from './auth/troca-senha';

describe.skipIf(!PG_DISPONIVEL)('T-0052: senha provisória do usuário do tenant no PostgreSQL (0036)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let tenant: string;
  const usuario = randomUUID();
  const SENHA_NOVA = 'Nova-senha-789';

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, 'loja-senha', ['cadastros']);
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: 'adm@loja-senha.teste', nome: 'Administradora', filialIds: [] });
    ({ app } = await appPgDeTeste({ b }));
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });
  // cada teste começa com a senha provisória ligada, a SENHA_DE_TESTE e sem sessões abertas
  beforeEach(async () => {
    await b.admin.query('UPDATE plataforma.usuario SET deve_trocar_senha = true, senha_hash = $2, falhas_login = 0, bloqueado_ate = NULL WHERE id = $1', [
      usuario,
      await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO),
    ]);
    await b.admin.query('UPDATE plataforma.sessao SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [usuario]);
  });

  const entrar = async (senha = SENHA_DE_TESTE) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'loja-senha', email: 'adm@loja-senha.teste', senha } });
    expect(r.statusCode).toBe(200);
    return { token: r.json<{ token_acesso: string }>().token_acesso, refresh: r.cookies.find((c) => c.name === COOKIE_REFRESH)!.value };
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const refresh = (r: string) => app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { [COOKIE_REFRESH]: r } });
  const trocar = (s: { token: string; refresh: string }, corpo: object) =>
    app.inject({ method: 'POST', url: '/v1/auth/senha', headers: bearer(s.token), cookies: { [COOKIE_REFRESH]: s.refresh }, payload: corpo });
  const linhaUsuario = async () =>
    (await b.admin.query<{ deve_trocar_senha: boolean; falhas_login: number }>('SELECT deve_trocar_senha, falhas_login FROM plataforma.usuario WHERE id = $1', [usuario])).rows[0]!;

  it('login com a flag: /eu mostra deve_trocar_senha e uma rota de módulo responde 403 TROCAR_SENHA', async () => {
    const s = await entrar();
    const eu = await app.inject({ url: '/v1/auth/eu', headers: bearer(s.token) });
    expect(eu.statusCode).toBe(200);
    expect(eu.json().usuario).toEqual({ id: usuario, nome: 'Administradora', perfil: 'administrador', deve_trocar_senha: true });
    const modulo = await app.inject({ url: '/v1/core/empresa', headers: bearer(s.token) });
    expect(modulo.statusCode).toBe(403);
    expect(modulo.json()).toEqual({ codigo: CODIGO_TROCAR_SENHA, mensagem: MENSAGEM_TROCAR_SENHA });
  });

  it('troca certa: 204, flag zerada, a outra sessão revogada e a corrente segue (refresh sem a flag); auditoria só com ids', async () => {
    const corrente = await entrar();
    const outra = await entrar();
    const r = await trocar(corrente, { senha_atual: SENHA_DE_TESTE, senha_nova: SENHA_NOVA });
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect((await linhaUsuario()).deve_trocar_senha).toBe(false);

    expect((await refresh(outra.refresh)).statusCode).toBe(401);
    const renovado = await refresh(corrente.refresh);
    expect(renovado.statusCode).toBe(200);
    const token = renovado.json<{ token_acesso: string }>().token_acesso;
    expect((await app.inject({ url: '/v1/auth/eu', headers: bearer(token) })).json().usuario.deve_trocar_senha).toBe(false);
    const modulo = await app.inject({ url: '/v1/core/empresa', headers: bearer(token) });
    expect(modulo.statusCode).not.toBe(403);

    // a senha nova vale no login; a antiga não
    await entrar(SENHA_NOVA);
    const antiga = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'loja-senha', email: 'adm@loja-senha.teste', senha: SENHA_DE_TESTE } });
    expect(antiga.statusCode).toBe(401);

    const { rows } = await b.admin.query<{ usuario_id: string; entidade: string; entidade_id: string; antes: unknown; depois: unknown }>(
      `SELECT usuario_id, entidade, entidade_id, antes, depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'core.usuario.senha_trocada'`,
      [tenant],
    );
    expect(rows).toEqual([{ usuario_id: usuario, entidade: 'usuario', entidade_id: usuario, antes: null, depois: { sessoes_revogadas: 1 } }]);
    expect(JSON.stringify(rows)).not.toMatch(/argon2|Nova-senha|senha-de-teste|@loja-senha/);
  });

  it('senha atual errada: 400 em senha_atual, sem contar falha de login; nada muda', async () => {
    const s = await entrar();
    for (let i = 0; i < 6; i++) {
      const r = await trocar(s, { senha_atual: 'errada-123!', senha_nova: SENHA_NOVA });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toEqual({ codigo: 'VALIDACAO', mensagem: 'Dados inválidos', campos: { senha_atual: 'Senha atual incorreta. Confira e digite de novo.' } });
    }
    expect(await linhaUsuario()).toEqual({ deve_trocar_senha: true, falhas_login: 0 });
    await entrar();
  });
});
