/**
 * T-0021, migração 0028: faturamento.titulo_geracao (contador persistente das tentativas de gerar os títulos de uma
 * nota, gravado pelo worker na varredura, RN-FAT-03), alterado_em do histórico da configuração da filial pelo relógio
 * do banco (🟡 da 0026) e CHECK titulo_real_so_homologacao_ck no título (🟡 do lote 5). Motivo em docs/banco/README.md.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarScript,
} from './apoio.ts';
import {
  fixtureConfiguracaoFilial,
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  fixtureTituloGeracao,
  novoTenant,
  sqlNotaAutorizada,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0028_faturamento_titulo_geracao.sql', import.meta.url));
const A = novoTenant('titulo-geracao-0028-a');
const B = novoTenant('titulo-geracao-0028-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };
const TG = 'faturamento.titulo_geracao';

/** Upsert do worker: soma uma tentativa (o caminho da varredura). */
const sqlUpsert = (nota: string, motivo = 'RN-FAT-03: falha na geração') =>
  `INSERT INTO ${TG} (tenant_id, nota_id, tentativas, ultima_tentativa_em, motivo)
   VALUES (plataforma.tenant_atual(), '${nota}', 1, now(), '${motivo}')
   ON CONFLICT (tenant_id, nota_id) DO UPDATE
     SET tentativas = ${TG}.tentativas + 1, ultima_tentativa_em = EXCLUDED.ultima_tentativa_em,
         motivo = EXCLUDED.motivo;`;

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — titulo_geracao, alterado_em e título real (T-0021, 0028)',
  () => {
    let banco: BancoDeTeste;

    const contador = (nota: string, ctx = LEITURA_A) =>
      consultar<{ n: number; m: string | null; em: boolean }>(
        banco.conexao,
        `SELECT tentativas AS n, motivo AS m, ultima_tentativa_em IS NOT NULL AS em FROM ${TG} WHERE nota_id = '${nota}'`,
        ctx,
      );

    /** Nota autorizada com o XML guardado numa filial nova do tenant A (sqlNotaAutorizada da fixture). */
    let cnf = 5000;
    const notaAutorizada = (ambiente: 'homologacao' | 'producao'): string => {
      const { id, sql } = sqlNotaAutorizada(A, randomUUID(), ambiente, ++cnf);
      executar(banco.conexao, sql);
      return id;
    };

    const sqlTitulo = (nota: string, real: boolean, parcela = 1) =>
      `INSERT INTO faturamento.titulo (tenant_id, nota_id, parcela, total_parcelas, vencimento, valor_centavos,
       conta_como_real) VALUES (plataforma.tenant_atual(), '${nota}', ${parcela}, 9, '2026-12-31', 1000, ${real});`;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        [A, B]
          .map(
            (t) =>
              fixturePlataforma(t) +
              fixtureModulos(t) +
              fixtureFaturamento(t) +
              fixtureConfiguracaoFilial(t) +
              fixtureTituloGeracao(t),
          )
          .join('\n'),
      );
    });

    afterAll(() => banco?.remover());

    describe('faturamento.titulo_geracao', () => {
      it('estrutura: colunas da regra 5, RLS ligado, UNIQUE (tenant_id, nota_id) e FK composta para a nota', () => {
        const cols = consultar<{ c: string; tipo: string; nula: string; padrao: string | null }>(
          banco.conexao,
          `SELECT column_name AS c, data_type AS tipo, is_nullable AS nula, column_default AS padrao
         FROM information_schema.columns WHERE table_schema = 'faturamento' AND table_name = 'titulo_geracao'
         ORDER BY ordinal_position`,
        );
        expect(cols.map((c) => c.c)).toEqual([
          'id',
          'tenant_id',
          'nota_id',
          'tentativas',
          'ultima_tentativa_em',
          'motivo',
          'created_at',
          'updated_at',
          'deleted_at',
          'external_id',
        ]);
        expect(cols.find((c) => c.c === 'tentativas')).toEqual({
          c: 'tentativas',
          tipo: 'smallint',
          nula: 'NO',
          padrao: '0',
        });
        const defs = consultar<{ n: string; d: string }>(
          banco.conexao,
          `SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint
         WHERE conrelid = '${TG}'::regclass AND conname IN ('titulo_geracao_nota_uq', 'titulo_geracao_nota_fk')
         ORDER BY conname`,
        );
        expect(defs).toEqual([
          {
            n: 'titulo_geracao_nota_fk',
            d: 'FOREIGN KEY (tenant_id, nota_id) REFERENCES faturamento.nota(tenant_id, id)',
          },
          { n: 'titulo_geracao_nota_uq', d: 'UNIQUE (tenant_id, nota_id)' },
        ]);
        const [rls] = consultar<{ rls: boolean; pol: number }>(
          banco.conexao,
          `SELECT relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'faturamento'
           AND tablename = 'titulo_geracao' AND policyname = 'isolamento_tenant') AS pol
         FROM pg_class WHERE oid = '${TG}'::regclass`,
        );
        expect(rls).toEqual({ rls: true, pol: 1 });
      });

      it('o worker grava por upsert e soma a tentativa; a segunda linha da mesma nota cai em 23505', () => {
        expect(contador(A.nota)).toEqual([{ n: 1, m: 'RN-FAT-03: forma sem prazo na massa', em: true }]);
        executar(banco.conexao, sqlUpsert(A.nota, 'RN-FAT-03: sem prazos'), WORKER_A);
        executar(banco.conexao, sqlUpsert(A.nota, 'RN-FAT-03: sem prazos'), WORKER_A);
        expect(contador(A.nota)).toEqual([{ n: 3, m: 'RN-FAT-03: sem prazos', em: true }]);
        recusaDetalhada(
          banco.conexao,
          `INSERT INTO ${TG} (tenant_id, nota_id) VALUES (plataforma.tenant_atual(), '${A.nota}');`,
          '23505',
          /titulo_geracao_nota_uq/,
          WORKER_A,
        );
        executar(
          banco.conexao,
          `UPDATE ${TG} SET tentativas = 0, motivo = NULL WHERE nota_id = '${A.nota}';`,
          WORKER_A,
        );
        expect(contador(A.nota)).toEqual([{ n: 0, m: null, em: true }]);
      });

      it('tentativas >= 0 e motivo até 255 (23514); nota inexistente ou de outro tenant cai na FK (23503)', () => {
        recusaDetalhada(
          banco.conexao,
          `UPDATE ${TG} SET tentativas = -1 WHERE nota_id = '${A.nota}';`,
          '23514',
          /titulo_geracao_tentativas_ck/,
          WORKER_A,
        );
        recusaDetalhada(
          banco.conexao,
          `UPDATE ${TG} SET motivo = repeat('x', 256) WHERE nota_id = '${A.nota}';`,
          '23514',
          /titulo_geracao_motivo_ck/,
          WORKER_A,
        );
        executar(
          banco.conexao,
          `UPDATE ${TG} SET motivo = repeat('x', 255) WHERE nota_id = '${A.nota}';`,
          WORKER_A,
        );
        for (const nota of [randomUUID(), B.nota]) {
          recusaDetalhada(
            banco.conexao,
            `INSERT INTO ${TG} (tenant_id, nota_id) VALUES (plataforma.tenant_atual(), '${nota}');`,
            '23503',
            /titulo_geracao_nota_fk/,
            WORKER_A,
          );
        }
      });

      it('RLS: o worker do tenant B não grava no A', () => {
        recusaDetalhada(
          banco.conexao,
          `INSERT INTO ${TG} (tenant_id, nota_id) VALUES ('${A.id}', '${A.nota}');`,
          '42501',
          /row-level security/,
          WORKER_B,
        );
        expect(contador(B.nota, { papel: 'macuxierp_leitura', tenant: B.id })).toEqual([
          { n: 1, m: 'RN-FAT-03: forma sem prazo na massa', em: true },
        ]);
      });

      it('privilégios: worker SI e UPDATE só das três colunas; leitura só lê; o app não acessa; ninguém apaga', () => {
        expect(privilegiosDe(banco.conexao, 'macuxierp_worker', TG)).toBe('SI');
        expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', TG)).toBe('S');
        expect(privilegiosDe(banco.conexao, 'macuxierp_app', TG)).toBe('-');
        const colunas = consultar<{ c: string }>(
          banco.conexao,
          `SELECT attname AS c FROM pg_attribute WHERE attrelid = '${TG}'::regclass AND attnum > 0 AND NOT attisdropped
           AND has_column_privilege('macuxierp_worker', '${TG}', attname, 'UPDATE') ORDER BY attname`,
        );
        expect(colunas).toEqual([{ c: 'motivo' }, { c: 'tentativas' }, { c: 'ultima_tentativa_em' }]);
        for (const set of [`nota_id = '${randomUUID()}'`, `tenant_id = '${B.id}'`, 'deleted_at = now()']) {
          recusaDetalhada(banco.conexao, `UPDATE ${TG} SET ${set};`, '42501', /permission denied/, WORKER_A);
        }
        for (const sql of [sqlUpsert(A.nota), `UPDATE ${TG} SET tentativas = 1;`]) {
          recusaDetalhada(banco.conexao, sql, '42501', /permission denied/, LEITURA_A);
        }
        for (const sql of [`SELECT 1 FROM ${TG};`, sqlUpsert(A.nota)]) {
          recusaDetalhada(banco.conexao, sql, '42501', /permission denied/, APP_A);
        }
        recusaDetalhada(banco.conexao, `DELETE FROM ${TG};`, '42501', /não sai do banco/);
        recusaDetalhada(
          banco.conexao,
          `UPDATE ${TG} SET deleted_at = now();`,
          '23514',
          /titulo_geracao_sem_exclusao_logica/,
        );
      });
    });

    describe('histórico da configuração da filial (🟡 da 0026)', () => {
      it('alterado_em vem do relógio do banco, não do updated_at que o app manda no INSERT', () => {
        const filial = randomUUID();
        executar(
          banco.conexao,
          `INSERT INTO faturamento.configuracao_filial (tenant_id, filial_id, faturamento_real_nfe_simulada, alterado_por,
           updated_at) VALUES (plataforma.tenant_atual(), '${filial}', true, '${A.usuario}', '2020-01-01T00:00:00Z');`,
          APP_A,
        );
        executar(
          banco.conexao,
          `UPDATE faturamento.configuracao_filial SET faturamento_real_nfe_simulada = false, alterado_por = '${A.usuario}'
           WHERE filial_id = '${filial}';`,
          APP_A,
        );
        const h = consultar<{ agora: boolean }>(
          banco.conexao,
          `SELECT abs(extract(epoch FROM alterado_em - now())) < 60 AS agora
         FROM faturamento.configuracao_filial_historico WHERE filial_id = '${filial}' ORDER BY alterado_em`,
          LEITURA_A,
        );
        expect(h).toEqual([{ agora: true }, { agora: true }]);
      });

      it('a função continua SECURITY DEFINER, com search_path fixo e sem EXECUTE para PUBLIC nem para o app', () => {
        const [f] = consultar<{ definer: boolean; cfg: string[]; publico: boolean; app: boolean }>(
          banco.conexao,
          `SELECT p.prosecdef AS definer, p.proconfig AS cfg,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
           has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app
         FROM pg_proc p WHERE p.oid = 'faturamento.configuracao_filial_depois()'::regprocedure`,
        );
        expect(f).toEqual({
          definer: true,
          cfg: ['search_path=pg_catalog, pg_temp'],
          publico: false,
          app: false,
        });
      });
    });

    describe('faturamento.titulo: conta_como_real só em homologação (🟡 do lote 5)', () => {
      it('a constraint existe validada e nenhuma linha da massa a viola', () => {
        const [c] = consultar<{ validada: boolean; d: string }>(
          banco.conexao,
          `SELECT convalidated AS validada, pg_get_constraintdef(oid) AS d FROM pg_constraint
         WHERE conrelid = 'faturamento.titulo'::regclass AND conname = 'titulo_real_so_homologacao_ck'`,
        );
        expect(c).toEqual({
          validada: true,
          d: "CHECK (((ambiente = 'homologacao'::text) OR (NOT conta_como_real)))",
        });
        const [v] = consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM faturamento.titulo WHERE ambiente <> 'homologacao' AND conta_como_real`,
        );
        expect(v).toEqual({ n: 0 });
      });

      it('produção com conta_como_real cai em 23514; homologação com e produção sem passam', () => {
        const prod = notaAutorizada('producao');
        const homolog = notaAutorizada('homologacao');
        recusaDetalhada(
          banco.conexao,
          sqlTitulo(prod, true),
          '23514',
          /titulo_real_so_homologacao_ck/,
          WORKER_A,
        );
        executar(banco.conexao, sqlTitulo(prod, false), WORKER_A);
        executar(banco.conexao, sqlTitulo(homolog, true), WORKER_A);
        expect(
          consultar<{ a: string; r: boolean }>(
            banco.conexao,
            `SELECT ambiente AS a, conta_como_real AS r FROM faturamento.titulo
           WHERE nota_id IN ('${prod}', '${homolog}') ORDER BY ambiente`,
            LEITURA_A,
          ),
        ).toEqual([
          { a: 'homologacao', r: true },
          { a: 'producao', r: false },
        ]);
      });
    });

    it('a 0028 roda de novo sem erro, sem duplicar nada, e as travas continuam valendo', () => {
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      const [r] = consultar<{ gatilhos: number; ck: number; publico: boolean }>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = '${TG}'::regclass) AS gatilhos,
         (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'faturamento.titulo'::regclass
            AND conname = 'titulo_real_so_homologacao_ck') AS ck,
         (SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = 'faturamento.configuracao_filial_depois()'::regprocedure AND a.grantee = 0
              AND a.privilege_type = 'EXECUTE')) AS publico`,
      );
      // titulo_geracao: tocar_updated_at e titulo_geracao_sem_exclusao.
      expect(r).toEqual({ gatilhos: 2, ck: 1, publico: false });
      expect(privilegiosDe(banco.conexao, 'macuxierp_app', TG)).toBe('-');
      executar(banco.conexao, sqlUpsert(B.nota), WORKER_B);
      expect(contador(B.nota, { papel: 'macuxierp_leitura', tenant: B.id })).toMatchObject([{ n: 2 }]);
    });
  },
);
