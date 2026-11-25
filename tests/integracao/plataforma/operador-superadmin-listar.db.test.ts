/**
 * T-0103 (plano da v0.3.13, O-1 e O-2): `operador.sh superadmin --listar` DE VERDADE, com o `docker` falso
 * (tests/apoio/operador-falso.ts) que roda o superadmin.mjs contra o PostgreSQL efêmero e um `psql` de passagem que
 * guarda o SQL, o argv e o ambiente. O formato da linha e o SQL com o psql falso ficam no
 * scripts/deploy/superadmin-listar.test.mjs (dono); aqui entram a costura operador.sh → superadmin.mjs → banco:
 * - O-1: cada superadmin vivo numa linha, com o e-mail mascarado pela `plataforma.mascarar_email` do próprio banco, a
 *   situação (ativo ou desativado) e o último acesso em Manaus ("nunca" sem acesso); o excluído fica de fora; nenhum
 *   e-mail inteiro nem a parte local na saída, no argv nem no ambiente do psql;
 * - O-2: nenhuma linha de plataforma.superadmin muda (a única escrita do SQL é o INSERT em plataforma.auditoria); a
 *   auditoria `plataforma.superadmin.listar` (#638, decisão do gerente sobre R-20261124-233002) é exatamente 1 registro
 *   por chamada, com o operador, a contagem igual às linhas listadas e o request_id, sem e-mail nem parte de um; sem
 *   --operador, com --email ou com --confirmar, recusa sem chamar o banco; sem superadmin, "0 superadmin(s)" e saída 0.
 * Dados fictícios (exemplo.invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { envPsqlAdmin } from '../../../apps/api/src/apoio-operador-teste';
import { criarPsqlPassagem, rodarOperador, type VmOperador } from '../../apoio/operador-falso';
import { inserirSuperadmin } from '../../apoio/portal-pg';

const OPERADOR_SH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'deploy', 'producao', 'operador.sh');
const ATIVO = 'helena.listar.t0103@exemplo.invalid';
const DESATIVADO = 'otavio.listar.t0103@exemplo.invalid';
const TRAVADO = 'yara.listar.t0103@exemplo.invalid';
const EXCLUIDO = 'excluido.listar.t0103@exemplo.invalid';
const VIVOS = [ATIVO, DESATIVADO, TRAVADO];
/** 24/11/2026 22:40 em Manaus (UTC−4). */
const ULTIMO_ACESSO_UTC = '2026-11-25T02:40:00Z';

describe.skipIf(!PG_DISPONIVEL)('operador.sh superadmin --listar no PostgreSQL (T-0103, O-1 e O-2)', () => {
  let b: BancoEfemero;
  let pasta = '';
  let vm: VmOperador;
  const saidas: string[] = [];

  beforeAll(async () => {
    pasta = mkdtempSync(join(tmpdir(), 'macuxierp-t0103-listar-'));
    vm = criarPsqlPassagem(pasta);
    b = await criarBancoEfemero();
    for (const e of [...VIVOS, EXCLUIDO]) await inserirSuperadmin(b, e);
    await b.admin.query('UPDATE plataforma.superadmin SET ultimo_acesso_em = $2 WHERE email = $1', [ATIVO, ULTIMO_ACESSO_UTC]);
    await b.admin.query('UPDATE plataforma.superadmin SET ativo = false WHERE email = $1', [DESATIVADO]);
    // hora-fixa-ok: trava e exclusão relativas ao relógio do banco, nunca comparadas com o instante fixo do último acesso
    await b.admin.query("UPDATE plataforma.superadmin SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes' WHERE email = $1", [TRAVADO]);
    // hora-fixa-ok: só marca excluído, nunca comparado com o instante fixo
    await b.admin.query('UPDATE plataforma.superadmin SET deleted_at = now() WHERE email = $1', [EXCLUIDO]);
  }, 180_000);
  afterAll(async () => {
    await b?.remover();
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  /** Roda o operador.sh como na VM; devolve status, saída, o SQL e o argv/ambiente que chegaram ao psql nesta chamada. */
  function operador(args: string[]) {
    const r = rodarOperador(vm, OPERADOR_SH, args, envPsqlAdmin(b.nome));
    saidas.push(r.saida);
    return { ...r, psql: `${r.psql.argv}\n${r.psql.ambiente}` };
  }
  const listar = (extra: string[] = ['--operador', 'alexandre']) => operador(['superadmin', '--listar', ...extra]);
  const tabela = async () => (await b.admin.query('SELECT * FROM plataforma.superadmin ORDER BY id')).rows;
  const mascarado = async (email: string) => (await b.admin.query<{ m: string }>('SELECT plataforma.mascarar_email($1) AS m', [email])).rows[0]!.m;
  /** A linha da saída do superadmin com o e-mail mascarado dado. */
  const linhaDe = (saida: string, m: string) => saida.split('\n').filter((l) => l.includes(`e-mail (mascarado): ${m} `));

  it('O-1: um superadmin vivo por linha, com o e-mail mascarado pelo banco, a situação e o último acesso em Manaus; o excluído fica de fora', async () => {
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.saida).toContain('3 superadmin(s)');
    expect(r.saida.trim().split('\n').at(-1)).toBe('estado: lista');
    const esperado: Record<string, RegExp> = {
      [ATIVO]: /situação: ativo · .*último acesso \(Manaus\): 24\/11\/2026 22:40$/,
      [DESATIVADO]: /situação: desativado · .*último acesso \(Manaus\): nunca$/,
      [TRAVADO]: /situação: ativo · .*travado: sim · falhas: 5 · .*último acesso \(Manaus\): nunca$/,
    };
    const mascaras = await Promise.all(VIVOS.map(mascarado));
    expect(new Set(mascaras).size).toBe(VIVOS.length);
    for (const [i, email] of VIVOS.entries()) {
      const m = mascaras[i]!;
      expect(m).not.toBe(email);
      expect(m).toContain('*');
      const l = linhaDe(r.saida, m);
      expect(l, `linha de ${m}`).toHaveLength(1);
      expect(l[0]!.trim()).toMatch(esperado[email]!);
    }
    expect(r.saida).not.toContain(await mascarado(EXCLUIDO));
  });

  it('O-1 (regra 8): nenhum e-mail inteiro nem a parte local na saída, no SQL, no argv nem no ambiente do psql', () => {
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.sql).not.toBe('');
    for (const email of [...VIVOS, EXCLUIDO]) {
      const local = email.split('@')[0]!;
      for (const texto of [r.saida, r.sql, r.psql, ...saidas]) {
        expect(texto.toLowerCase()).not.toContain(email);
        expect(texto.toLowerCase()).not.toContain(local);
      }
    }
    expect(r.psql).not.toMatch(/MACUXIERP_SUPERADMIN_EMAIL=/);
  });

  it('O-2: nenhuma coluna de plataforma.superadmin muda; a única escrita do SQL é o INSERT em plataforma.auditoria', async () => {
    const antes = await tabela();
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|MERGE)\b/i);
    expect([...r.sql.matchAll(/\bINSERT\s+INTO\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(['plataforma.auditoria']);
    expect(await tabela()).toEqual(antes);
  });

  it('O-2: auditoria do --listar: exatamente 1 registro novo, com o operador, a contagem das linhas listadas e o request_id, sem e-mail', async () => {
    const OPERADOR = 'operador.t0103';
    const auditados = async () =>
      (await b.admin.query("SELECT * FROM plataforma.auditoria WHERE acao = 'plataforma.superadmin.listar' ORDER BY created_at, id")).rows;
    const antes = await auditados();
    const r = listar(['--operador', OPERADOR]);
    expect(r.status).toBe(0);
    const listadas = r.saida.split('\n').filter((l) => l.includes('e-mail (mascarado): ')).length;
    expect(listadas).toBe(VIVOS.length);
    const depois = await auditados();
    expect(depois).toHaveLength(antes.length + 1);
    const novo = depois.find((d) => !antes.some((a) => a.id === d.id))!;
    expect(novo).toMatchObject({ acao: 'plataforma.superadmin.listar', entidade: 'superadmin', entidade_id: null, antes: null, usuario_id: null });
    expect(novo.depois).toEqual({ quantidade: listadas, operador: OPERADOR, motivo: 'operador.sh' });
    expect(novo.request_id).toMatch(/^operador-[0-9a-f-]{36}$/);
    // Regra 8: nenhum campo do registro com e-mail, parte local, domínio ou máscara da massa.
    const texto = JSON.stringify(novo).toLowerCase();
    expect(texto).not.toContain('@');
    expect(texto).not.toContain('exemplo.invalid');
    for (const email of [...VIVOS, EXCLUIDO]) {
      expect(texto).not.toContain(email.split('@')[0]!);
      expect(texto).not.toContain((await mascarado(email)).toLowerCase());
    }
  });

  it('O-2: sem --operador, com --email ou com --confirmar, recusa sem chamar o banco', () => {
    for (const extra of [[], ['--operador', 'alexandre', '--email', ATIVO], ['--operador', 'alexandre', '--confirmar'], ['--operador', 'X maiúsculo']]) {
      const r = listar(extra);
      expect(r.status, JSON.stringify(extra)).not.toBe(0);
      expect(r.sql, JSON.stringify(extra)).toBe('');
      expect(r.saida).not.toContain('estado: lista');
    }
  });

  it('O-2: sem superadmin vivo, "0 superadmin(s)" e saída 0', async () => {
    // hora-fixa-ok: só marca excluído, nunca comparado com o instante fixo
    await b.admin.query('UPDATE plataforma.superadmin SET deleted_at = now() WHERE deleted_at IS NULL');
    const r = listar();
    expect(r.status).toBe(0);
    expect(r.saida).toContain(': 0 superadmin(s).');
    expect(r.saida.trim().split('\n').at(-1)).toBe('estado: lista');
  });
});
