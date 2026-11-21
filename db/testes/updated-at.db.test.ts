/** T-0032: updated_at estritamente crescente por linha (migração 0006). */
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

  it('T2 começa antes de T1, T1 grava primeiro e T2 grava depois: distintos e crescentes', async () => {
    // Ordem garantida pelo próprio banco, sem tempo de folga: T1 pega a trava consultiva; T2 espera alguém segurá-la,
    // começa a transação (now()) e pede a trava; T1 só começa quando T2 está esperando, grava a linha, solta a trava e
    // só faz COMMIT quando T2 está bloqueada esperando a linha. Com now(), T2 gravaria o próprio início, anterior ao
    // de T1 (o valor voltaria no tempo); com a 0006, grava pelo menos 1 ms depois de T1.
    const CHAVE = 320032;
    const esperar = (condicao: string, oQue: string): string => `DO $$
BEGIN
  FOR i IN 1..2000 LOOP
    IF ${condicao} THEN RETURN; END IF;
    PERFORM pg_sleep(0.005);
  END LOOP;
  RAISE EXCEPTION 'tempo esgotado esperando ${oQue}';
END $$;`;
    const bloqueadaPorMim = (tipos: string): string =>
      `EXISTS (SELECT 1 FROM pg_locks l WHERE NOT l.granted AND l.locktype IN (${tipos})
         AND pg_backend_pid() = ANY (pg_blocking_pids(l.pid)))`;
    const t1 = rodarScriptAssincrono(
      banco.conexao,
      `SELECT pg_advisory_lock(${CHAVE});
       ${esperar(bloqueadaPorMim("'advisory'"), 'T2 pedir a trava')}
       BEGIN;
       SELECT (extract(epoch FROM now()) * 1000000)::bigint;
       ${SOMAR} RETURNING ${US};
       SELECT pg_advisory_unlock(${CHAVE});
       ${esperar(bloqueadaPorMim("'transactionid', 'tuple'"), 'T2 esperar a linha')}
       COMMIT;`,
    );
    const t2 = rodarScriptAssincrono(
      banco.conexao,
      `${esperar(
        `EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = ${CHAVE} AND granted
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))`,
        'T1 pegar a trava',
      )}
       BEGIN;
       SELECT (extract(epoch FROM now()) * 1000000)::bigint;
       SELECT pg_advisory_xact_lock(${CHAVE});
       ${SOMAR} RETURNING ${US};
       COMMIT;`,
    );
    const [[inicio1, grava1], [inicio2, grava2]] = (await Promise.all([t1, t2])).map(numeros) as [
      number[],
      number[],
    ];

    // Sobreposição real: T2 começou antes de T1 começar e, portanto, antes de T1 gravar e fazer COMMIT.
    expect(inicio2!).toBeLessThan(inicio1!);
    expect(inicio1!).toBeLessThanOrEqual(grava1!);
    expect(ms(grava2!)).toBeGreaterThan(ms(grava1!));

    // O token que T1 deixou (ms) não casa depois da gravação de T2.
    const casou = gravarComToken(banco, ms(grava1!));
    expect(numeros(casou)).toEqual([]);

    // E o token atual casa (o teste não passa por acaso).
    const atual = gravarComToken(banco, ms(grava2!));
    expect(numeros(atual)).toEqual([1]);
  });

  it('toda trigger que chama tocar_updated_at é BEFORE UPDATE FOR EACH ROW e nenhuma dispara no INSERT', () => {
    // tgtype: 1 = ROW, 2 = BEFORE, 4 = INSERT, 16 = UPDATE.
    const saida = rodarScript(
      banco.conexao,
      `SELECT count(*) FROM pg_trigger WHERE tgfoid = 'plataforma.tocar_updated_at'::regproc AND NOT tgisinternal;
       SELECT count(*) FROM pg_trigger WHERE tgfoid = 'plataforma.tocar_updated_at'::regproc AND NOT tgisinternal
         AND ((tgtype::int & 19) <> 19 OR (tgtype::int & 4) <> 0 OR tgenabled = 'D');
       SELECT count(*) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attname = 'updated_at'
         WHERE t.tgfoid = 'plataforma.tocar_updated_at'::regproc AND NOT t.tgisinternal;`,
    );
    const [comTrigger, foraDoContrato, comColuna] = numeros(saida);
    expect(comTrigger).toBeGreaterThan(0);
    expect(foraDoContrato).toBe(0);
    expect(comColuna).toBe(comTrigger);
  });
});
