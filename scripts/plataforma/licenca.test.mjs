// Testes do script do operador da licença (D12). Rodar: node --test scripts/plataforma/licenca.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ErroUso } from './comum.mjs';
import { executar, fimDoDiaManaus, lerArgumentos, MODULOS, MODULOS_BASE, planejar } from './licenca.mjs';

const TENANT = { id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c', slug: 'thathyany', nome: 'Thathyany' };
const INSTANTE = new Date('2026-11-21T15:00:00Z');
const base = ['--empresa', 'thathyany', '--modulo', 'pedido', '--operador', 'alexandre', '--motivo', 'contrato assinado'];

/** Cliente pg falso: responde por trecho do SQL e grava a sequência. */
function clienteFalso(licencaAtual) {
  const sqls = [];
  return {
    sqls,
    async query(sql, params = []) {
      sqls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('from plataforma.tenant ')) return { rows: params[0] === TENANT.slug ? [TENANT] : [] };
      if (sql.includes('for update')) return { rows: licencaAtual ? [licencaAtual] : [] };
      if (sql.includes('insert into plataforma.tenant_modulo')) return { rows: [{ id: params[0] }] };
      if (sql.includes('order by modulo')) return { rows: [{ modulo: 'cadastros', ativo: true, valido_ate: null }] };
      return { rows: [] };
    },
  };
}

describe('licenca.mjs: argumentos', () => {
  it('exige empresa, módulo conhecido (não o core), operador e motivo', () => {
    assert.throws(() => lerArgumentos(['ligar']), ErroUso);
    assert.throws(() => lerArgumentos(['ativar', '--empresa', 'thathyany']), /--modulo/);
    assert.throws(() => lerArgumentos(['ativar', ...base.slice(0, 2), '--modulo', 'core', ...base.slice(4)]), /sempre licenciado/);
    assert.throws(() => lerArgumentos(['ativar', ...base.slice(0, 6)]), /--motivo/);
    assert.throws(() => lerArgumentos(['ativar', ...base, '--extra', 'x']), /desconhecida/);
    assert.throws(() => lerArgumentos(['desativar', ...base, '--ate', '2027-01-31']), /só vale para ativar/);
    assert.deepEqual(lerArgumentos(['listar', '--empresa', 'thathyany']), { comando: 'listar', confirmar: false, empresa: 'thathyany' });
  });

  it('--ate vale até o fim do dia em Manaus (UTC−4) e recusa data inexistente', () => {
    assert.equal(fimDoDiaManaus('2027-01-31').toISOString(), '2027-02-01T04:00:00.000Z');
    assert.throws(() => fimDoDiaManaus('2027-02-30'), /inválido/);
    assert.throws(() => fimDoDiaManaus('31/01/2027'), /inválido/);
    assert.equal(lerArgumentos(['ativar', ...base, '--ate', '2027-01-31', '--confirmar']).confirmar, true);
  });
});

describe('licenca.mjs: plano e execução', () => {
  it('planeja ativar, desativar (mantém o prazo) e "nada a mudar"', () => {
    const ativar = lerArgumentos(['ativar', ...base]);
    assert.deepEqual(planejar(undefined, ativar), { antes: null, depois: { ativo: true, valido_ate: null }, muda: true });
    assert.equal(planejar({ ativo: true, valido_ate: null }, ativar).muda, false);
    const desativar = lerArgumentos(['desativar', ...base]);
    assert.deepEqual(planejar({ ativo: true, valido_ate: '2027-02-01T04:00:00.000Z' }, desativar).depois, { ativo: false, valido_ate: '2027-02-01T04:00:00.000Z' });
  });

  it('com --confirmar grava a licença e a auditoria (operador e motivo) na transação do tenant e faz commit', async () => {
    const c = clienteFalso(undefined);
    const r = await executar(c, lerArgumentos(['ativar', ...base, '--confirmar']), INSTANTE);
    assert.equal(r.aplicado, true);
    const seq = c.sqls.map((s) => s.sql.split(' ').slice(0, 3).join(' '));
    assert.deepEqual(seq, ['begin', 'select id, slug,', "select set_config('app.tenant_id', $1,", 'select id, ativo,', 'insert into plataforma.tenant_modulo', 'insert into plataforma.auditoria', 'commit']);
    assert.deepEqual(c.sqls[2].params, [TENANT.id]);
    const auditoria = c.sqls[5];
    assert.equal(auditoria.params[1], TENANT.id);
    assert.deepEqual(JSON.parse(auditoria.params[4]), { ativo: true, valido_ate: null, modulo: 'pedido', operador: 'alexandre', motivo: 'contrato assinado' });
    assert.equal(auditoria.params[3], 'null');
    assert.match(auditoria.params[5], /^operador-/);
    assert.equal(auditoria.params[6], INSTANTE.toISOString());
  });

  it('sem --confirmar é simulação: faz rollback e diz que nada foi aplicado', async () => {
    const c = clienteFalso(undefined);
    const r = await executar(c, lerArgumentos(['ativar', ...base]), INSTANTE);
    assert.equal(r.aplicado, false);
    assert.equal(c.sqls.at(-1).sql, 'rollback');
  });

  it('nada a mudar não grava nem audita; empresa inexistente desfaz e explica', async () => {
    const c = clienteFalso({ id: 'x', ativo: true, valido_ate: null });
    const r = await executar(c, lerArgumentos(['ativar', ...base, '--confirmar']), INSTANTE);
    assert.equal(r.muda, false);
    assert.ok(!c.sqls.some((s) => s.sql.startsWith('insert')));
    const c2 = clienteFalso(undefined);
    await assert.rejects(executar(c2, lerArgumentos(['listar', '--empresa', 'nao-existe']), INSTANTE), /não encontrada/);
    assert.equal(c2.sqls.at(-1).sql, 'rollback');
  });

  it('listar só lê (rollback) e devolve as licenças do tenant', async () => {
    const c = clienteFalso(undefined);
    const r = await executar(c, lerArgumentos(['listar', '--empresa', 'thathyany']), INSTANTE);
    assert.deepEqual(r.licencas, [{ modulo: 'cadastros', ativo: true, valido_ate: null }]);
    assert.equal(c.sqls.at(-1).sql, 'rollback');
  });
});

describe('licenca.mjs: listas do platform-sdk (RD-1)', () => {
  /** Lê a lista literal `export const <nome> ... = [...]` do fonte TS do SDK. */
  const listaDoSdk = (arquivo, nome) => {
    const fonte = readFileSync(new URL(`../../packages/platform-sdk/src/${arquivo}`, import.meta.url), 'utf8');
    const m = new RegExp(`export const ${nome}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(fonte);
    assert.ok(m, `${nome} não encontrado em ${arquivo}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };

  it('MODULOS e MODULOS_BASE são iguais aos do SDK', () => {
    assert.deepEqual(MODULOS, listaDoSdk('modulo.ts', 'MODULOS'));
    assert.deepEqual(MODULOS_BASE, listaDoSdk('acesso.ts', 'MODULOS_BASE'));
  });
});
