/** T-0035: alerta diário do A1 (migração 0009). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const A = novoTenant('aviso-a1-a');
const B = novoTenant('aviso-a1-b');
const SUSPENSO = novoTenant('aviso-a1-suspenso');

/**
 * O mesmo INSERT do adaptador DestinoAvisos.registrarA1, como o worker na sessão do tenant `sessao`; devolve os ids
 * gravados (vazio = o aviso do dia já existia).
 */
function registrar(
  banco: BancoDeTeste,
  tenant: string,
  certificado: string,
  dia: string,
  sessao = tenant,
): string[] {
  const saida = rodarScript(
    banco.conexao,
    `SET ROLE macuxierp_worker;
     SET app.tenant_id = '${sessao}';
     INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia)
     VALUES ('${tenant}', '${certificado}', '${A.filial}', '2026-12-03T00:00:00Z', 12, '${dia}')
     ON CONFLICT (tenant_id, certificado_id, dia) DO NOTHING
     RETURNING id;`,
    { transacao: true },
  );
  return saida.split('\n').filter((l) => l.trim() !== '');
}

function certificadoDe(banco: BancoDeTeste, tenant: string): string {
  const [c] = consultar<{ id: string }>(
    banco.conexao,
    `SELECT id FROM core.certificado WHERE tenant_id = '${tenant}'`,
  );
  if (c === undefined) throw new Error('massa sem certificado');
  return c.id;
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — alerta do A1 (T-0035, migração 0009)', () => {
  let banco: BancoDeTeste;
  let certA: string;
  let certB: string;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B, SUSPENSO].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n') +
        `\nUPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${SUSPENSO.id}';`,
    );
    certA = certificadoDe(banco, A.id);
    certB = certificadoDe(banco, B.id);
  });

  afterAll(() => banco?.remover());

  it('a segunda gravação do mesmo certificado no mesmo dia não duplica; o dia seguinte gera outro aviso', () => {
    expect(registrar(banco, A.id, certA, '2026-11-21')).toHaveLength(1);
    expect(registrar(banco, A.id, certA, '2026-11-21')).toEqual([]);
    expect(registrar(banco, A.id, certA, '2026-11-22')).toHaveLength(1);
    const [n] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM core.aviso_a1 WHERE certificado_id = '${certA}' AND dia >= '2026-11-21'`,
    );
    expect(n?.n).toBe(2);
  });

  it('o worker no tenant B não vê nem grava aviso do tenant A', () => {
    expect(
      consultar(banco.conexao, `SELECT id FROM core.aviso_a1 WHERE tenant_id = '${A.id}'`, {
        papel: 'macuxierp_worker',
        tenant: B.id,
      }),
    ).toEqual([]);
    // Linha com tenant_id = A numa sessão de B: a RLS (WITH CHECK) recusa.
    expect(falha(() => registrar(banco, A.id, certA, '2026-11-23', B.id))).toMatch(/row-level security/);
    // Certificado de A com tenant_id = B: a FK composta recusa (o certificado não é do tenant B).
    expect(falha(() => registrar(banco, B.id, certA, '2026-11-23', B.id))).toMatch(/foreign key/);
    // O próprio certificado de B grava normalmente.
    expect(registrar(banco, B.id, certB, '2026-11-23')).toHaveLength(1);
  });

  it('nenhum papel da aplicação altera nem apaga aviso; o app e a leitura só leem', () => {
    for (const papel of ['macuxierp_worker', 'macuxierp_app', 'macuxierp_leitura']) {
      const ctx = { papel, tenant: A.id };
      expect(falha(() => executar(banco.conexao, 'UPDATE core.aviso_a1 SET dias = 0;', ctx))).toMatch(
        /permission denied/,
      );
      expect(falha(() => executar(banco.conexao, 'DELETE FROM core.aviso_a1;', ctx))).toMatch(
        /permission denied/,
      );
      expect(consultar(banco.conexao, 'SELECT id FROM core.aviso_a1', ctx).length).toBeGreaterThan(0);
    }
    for (const papel of ['macuxierp_app', 'macuxierp_leitura']) {
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia)
               SELECT tenant_id, id, filial_id, valido_ate, 1, '2026-12-01' FROM core.certificado;`,
            { papel, tenant: A.id },
          ),
        ),
      ).toMatch(/permission denied/);
    }
  });

  it('tenants_ativos(): o worker, sem tenant na sessão, recebe só os ids dos ativos (sem suspenso nem referência)', () => {
    const ids = consultar<{ id: string }>(
      banco.conexao,
      'SELECT t AS id FROM plataforma.tenants_ativos() t',
      {
        papel: 'macuxierp_worker',
      },
    ).map((r) => r.id);
    expect(ids.sort()).toEqual([A.id, B.id].sort());
    // Sem tenant na sessão, a tabela em si continua fechada para o worker.
    expect(
      consultar(banco.conexao, 'SELECT id FROM plataforma.tenant', { papel: 'macuxierp_worker' }),
    ).toEqual([]);
  });

  it('tenants_ativos(): só o worker executa (app e leitura recusados)', () => {
    for (const papel of ['macuxierp_app', 'macuxierp_leitura']) {
      expect(
        falha(() => consultar(banco.conexao, 'SELECT t FROM plataforma.tenants_ativos() t', { papel })),
      ).toMatch(/permission denied/);
    }
  });
});
