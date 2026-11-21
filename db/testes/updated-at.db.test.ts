/**
 * T-0032: updated_at estritamente crescente por linha (migração 0006). O core usa date_trunc('milliseconds',
 * updated_at) como token de concorrência otimista: cada gravação precisa mudar o token, mesmo na mesma transação ou
 * em transações que começaram no mesmo instante, e o valor nunca volta no tempo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { rodarScriptAssincrono } from '../src/psql.ts';
import { type BancoDeTeste, criarBancoDeTeste, executar, PG_DISPONIVEL, rodarScript } from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const A = novoTenant('updated-at-a');
const SOMAR = `UPDATE plataforma.trabalho SET tentativas = tentativas + 1 WHERE tenant_id = '${A.id}'`;
/** updated_at em microssegundos desde a época (inteiro), para comparar sem perder precisão. */
const US = `(extract(epoch FROM updated_at) * 1000000)::bigint`;
const ms = (us: number): number => Math.floor(us / 1000);
const numeros = (saida: string): number[] =>
  saida
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^-?\d+$/.test(l))
    .map(Number);

/** UPDATE condicionado ao token (updated_at truncado em ms), como o core faz; devolve as linhas gravadas (1 ou nada). */
function gravarComToken(banco: BancoDeTeste, tokenMs: number): string {
  return rodarScript(
    banco.conexao,
    `UPDATE plataforma.trabalho SET tentativas = 0 WHERE tenant_id = '${A.id}'
       AND date_trunc('milliseconds', updated_at) = timestamptz 'epoch' + ${tokenMs} * interval '1 millisecond'
     RETURNING 1;`,
    { transacao: true },
  );
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — updated_at crescente (T-0032)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    executar(banco.conexao, fixturePlataforma(A));
  });

  afterAll(() => banco?.remover());

  it('duas atualizações na mesma transação geram updated_at distintos em ms e crescentes; o token antigo não casa', () => {
    const saida = rodarScript(
      banco.conexao,
      `${SOMAR} RETURNING ${US};
       ${SOMAR} RETURNING ${US};
       SELECT count(*) FROM plataforma.trabalho WHERE tenant_id = '${A.id}' AND updated_at = now();`,
      { transacao: true },
    );
    const [primeira, segunda, iguaisAoInicio] = numeros(saida);
    expect(ms(segunda!)).toBeGreaterThan(ms(primeira!));
    expect(iguaisAoInicio).toBe(0);

    // Token da primeira gravação (ms), usado depois da segunda, como o core faz: nenhuma linha.
    const casou = gravarComToken(banco, ms(primeira!));
    expect(numeros(casou)).toEqual([]);
  });

  it('duas transações que começam juntas e gravam a mesma linha uma depois da outra: distintos e crescentes', async () => {
    // T1 grava logo e segura a trava; T2 começou no mesmo instante, espera a trava e grava depois. Com now(), T2
    // gravaria o próprio início (igual ou anterior ao de T1); agora grava pelo menos 1 ms depois de T1.
    const t1 = rodarScriptAssincrono(
      banco.conexao,
      `BEGIN;
       SELECT (extract(epoch FROM now()) * 1000000)::bigint;
       ${SOMAR} RETURNING ${US};
       SELECT pg_sleep(0.4);
       COMMIT;`,
    );
    const t2 = rodarScriptAssincrono(
      banco.conexao,
      `BEGIN;
       SELECT (extract(epoch FROM now()) * 1000000)::bigint;
       SELECT pg_sleep(0.15);
       ${SOMAR} RETURNING ${US};
       COMMIT;`,
    );
    const [[inicio1, grava1], [inicio2, grava2]] = (await Promise.all([t1, t2])).map(numeros) as [
      number[],
      number[],
    ];

    // As duas começaram antes de qualquer gravação: T2 começou antes de T1 terminar (sobreposição real).
    expect(inicio2!).toBeLessThan(grava1! + 400_000);
    expect(ms(grava2!)).toBeGreaterThan(ms(grava1!));
    expect(grava2!).toBeGreaterThan(inicio2!);
    expect(grava1!).toBeGreaterThanOrEqual(inicio1!);

    // O token que T1 deixou (ms) não casa depois da gravação de T2.
    const casou = gravarComToken(banco, ms(grava1!));
    expect(numeros(casou)).toEqual([]);

    // E o token atual casa (o teste não passa por acaso).
    const atual = gravarComToken(banco, ms(grava2!));
    expect(numeros(atual)).toEqual([1]);
  });

  it('a trigger continua só no UPDATE: o INSERT mantém o DEFAULT da coluna (decisão da 0006)', () => {
    const saida = rodarScript(
      banco.conexao,
      `SELECT count(*) FROM pg_trigger WHERE tgname = 'tocar_updated_at' AND NOT tgisinternal
         AND (tgtype::int & 4) <> 0;`,
    );
    expect(numeros(saida)).toEqual([0]);
  });
});
