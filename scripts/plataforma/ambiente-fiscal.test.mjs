// Testes do script do operador do ambiente fiscal (RN-CORE-08, ADR 0006, desenho T-0030 seção 4).
// Rodar: node --test scripts/plataforma/ambiente-fiscal.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { conferirRecado, executar, lerArgumentos, normalizar, PADRAO_RECADO, planejar } from './ambiente-fiscal.mjs';
import { ErroUso } from './comum.mjs';

const TENANT = { id: '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c', slug: 'thathyany', nome: 'Thathyany Distribuidora' };
const OUTRO_TENANT = { id: '1e7c7b5f-4d2a-4c9f-8e3b-6a8f9dab2c3d', slug: 'thathyany-manaus', nome: 'Thathyany Manaus Ltda' };
const ATIVOS = [TENANT, OUTRO_TENANT];
const FILIAL = 'a3f1c2d4-5b6e-4f70-8a9b-0c1d2e3f4a5b';
const OUTRA_FILIAL = 'b4e2d3c5-6c7f-4a81-9bac-1d2e3f4a5b6c';
const RECADO = 'R-20261121-153000-alexandre';
const INSTANTE = new Date('2026-11-21T15:00:00Z');

const recadoTexto = ({ id = RECADO, de = 'alexandre', corpo = 'Aprovo produção fiscal Thathyany.' } = {}) =>
  `---\nid: ${id}\nde: ${de}\npara: [gerente-projetos]\ncc: []\ntipo: aviso\nprioridade: normal\ntarefa: T-0030\n---\n# Produção fiscal\n\n${corpo}\n`;

const argsProducao = ['--empresa', 'thathyany', '--filial', FILIAL, '--recado', RECADO, '--arquivo-recado', `/tmp/${RECADO}.md`, '--operador', 'alexandre'];
const argsHomologacao = ['--empresa', 'thathyany', '--filial', FILIAL, '--operador', 'alexandre', '--motivo', 'teste de rejeição'];

/** Cliente pg falso: responde por trecho do SQL e grava a sequência. */
function clienteFalso({ atual, filiais = [FILIAL], certificado = { valido_ate: '2027-06-30T00:00:00Z' } } = {}) {
  const sqls = [];
  return {
    sqls,
    async query(sql, params = []) {
      sqls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('from plataforma.tenant where slug')) return { rows: params[0] === TENANT.slug ? [TENANT] : [] };
      if (sql.includes('from plataforma.tenant ')) return { rows: ATIVOS };
      if (sql.includes('left join core.ambiente_fiscal')) return { rows: [{ filial_id: FILIAL, nome: 'Matriz', ambiente: 'homologacao', recado_aprovacao: null }] };
      if (sql.includes('from cadastros.filial_resumo')) return { rows: params[0] === TENANT.id && filiais.includes(params[1]) ? [{ id: params[1], nome: 'Matriz' }] : [] };
      if (sql.includes('from core.certificado')) return { rows: certificado ? [certificado] : [] };
      if (sql.includes('for update')) return { rows: atual ? [atual] : [] };
      return { rows: [] };
    },
  };
}

const opProducao = (extra = []) => ({ ...lerArgumentos(['producao', ...argsProducao, ...extra]), textoRecado: recadoTexto() });
const inicio = (s) => s.sql.split(' ').slice(0, 3).join(' ');

describe('ambiente-fiscal.mjs: argumentos (RN-CORE-08)', () => {
  it('exige comando, empresa, filial UUID e operador', () => {
    assert.throws(() => lerArgumentos(['ligar']), ErroUso);
    assert.throws(() => lerArgumentos(['producao']), /--empresa/);
    assert.throws(() => lerArgumentos(['producao', '--empresa', 'Thathyany SA']), /--empresa/);
    assert.throws(() => lerArgumentos(['producao', '--empresa', 'thathyany', '--filial', '123']), /--filial/);
    assert.throws(() => lerArgumentos(['homologacao', '--empresa', 'thathyany', '--filial', FILIAL, '--motivo', 'teste de rejeição']), /--operador/);
    assert.throws(() => lerArgumentos(['producao', ...argsProducao, '--extra', 'x']), /desconhecida/);
    assert.throws(() => lerArgumentos(['producao', ...argsProducao.slice(0, -1)]), /exige um valor/);
    assert.deepEqual(lerArgumentos(['listar', '--empresa', 'thathyany']), { comando: 'listar', confirmar: false, empresa: 'thathyany' });
  });

  it('produção exige o id do recado do Alexandre (regex do CHECK) e o arquivo; o motivo é opcional', () => {
    const sem = (chave) => {
      const i = argsProducao.indexOf(chave);
      return [...argsProducao.slice(0, i), ...argsProducao.slice(i + 2)];
    };
    assert.throws(() => lerArgumentos(['producao', ...sem('--recado')]), /--recado/);
    assert.throws(() => lerArgumentos(['producao', ...sem('--arquivo-recado')]), /--arquivo-recado/);
    for (const id of ['R-20261121-153000-gerente-projetos', 'R-2026112-153000-alexandre', 'R-20261121-153000-alexandre-x', 'aprovo']) {
      const args = argsProducao.map((a) => (a === RECADO ? id : a));
      assert.throws(() => lerArgumentos(['producao', ...args]), /--recado/, id);
    }
    const op = lerArgumentos(['producao', ...argsProducao.map((a) => (a === RECADO ? 'R-20261121-153000-2-alexandre' : a)), '--confirmar']);
    assert.equal(op.recado, 'R-20261121-153000-2-alexandre');
    assert.equal(op.arquivoRecado, `/tmp/${RECADO}.md`);
    assert.equal(op.confirmar, true);
  });

  it('homologação exige motivo com 5 caracteres ou mais e não aceita recado', () => {
    assert.throws(() => lerArgumentos(['homologacao', ...argsHomologacao.slice(0, -2)]), /--motivo/);
    assert.throws(() => lerArgumentos(['homologacao', ...argsHomologacao.slice(0, -1), ' abc ']), /--motivo/);
    assert.throws(() => lerArgumentos(['homologacao', ...argsHomologacao, '--recado', RECADO]), /só vale(m)? para producao/);
    assert.equal(lerArgumentos(['homologacao', ...argsHomologacao]).motivo, 'teste de rejeição');
  });

  it('a regex do id é a mesma do CHECK ambiente_producao_aprovada de db/migrations/0003_core.sql', () => {
    const sql = readFileSync(new URL('../../db/migrations/0003_core.sql', import.meta.url), 'utf8');
    const m = /CONSTRAINT ambiente_producao_aprovada CHECK \([\s\S]*?recado_aprovacao ~ '([^']+)'/.exec(sql);
    assert.ok(m, 'CHECK ambiente_producao_aprovada não encontrado em 0003_core.sql');
    assert.equal(PADRAO_RECADO.source, m[1].replaceAll('[0-9]', '\\d'));
  });
});

describe('ambiente-fiscal.mjs: conferirRecado (RN-CORE-08)', () => {
  const op = { comando: 'producao', recado: RECADO };
  const nome = `${RECADO}.md`;

  it('aceita o recado do Alexandre pelo nome ou pelo slug, com ou sem acento e maiúsculas, e devolve o SHA-256', () => {
    const texto = recadoTexto();
    assert.deepEqual(conferirRecado(texto, `/baixados/${nome}`, op, TENANT), { recado_sha256: createHash('sha256').update(texto).digest('hex') });
    assert.ok(conferirRecado(recadoTexto({ corpo: 'aprovo   PRODUCAO fiscal   thathyany' }), nome, op, TENANT));
    assert.ok(conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal Thathyany Distribuidora, pode seguir.' }), nome, op, TENANT));
    assert.ok(conferirRecado(recadoTexto({ corpo: 'APROVO PRODUÇÃO FISCAL THATHYANY' }), nome, op, TENANT));
    assert.equal(normalizar('  Produção\n  FISCAL  '), 'producao fiscal');
  });

  it('recusa autor diferente de alexandre, id do cabeçalho diferente e nome de arquivo diferente', () => {
    assert.throws(() => conferirRecado(recadoTexto({ de: 'gerente-projetos' }), nome, op, TENANT), /de: alexandre/);
    assert.throws(() => conferirRecado(recadoTexto({ id: 'R-20261121-153001-alexandre' }), nome, op, TENANT), /id/);
    assert.throws(() => conferirRecado(recadoTexto(), 'R-20261121-153001-alexandre.md', op, TENANT), /arquivo/);
    assert.throws(() => conferirRecado('Aprovo produção fiscal Thathyany.', nome, op, TENANT), /cabeçalho/);
  });

  it('recusa texto sem "aprovo produção fiscal" e aprovação de outra empresa (nem prefixo do nome)', () => {
    assert.throws(() => conferirRecado(recadoTexto({ corpo: 'Pode subir a Thathyany para produção.' }), nome, op, TENANT), /aprovo produção fiscal/);
    assert.throws(() => conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal Acme.' }), nome, op, TENANT), /o recado não aprova thathyany$/);
    assert.throws(() => conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal thathyanyx' }), nome, op, TENANT), /não aprova thathyany/);
    assert.throws(() => conferirRecado(recadoTexto({ corpo: 'Não aprovo produção fiscal Thathyany.' }), nome, op, TENANT), /negação/);
  });

  it('confere contra todos os tenants ativos: só aceita se o casamento mais longo for deste tenant', () => {
    const recusa = (corpo) =>
      assert.throws(
        () => conferirRecado(recadoTexto({ corpo }), nome, op, TENANT, ATIVOS),
        (e) => e instanceof ErroUso && e.message === 'o recado não aprova thathyany',
        corpo,
      );
    recusa('Aprovo produção fiscal thathyany-manaus');
    recusa('Aprovo produção fiscal Thathyany Manaus Ltda.');
    recusa('Aprovo produção fiscal THATHYANY MANAUS LTDA, pode seguir');
    assert.ok(conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal Thathyany Manaus.' }), nome, op, TENANT, ATIVOS));
    assert.ok(conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal thathyany.' }), nome, op, TENANT, ATIVOS));
    assert.ok(conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal Thathyany Manaus Ltda.' }), nome, op, OUTRO_TENANT, ATIVOS));
    assert.ok(conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal thathyany-manaus' }), nome, op, OUTRO_TENANT, ATIVOS));
  });

  it('a mensagem de recusa não cita o texto do recado', () => {
    assert.throws(
      () => conferirRecado(recadoTexto({ corpo: 'Aprovo produção fiscal Segredo Comercial SA' }), nome, op, TENANT, ATIVOS),
      (e) => e.message === 'o recado não aprova thathyany' && !/segredo/i.test(e.message),
    );
  });
});

describe('ambiente-fiscal.mjs: plano e execução (RN-CORE-08)', () => {
  it('planeja ida, volta e "nada a mudar"', () => {
    const prod = opProducao();
    assert.deepEqual(planejar(undefined, prod), { antes: null, depois: { ambiente: 'producao', recado_aprovacao: RECADO }, muda: true });
    assert.equal(planejar({ ambiente: 'producao', recado_aprovacao: 'R-20261101-100000-alexandre' }, prod).muda, false);
    const homo = lerArgumentos(['homologacao', ...argsHomologacao]);
    assert.equal(planejar(undefined, homo).muda, false);
    assert.equal(planejar({ ambiente: 'homologacao', recado_aprovacao: null }, homo).muda, false);
    assert.deepEqual(planejar({ ambiente: 'producao', recado_aprovacao: RECADO }, homo), {
      antes: { ambiente: 'producao', recado_aprovacao: RECADO },
      depois: { ambiente: 'homologacao', recado_aprovacao: null },
      muda: true,
    });
    assert.equal(planejar({ ambiente: 'producao', recado_aprovacao: RECADO, deleted_at: INSTANTE }, prod).antes, null);
  });

  it('produção com --confirmar: begin, tenant, set_config, filial, certificado, for update, upsert, auditoria, evento e commit', async () => {
    const c = clienteFalso();
    const r = await executar(c, opProducao(['--confirmar']), INSTANTE);
    assert.equal(r.aplicado, true);
    assert.deepEqual(r.avisos, []);
    assert.deepEqual(c.sqls.map(inicio), [
      'begin',
      'select id, slug,',
      "select set_config('app.tenant_id', $1,",
      'select id, slug,',
      'select id, nome',
      'select valido_ate from',
      'select id, ambiente,',
      'insert into core.ambiente_fiscal',
      'insert into plataforma.auditoria',
      'insert into plataforma.evento',
      'commit',
    ]);
    assert.deepEqual(c.sqls[2].params, [TENANT.id]);
    assert.match(c.sqls[3].sql, /from plataforma\.tenant where situacao = 'ativo' and deleted_at is null$/);
    const upsert = c.sqls[7];
    assert.match(upsert.sql, /on conflict \(tenant_id, filial_id\) do update .*alterado_por = null.*deleted_at = null/);
    assert.deepEqual(upsert.params.slice(1), [TENANT.id, FILIAL, 'producao', RECADO, INSTANTE.toISOString()]);
    const auditoria = c.sqls[8];
    assert.match(auditoria.sql, /'core\.ambiente\.trocado', 'ambiente_fiscal'/);
    assert.equal(auditoria.params[1], TENANT.id);
    assert.equal(auditoria.params[2], FILIAL);
    assert.deepEqual(JSON.parse(auditoria.params[3]), { ambiente: 'homologacao', recado_aprovacao: null });
    assert.deepEqual(JSON.parse(auditoria.params[4]), {
      filial_id: FILIAL,
      ambiente: 'producao',
      recado_aprovacao: RECADO,
      origem: 'script',
      operador: 'alexandre',
      recado_sha256: createHash('sha256').update(recadoTexto()).digest('hex'),
    });
    assert.match(auditoria.params[5], /^operador-[0-9a-f-]{36}$/);
    const evento = c.sqls[9];
    assert.deepEqual(evento.params.slice(1, 5), [TENANT.id, 'core.ambiente_fiscal.alterado@1', FILIAL, INSTANTE.getTime()]);
    assert.deepEqual(JSON.parse(evento.params[6]), {
      ator: 'sistema',
      request_id: auditoria.params[5],
      payload: { filial_id: FILIAL, ambiente: 'producao', recado_aprovacao: RECADO },
    });
  });

  it('volta para homologação com motivo, auditada e com evento, sem recado', async () => {
    const c = clienteFalso({ atual: { id: 'x', ambiente: 'producao', recado_aprovacao: RECADO, deleted_at: null } });
    const r = await executar(c, lerArgumentos(['homologacao', ...argsHomologacao, '--confirmar']), INSTANTE);
    assert.equal(r.aplicado, true);
    assert.ok(!c.sqls.some((s) => s.sql.includes('core.certificado')));
    const upsert = c.sqls.find((s) => s.sql.startsWith('insert into core.ambiente_fiscal'));
    assert.deepEqual(upsert.params.slice(3, 5), ['homologacao', null]);
    const auditoria = c.sqls.find((s) => s.sql.startsWith('insert into plataforma.auditoria'));
    assert.deepEqual(JSON.parse(auditoria.params[3]), { ambiente: 'producao', recado_aprovacao: RECADO });
    assert.deepEqual(JSON.parse(auditoria.params[4]), { filial_id: FILIAL, ambiente: 'homologacao', recado_aprovacao: null, origem: 'script', operador: 'alexandre', motivo: 'teste de rejeição' });
    assert.equal(c.sqls.at(-1).sql, 'commit');
  });

  it('sem --confirmar é simulação: grava na transação e faz rollback', async () => {
    const c = clienteFalso();
    const r = await executar(c, opProducao(), INSTANTE);
    assert.equal(r.aplicado, false);
    assert.equal(r.muda, true);
    assert.equal(c.sqls.at(-1).sql, 'rollback');
    assert.ok(!c.sqls.some((s) => s.sql === 'commit'));
  });

  it('"nada a mudar" não grava, não audita nem publica', async () => {
    const atual = { id: 'x', ambiente: 'producao', recado_aprovacao: 'R-20261101-100000-alexandre', deleted_at: null };
    const c = clienteFalso({ atual });
    const r = await executar(c, opProducao(['--confirmar']), INSTANTE);
    assert.equal(r.muda, false);
    assert.equal(r.aplicado, false);
    assert.equal(r.antes.recado_aprovacao, 'R-20261101-100000-alexandre');
    assert.ok(!c.sqls.some((s) => s.sql.startsWith('insert')));
    const c2 = clienteFalso();
    assert.equal((await executar(c2, lerArgumentos(['homologacao', ...argsHomologacao, '--confirmar']), INSTANTE)).muda, false);
    assert.ok(!c2.sqls.some((s) => s.sql.startsWith('insert')));
  });

  it('filial de outro tenant ou inexistente, empresa inexistente e recado inválido desfazem sem gravar', async () => {
    const c = clienteFalso({ filiais: [OUTRA_FILIAL] });
    await assert.rejects(executar(c, opProducao(['--confirmar']), INSTANTE), /filial não encontrada/);
    assert.equal(c.sqls.at(-1).sql, 'rollback');
    assert.ok(!c.sqls.some((s) => s.sql.startsWith('insert')));
    const c2 = clienteFalso();
    await assert.rejects(executar(c2, lerArgumentos(['listar', '--empresa', 'nao-existe']), INSTANTE), /empresa não encontrada/);
    const c3 = clienteFalso();
    await assert.rejects(executar(c3, { ...opProducao(['--confirmar']), textoRecado: recadoTexto({ de: 'gerente-projetos' }) }, INSTANTE), /alexandre/);
    assert.ok(!c3.sqls.some((s) => s.sql.startsWith('insert') || s.sql.includes('cadastros.filial_resumo')));
    assert.equal(c3.sqls.at(-1).sql, 'rollback');
  });

  it('produção recusa recado que aprova outro tenant ativo com nome mais longo, sem gravar', async () => {
    const c = clienteFalso();
    const op = { ...opProducao(['--confirmar']), textoRecado: recadoTexto({ corpo: 'Aprovo produção fiscal Thathyany Manaus Ltda.' }) };
    await assert.rejects(executar(c, op, INSTANTE), /o recado não aprova thathyany/);
    assert.ok(!c.sqls.some((s) => s.sql.startsWith('insert')));
    assert.equal(c.sqls.at(-1).sql, 'rollback');
  });

  it('certificado ausente ou vencido vira aviso, não bloqueio (RN-CORE-06 barra na emissão)', async () => {
    const sem = await executar(clienteFalso({ certificado: null }), opProducao(), INSTANTE);
    assert.match(sem.avisos[0], /sem certificado A1 ativo/);
    const vencido = await executar(clienteFalso({ certificado: { valido_ate: '2026-11-01T00:00:00Z' } }), opProducao(), INSTANTE);
    assert.match(vencido.avisos[0], /vencido/);
    assert.equal(vencido.muda, true);
  });

  it('listar só lê (rollback) e mostra cada filial com o ambiente', async () => {
    const c = clienteFalso();
    const r = await executar(c, lerArgumentos(['listar', '--empresa', 'thathyany']), INSTANTE);
    assert.deepEqual(r.filiais, [{ filial_id: FILIAL, nome: 'Matriz', ambiente: 'homologacao', recado_aprovacao: null }]);
    assert.equal(c.sqls.at(-1).sql, 'rollback');
  });
});
