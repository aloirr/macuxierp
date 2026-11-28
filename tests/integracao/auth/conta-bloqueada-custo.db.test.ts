/**
 * T-0111 (RN-CORE-15; RD-2288 e RD-2301): o login do tenant faz o MESMO número de conferências argon2 em todo caminho de
 * recusa (2, o `CONFERENCIAS_POR_RECUSA` do #732, conferido aqui pelo valor), para o tempo da resposta não revelar o estado
 * da conta. A matriz livre/travada × temporária fica no unitário do dono (apps/api/src/auth/apoio-login.test.ts); aqui,
 * pela rota: um 401 (livre com a temporária vigente, RD-2301), um 423 (travada com a temporária vencida, RD-2288) e o
 * e-mail inexistente, antes e depois da trava da memória.
 * Sem medir tempo: um espião em `conferirSenha` (apps/api/src/auth/senha.ts, repassando à função real) conta as
 * conferências de cada login. API de produção sobre o PostgreSQL efêmero. Dados fictícios. Sem Postgres
 * pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, ARGON2_RAPIDO, inserirAdministradorDeTeste } from '../../../apps/api/src/apoio-teste';
import * as senha from '../../../apps/api/src/auth/senha';
import { type AppPortal } from '../../apoio/portal-pg';

vi.mock('../../../apps/api/src/auth/senha', async (original) => {
  const real = await original<typeof import('../../../apps/api/src/auth/senha')>();
  return { ...real, conferirSenha: vi.fn(real.conferirSenha) };
});
const conferencias = () => vi.mocked(senha.conferirSenha).mock.calls.length;

const SLUG = 'tq0111c';
const DOMINIO = 'loja-t0111c.invalid';
const EMAILS = { livreVigente: `livre.vigente@${DOMINIO}`, travadaVencida: `travada.vencida@${DOMINIO}` };
/** Conferências argon2 de toda recusa (decisão do #732, d1603ac): literal, não importado da API. */
const POR_RECUSA = 2;
const SENHA_ERRADA = 'senha-errada-t0111c!';
const TEMPORARIA = 'Tq7#temporaria-ficticia';

describe.skipIf(!PG_DISPONIVEL)('T-0111 (RD-2288, RD-2301): o mesmo custo argon2 em toda recusa do login do tenant', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let ip = 1;
  const entrar = (email: string, s = SENHA_ERRADA) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: `10.111.9.${ip++}`, payload: { email, senha: s } });
  /** Conferências argon2 de um login. */
  const custo = async (email: string) => {
    const antes = conferencias();
    const r = await entrar(email);
    return { status: r.statusCode, conferencias: conferencias() - antes };
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const t = await criarTenant(b.admin, SLUG, ['cadastros']);
    for (const email of Object.values(EMAILS)) await inserirAdministradorDeTeste(b.admin, t, { id: randomUUID(), email, nome: 'Pessoa Ficticia', filialIds: [] });
    const hashTemp = await senha.gerarHashSenha(TEMPORARIA, ARGON2_RAPIDO);
    await b.admin.query(
      "UPDATE plataforma.usuario SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes', senha_temporaria_hash = $2, senha_temporaria_expira_em = now() - interval '1 hour' WHERE email = $1",
      [EMAILS.travadaVencida, hashTemp],
    );
    await b.admin.query("UPDATE plataforma.usuario SET senha_temporaria_hash = $2, senha_temporaria_expira_em = now() + interval '72 hours' WHERE email = $1", [EMAILS.livreVigente, hashTemp]);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao' }));
    expect(vi.isMockFunction(senha.conferirSenha)).toBe(true);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });
  it('senha errada na conta livre com a temporária vigente = 401 com as mesmas conferências (RD-2301)', async () => {
    expect(await custo(EMAILS.livreVigente)).toEqual({ status: 401, conferencias: POR_RECUSA });
  });

  it('conta travada com a temporária VENCIDA = 423 com as mesmas conferências (RD-2288)', async () => {
    expect(await custo(EMAILS.travadaVencida)).toEqual({ status: 423, conferencias: POR_RECUSA });
  });

  it('e-mail inexistente: 401 e, travado pela memória, 423, os dois com as mesmas conferências', async () => {
    const ninguem = `ninguem@${DOMINIO}`;
    expect(await custo(ninguem)).toEqual({ status: 401, conferencias: POR_RECUSA });
    for (let i = 1; i < 5; i++) expect((await entrar(ninguem)).statusCode).toBe(401);
    expect(await custo(ninguem)).toEqual({ status: 423, conferencias: POR_RECUSA });
  });
});
