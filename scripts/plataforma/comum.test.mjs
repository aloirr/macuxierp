// Testes das partes comuns dos scripts do operador. Rodar: node --test scripts/plataforma/comum.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { abrirTenant, conectarOperador, ErroUso, lerOpcoes, PADRAO_OPERADOR, PADRAO_SLUG } from './comum.mjs';

const TENANT = { id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c', slug: 'thathyany', nome: 'Thathyany Distribuidora' };

describe('comum.mjs', () => {
  it('PADRAO_SLUG é a mesma regex do CHECK do slug em db/migrations/0002_plataforma.sql', () => {
    const sql = readFileSync(new URL('../../db/migrations/0002_plataforma.sql', import.meta.url), 'utf8');
    const m = /slug text NOT NULL UNIQUE CHECK \(slug ~ '([^']+)'\)/.exec(sql);
    assert.ok(m, 'CHECK do slug não encontrado em 0002_plataforma.sql');
    assert.equal(PADRAO_SLUG.source, m[1]);
    assert.ok(PADRAO_SLUG.test('a'.repeat(40)));
    assert.ok(!PADRAO_SLUG.test('a'.repeat(41)));
    assert.ok(PADRAO_OPERADOR.test('alexandre') && !PADRAO_OPERADOR.test('Alexandre'));
  });

  it('lerOpcoes aceita só as opções da lista, exige valor e põe a chave em camelCase', () => {
    assert.deepEqual(lerOpcoes(['--empresa', 'thathyany', '--arquivo-recado', '/tmp/r.md', '--confirmar'], ['--empresa', '--arquivo-recado']), {
      confirmar: true,
      empresa: 'thathyany',
      arquivoRecado: '/tmp/r.md',
    });
    assert.deepEqual(lerOpcoes([], ['--empresa']), { confirmar: false });
    assert.throws(() => lerOpcoes(['--extra', 'x'], ['--empresa']), (e) => e instanceof ErroUso && /desconhecida: --extra/.test(e.message));
    assert.throws(() => lerOpcoes(['--empresa'], ['--empresa']), /--empresa exige um valor/);
    assert.throws(() => lerOpcoes(['--empresa', '--confirmar'], ['--empresa']), /--empresa exige um valor/);
  });

  it('abrirTenant lê plataforma.tenant (não a tenant_por_slug, que devolve só o uuid) e liga a RLS do tenant', async () => {
    const sqls = [];
    const cliente = {
      async query(sql, params = []) {
        sqls.push({ sql, params });
        return { rows: sql.includes('from plataforma.tenant ') && params[0] === TENANT.slug ? [TENANT] : [] };
      },
    };
    assert.deepEqual(await abrirTenant(cliente, 'thathyany'), TENANT);
    assert.match(sqls[0].sql, /^select id, slug, nome from plataforma\.tenant where slug = \$1 and situacao = 'ativo' and deleted_at is null$/);
    assert.ok(!sqls.some((s) => s.sql.includes('tenant_por_slug')));
    assert.deepEqual(sqls[1], { sql: "select set_config('app.tenant_id', $1, true)", params: [TENANT.id] });
    sqls.length = 0;
    await assert.rejects(abrirTenant(cliente, 'nao-existe'), (e) => e instanceof ErroUso && /empresa não encontrada: nao-existe/.test(e.message));
    assert.equal(sqls.length, 1, 'sem tenant, não chama o set_config');
  });

  it('conectarOperador sem MACUXIERP_DATABASE_URL_OPERADOR dá ErroUso, sem tentar conectar', async () => {
    await assert.rejects(conectarOperador({}), (e) => e instanceof ErroUso && /MACUXIERP_DATABASE_URL_OPERADOR/.test(e.message));
  });
});
