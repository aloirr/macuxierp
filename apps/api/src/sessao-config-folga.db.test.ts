/**
 * v0.3.26 no PostgreSQL migrado, com a `superadmin_abrir_sessao` real (0033, teto `now() + 8 h` → 23514): o login do
 * superadmin com o relógio do app adiantado 30 s em relação ao banco sai 200 com o cookie (antes, 422 REGRA_PLATAFORMA
 * intermitente em produção, 27/11/2026); sem a folga, a mesma validade estoura o teto.
 */
import { CABECALHO_CSRF_CONFIG, COOKIE_CONFIG, VALIDADE_SESSAO_CONFIG_MS } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO, SENHA_DE_TESTE } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';
import { FOLGA_RELOGIO_SESSAO_MS } from './plataforma/servico';

const ADIANTADO_MS = 30_000;
const EMAIL_SA = 'sa-folga-relogio@exemplo.invalid';

describe.skipIf(!PG_DISPONIVEL)('sessão do /config com folga de relógio (v0.3.26, PostgreSQL)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let saId: string;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const r = await b.admin.query<{ id: string }>(
      `INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true) RETURNING id`,
      [EMAIL_SA, await gerarHashSenha(SENHA_DE_TESTE, ARGON2_RAPIDO)],
    );
    saId = r.rows[0]!.id;
    // Relógio da VM adiantado em relação ao banco (o caso de produção)
    ({ app } = await appPgDeTeste({ b, relogio: { agora: () => new Date(Date.now() + ADIANTADO_MS) } }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('login do superadmin com o relógio do app adiantado 30 s: 200 com o cookie, não 422', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { [CABECALHO_CSRF_CONFIG]: '1', 'cf-connecting-ip': '10.3.0.1' },
      payload: { empresa: 'MACUXI', email: EMAIL_SA, senha: SENHA_DE_TESTE },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ destino: 'config', expira_em: expect.any(String) });
    expect(r.cookies.map((c) => c.name)).toContain(COOKIE_CONFIG);
    const s = await b.admin.query<{ dentro: boolean }>(
      `SELECT expira_em <= now() + interval '8 hours' AS dentro FROM plataforma.sessao_superadmin WHERE superadmin_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [saId],
    );
    expect(s.rows[0]?.dentro).toBe(true);
  });

  it('sem a folga, a validade do app adiantado (now() + 8 h + 30 s) e a de 1 s acima do teto dão 23514 na função real', async () => {
    expect(FOLGA_RELOGIO_SESSAO_MS).toBeGreaterThan(ADIANTADO_MS);
    expect(VALIDADE_SESSAO_CONFIG_MS).toBe(8 * 3600_000);
    const abrir = (validade: string) =>
      b.admin.query(`SELECT plataforma.superadmin_abrir_sessao($1::uuid, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now() + $2::interval)`, [saId, validade]);
    for (const acima of ['8 hours 1 second', '8 hours 30 seconds']) await expect(abrir(acima)).rejects.toMatchObject({ code: '23514' });
    // Com a folga: 8 h − 1 min + os 30 s de adianto cabe no teto
    await expect(abrir('7 hours 59 minutes 30 seconds')).resolves.toBeDefined();
  });
});
