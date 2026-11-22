/**
 * T-0021, migração 0026 (pedido do modulo-faturamento): faturamento.configuracao_filial (bandeira
 * faturamento_real_nfe_simulada por filial, alterado_por obrigatório) com o histórico só de inserção gravado por
 * gatilho, e faturamento.titulo.conta_como_real, gravada na geração e imutável depois. Motivo em docs/banco/README.md.
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
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import {
  fixtureConfiguracaoFilial,
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  novoTenant,
  type Tenant,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(
  new URL('../migrations/0026_faturamento_configuracao_filial.sql', import.meta.url),
);
const A = novoTenant('config-filial-0026-a');
const B = novoTenant('config-filial-0026-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };
const CONFIG = 'faturamento.configuracao_filial';
const HIST = 'faturamento.configuracao_filial_historico';
const SEM_ALTERADO_POR = /alterado_por é obrigatório/;
const CONTA_COMO_REAL = /conta_como_real do título não muda/;
const SO_GATILHO = /só é gravado pelo gatilho/;

/** INSERT da configuração no tenant da sessão; `alterado` = valor SQL de alterado_por. */
const sqlConfig = (filial: string, valor: string | null, alterado: string): string =>
  `INSERT INTO ${CONFIG} (tenant_id, filial_id${valor === null ? '' : ', faturamento_real_nfe_simulada'}, alterado_por)
   VALUES (plataforma.tenant_atual(), '${filial}'${valor === null ? '' : `, ${valor}`}, ${alterado});`;

const uuids = (saida: string): string[] => linhas(saida).filter((l) => /^[0-9a-f-]{36}$/.test(l));

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — configuração da filial e título real (T-0021, 0026)',
  () => {
    let banco: BancoDeTeste;

    const bandeira = (filial: string, t: Tenant = A) =>
      consultar<{ v: boolean; por: string | null }>(
        banco.conexao,
        `SELECT faturamento_real_nfe_simulada AS v, alterado_por AS por FROM ${CONFIG} WHERE filial_id = '${filial}'`,
        { papel: 'macuxierp_app', tenant: t.id },
      );

    const historico = (filial: string) =>
      consultar<{ anterior: boolean | null; novo: boolean; por: string }>(
        banco.conexao,
        `SELECT valor_anterior AS anterior, valor_novo AS novo, alterado_por AS por FROM ${HIST}
       WHERE filial_id = '${filial}' ORDER BY alterado_em, created_at`,
        LEITURA_A,
      );

    /** INSERT de título novo (parcela livre) da nota autorizada da massa do tenant A; sem `conta`, omite a coluna. */
    let parcela = 1;
    const sqlTitulo = (conta?: string): string => {
      parcela += 1;
      const col = conta === undefined ? '' : ', conta_como_real';
      const val = conta === undefined ? '' : `, ${conta}`;
      return `INSERT INTO faturamento.titulo (tenant_id, nota_id, parcela, total_parcelas, vencimento, valor_centavos${col})
         VALUES (plataforma.tenant_atual(), '${A.nota}', ${parcela}, 999, '2026-12-31', 1000${val}) RETURNING id;`;
    };

    /** Título novo pelo app, com conta_como_real; devolve o id. */
    const inserirTitulo = (conta: string): string => {
      const [id] = uuids(rodarComo(banco.conexao, sqlTitulo(conta), APP_A));
      if (!id) throw new Error('INSERT do título sem id');
      return id;
    };

    const contaComoReal = (id: string) =>
      consultar<{ c: boolean; v: string }>(
        banco.conexao,
        `SELECT conta_como_real AS c, vencimento::text AS v FROM faturamento.titulo WHERE id = '${id}'`,
        APP_A,
      );

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        [A, B]
          .map(
            (t) =>
              fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t) + fixtureConfiguracaoFilial(t),
          )
          .join('\n'),
      );
    });

    afterAll(() => banco?.remover());

    it('estrutura: bandeira boolean NOT NULL DEFAULT false, alterado_por anulável, conta_como_real sem default, UNIQUE', () => {
      const cols = consultar<{ c: string; tipo: string; nula: string; padrao: string | null }>(
        banco.conexao,
        `SELECT column_name AS c, data_type AS tipo, is_nullable AS nula, column_default AS padrao
       FROM information_schema.columns
       WHERE (table_schema, table_name, column_name) IN (('faturamento', 'configuracao_filial', 'filial_id'),
         ('faturamento', 'configuracao_filial', 'faturamento_real_nfe_simulada'),
         ('faturamento', 'configuracao_filial', 'alterado_por'), ('faturamento', 'titulo', 'conta_como_real'))
       ORDER BY table_name, column_name`,
      );
      expect(cols).toEqual([
        { c: 'alterado_por', tipo: 'uuid', nula: 'YES', padrao: null },
        { c: 'faturamento_real_nfe_simulada', tipo: 'boolean', nula: 'NO', padrao: 'false' },
        { c: 'filial_id', tipo: 'uuid', nula: 'NO', padrao: null },
        { c: 'conta_como_real', tipo: 'boolean', nula: 'NO', padrao: null },
      ]);
      const [uq] = consultar<{ def: string }>(
        banco.conexao,
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = '${CONFIG}'::regclass AND conname = 'configuracao_filial_uq'`,
      );
      expect(uq).toEqual({ def: 'UNIQUE (tenant_id, filial_id)' });
    });

    it('o padrão é false, e o INSERT vai para o histórico com valor anterior nulo', () => {
      const filial = randomUUID();
      executar(banco.conexao, sqlConfig(filial, null, `'${A.usuario}'`), APP_A);
      expect(bandeira(filial)).toEqual([{ v: false, por: A.usuario }]);
      expect(historico(filial)).toEqual([{ anterior: null, novo: false, por: A.usuario }]);
    });

    it('o UNIQUE por filial recusa a segunda linha do mesmo tenant; outro tenant usa a mesma filial', () => {
      const filial = randomUUID();
      executar(banco.conexao, sqlConfig(filial, 'true', `'${A.usuario}'`), APP_A);
      recusaDetalhada(
        banco.conexao,
        sqlConfig(filial, 'false', `'${A.usuario}'`),
        '23505',
        /configuracao_filial_uq/,
        APP_A,
      );
      executar(banco.conexao, sqlConfig(filial, 'false', `'${B.usuario}'`), {
        papel: 'macuxierp_app',
        tenant: B.id,
      });
      expect(bandeira(filial, B)).toEqual([{ v: false, por: B.usuario }]);
      expect(bandeira(filial)).toEqual([{ v: true, por: A.usuario }]);
    });

    it('o app grava e atualiza com alterado_por (também por upsert); sem alterado_por, 23514', () => {
      const filial = randomUUID();
      const outro = randomUUID();
      recusaDetalhada(banco.conexao, sqlConfig(filial, 'true', 'NULL'), '23514', SEM_ALTERADO_POR, APP_A);
      recusaDetalhada(
        banco.conexao,
        `INSERT INTO ${CONFIG} (tenant_id, filial_id) VALUES (plataforma.tenant_atual(), '${filial}');`,
        '23514',
        SEM_ALTERADO_POR,
        APP_A,
      );
      executar(banco.conexao, sqlConfig(filial, 'true', `'${A.usuario}'`), APP_A);
      executar(
        banco.conexao,
        `UPDATE ${CONFIG} SET faturamento_real_nfe_simulada = false, alterado_por = '${outro}'
       WHERE filial_id = '${filial}';`,
        APP_A,
      );
      expect(bandeira(filial)).toEqual([{ v: false, por: outro }]);
      recusaDetalhada(
        banco.conexao,
        `UPDATE ${CONFIG} SET faturamento_real_nfe_simulada = true, alterado_por = NULL WHERE filial_id = '${filial}';`,
        '23514',
        SEM_ALTERADO_POR,
        APP_A,
      );
      executar(
        banco.conexao,
        `INSERT INTO ${CONFIG} (tenant_id, filial_id, faturamento_real_nfe_simulada, alterado_por)
       VALUES (plataforma.tenant_atual(), '${filial}', true, '${A.usuario}')
       ON CONFLICT (tenant_id, filial_id) DO UPDATE
         SET faturamento_real_nfe_simulada = EXCLUDED.faturamento_real_nfe_simulada,
             alterado_por = EXCLUDED.alterado_por;`,
        APP_A,
      );
      expect(bandeira(filial)).toEqual([{ v: true, por: A.usuario }]);
      // Fora da bandeira e de alterado_por, o app não muda nada (GRANT por coluna).
      for (const set of [`filial_id = '${randomUUID()}'`, 'deleted_at = now()', `external_id = 'x'`]) {
        recusaDetalhada(
          banco.conexao,
          `UPDATE ${CONFIG} SET ${set} WHERE filial_id = '${filial}';`,
          '42501',
          /permission denied/,
          APP_A,
        );
      }
      // Nem o dono muda a filial.
      recusaDetalhada(
        banco.conexao,
        `UPDATE ${CONFIG} SET filial_id = '${randomUUID()}' WHERE filial_id = '${filial}';`,
        '42501',
        /filial_id da configuração da filial não muda/,
      );
    });

    it('cada INSERT e cada UPDATE gera uma linha no histórico, com o valor anterior e o novo', () => {
      const filial = randomUUID();
      const u2 = randomUUID();
      const u3 = randomUUID();
      executar(banco.conexao, sqlConfig(filial, 'false', `'${A.usuario}'`), APP_A);
      executar(
        banco.conexao,
        `UPDATE ${CONFIG} SET faturamento_real_nfe_simulada = true, alterado_por = '${u2}' WHERE filial_id = '${filial}';`,
        APP_A,
      );
      executar(
        banco.conexao,
        `UPDATE ${CONFIG} SET faturamento_real_nfe_simulada = true, alterado_por = '${u3}' WHERE filial_id = '${filial}';
       UPDATE ${CONFIG} SET faturamento_real_nfe_simulada = false, alterado_por = '${u2}' WHERE filial_id = '${filial}';`,
        APP_A,
      );
      expect(historico(filial)).toEqual([
        { anterior: null, novo: false, por: A.usuario },
        { anterior: false, novo: true, por: u2 },
        { anterior: true, novo: true, por: u3 },
        { anterior: true, novo: false, por: u2 },
      ]);
      const [h] = consultar<{ ok: boolean }>(
        banco.conexao,
        `SELECT bool_and(h.configuracao_id = c.id AND h.tenant_id = c.tenant_id) AS ok
       FROM ${HIST} h JOIN ${CONFIG} c ON c.id = h.configuracao_id WHERE c.filial_id = '${filial}'`,
        APP_A,
      );
      expect(h).toEqual({ ok: true });
    });

    it('o histórico não aceita UPDATE, DELETE, TRUNCATE nem INSERT direto, para ninguém (dono incluso)', () => {
      recusaDetalhada(
        banco.conexao,
        `UPDATE ${HIST} SET valor_novo = NOT valor_novo;`,
        '42501',
        /só de inserção/,
      );
      recusaDetalhada(banco.conexao, `DELETE FROM ${HIST};`, '42501', /só de inserção/);
      recusaDetalhada(banco.conexao, `TRUNCATE ${HIST};`, '42501', /só de inserção/);
      const direto = `INSERT INTO ${HIST} (tenant_id, configuracao_id, filial_id, valor_novo, alterado_por)
      SELECT tenant_id, id, filial_id, true, '${A.usuario}' FROM ${CONFIG} WHERE filial_id = '${A.filial}';`;
      recusaDetalhada(banco.conexao, direto, '42501', /permission denied/, APP_A);
      recusaDetalhada(banco.conexao, direto, '42501', SO_GATILHO);
      recusaDetalhada(
        banco.conexao,
        `DELETE FROM ${CONFIG} WHERE filial_id = '${A.filial}';`,
        '42501',
        /permission denied/,
        APP_A,
      );
      recusaDetalhada(
        banco.conexao,
        `DELETE FROM ${CONFIG} WHERE filial_id = '${A.filial}';`,
        '42501',
        /não sai do banco/,
      );
    });

    it('privilégios: app SI na configuração (UPDATE só por coluna) e S no histórico; worker e leitura só leem', () => {
      expect(privilegiosDe(banco.conexao, 'macuxierp_app', CONFIG)).toBe('SI');
      expect(privilegiosDe(banco.conexao, 'macuxierp_worker', CONFIG)).toBe('S');
      expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', CONFIG)).toBe('S');
      expect(privilegiosDe(banco.conexao, 'macuxierp_app', HIST)).toBe('S');
      expect(privilegiosDe(banco.conexao, 'macuxierp_worker', HIST)).toBe('-');
      expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', HIST)).toBe('S');
      const colunas = consultar<{ c: string }>(
        banco.conexao,
        `SELECT attname AS c FROM pg_attribute
       WHERE attrelid = '${CONFIG}'::regclass AND attnum > 0 AND NOT attisdropped
         AND has_column_privilege('macuxierp_app', '${CONFIG}', attname, 'UPDATE')
       ORDER BY attname`,
      );
      expect(colunas).toEqual([{ c: 'alterado_por' }, { c: 'faturamento_real_nfe_simulada' }]);
      for (const ctx of [WORKER_A, LEITURA_A]) {
        expect(
          consultar<{ v: boolean }>(
            banco.conexao,
            `SELECT faturamento_real_nfe_simulada AS v FROM ${CONFIG} WHERE filial_id = '${A.filial}'`,
            ctx,
          ),
        ).toEqual([{ v: true }]);
        for (const sql of [
          sqlConfig(randomUUID(), 'true', `'${A.usuario}'`),
          `UPDATE ${CONFIG} SET faturamento_real_nfe_simulada = false, alterado_por = '${A.usuario}';`,
        ]) {
          recusaDetalhada(banco.conexao, sql, '42501', /permission denied/, ctx);
        }
      }
      expect(historico(A.filial)).toEqual([{ anterior: null, novo: true, por: A.usuario }]);
      recusaDetalhada(banco.conexao, `SELECT 1 FROM ${HIST};`, '42501', /permission denied/, WORKER_A);
    });

    it('ataque por gatilho em tabela temporária: o app não grava no histórico nem prende o gatilho DEFINER (42501)', () => {
      const antes = historico(A.filial);
      // O app tem TEMPORARY no banco (0001): tabela temporária com gatilho que chama função pg_temp, que tenta gravar
      // no histórico já na profundidade 2 de gatilho.
      recusaDetalhada(
        banco.conexao,
        `CREATE TEMP TABLE ataque (x int);
       CREATE FUNCTION pg_temp.forjar() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN
         INSERT INTO ${HIST} (tenant_id, configuracao_id, filial_id, valor_novo, alterado_por)
         SELECT tenant_id, id, filial_id, false, '${randomUUID()}' FROM ${CONFIG} WHERE filial_id = '${A.filial}';
         RETURN NULL;
       END $f$;
       CREATE TRIGGER forjar AFTER INSERT ON ataque FOR EACH ROW EXECUTE FUNCTION pg_temp.forjar();
       INSERT INTO ataque VALUES (1);`,
        '42501',
        /permission denied for table configuracao_filial_historico/,
        APP_A,
      );
      // Nem prende o gatilho SECURITY DEFINER numa tabela própria com as colunas da configuração (sem EXECUTE).
      const copia = `CREATE TEMP TABLE copia (id uuid, tenant_id uuid, filial_id uuid,
         faturamento_real_nfe_simulada boolean, alterado_por uuid, updated_at timestamptz);
       CREATE TRIGGER forjar AFTER INSERT ON copia FOR EACH ROW
         EXECUTE FUNCTION faturamento.configuracao_filial_depois();
       INSERT INTO copia SELECT id, '${B.id}', filial_id, false, '${randomUUID()}', now() FROM ${CONFIG}
         WHERE filial_id = '${A.filial}';`;
      recusaDetalhada(
        banco.conexao,
        copia,
        '42501',
        /permission denied for function faturamento.configuracao_filial_depois/,
        APP_A,
      );
      // E fora da configuracao_filial a função se recusa a rodar, mesmo presa pelo dono.
      recusaDetalhada(banco.conexao, copia, '42501', /só roda na faturamento.configuracao_filial/);
      expect(historico(A.filial)).toEqual(antes);
    });

    it('titulo.conta_como_real: obrigatória no INSERT (23502); o UPDATE que muda recebe 42501; outra coluna a mantém', () => {
      recusaDetalhada(banco.conexao, sqlTitulo(), '23502', /conta_como_real/, APP_A);
      const padrao = inserirTitulo('false');
      expect(contaComoReal(padrao)).toEqual([{ c: false, v: '2026-12-31' }]);
      const real = inserirTitulo('true');
      expect(contaComoReal(real)).toEqual([{ c: true, v: '2026-12-31' }]);
      for (const [id, novo] of [
        [real, 'false'],
        [padrao, 'true'],
      ] as const) {
        const sql = `UPDATE faturamento.titulo SET conta_como_real = ${novo} WHERE id = '${id}';`;
        recusaDetalhada(banco.conexao, sql, '42501', CONTA_COMO_REAL, APP_A);
        recusaDetalhada(banco.conexao, sql, '42501', CONTA_COMO_REAL, WORKER_A);
        recusaDetalhada(banco.conexao, sql, '42501', CONTA_COMO_REAL);
      }
      executar(
        banco.conexao,
        `UPDATE faturamento.titulo SET vencimento = '2027-01-15' WHERE id = '${real}';`,
        APP_A,
      );
      expect(contaComoReal(real)).toEqual([{ c: true, v: '2027-01-15' }]);
      executar(
        banco.conexao,
        `UPDATE faturamento.titulo SET conta_como_real = true, status = 'cancelado' WHERE id = '${real}';`,
        APP_A,
      );
      expect(contaComoReal(real)).toEqual([{ c: true, v: '2027-01-15' }]);
      // A baixa (gatilho da titulo_baixa) também mantém a coluna.
      executar(
        banco.conexao,
        `INSERT INTO faturamento.titulo_baixa (tenant_id, titulo_id, valor_centavos, usuario_id, forma)
       VALUES (plataforma.tenant_atual(), '${padrao}', 1000, '${A.usuario}', 'pix');`,
        APP_A,
      );
      expect(
        consultar<{ c: boolean; s: string }>(
          banco.conexao,
          `SELECT conta_como_real AS c, status AS s FROM faturamento.titulo WHERE id = '${padrao}'`,
          LEITURA_A,
        ),
      ).toEqual([{ c: false, s: 'baixado' }]);
    });

    it('a 0026 roda de novo sem erro, sem duplicar nada, e as travas continuam valendo', () => {
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      const [r] = consultar<{ gatilhos: number; uq: number }>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
                AND tgrelid IN ('${CONFIG}'::regclass, '${HIST}'::regclass)) AS gatilhos,
              (SELECT count(*)::int FROM pg_constraint WHERE conrelid = '${CONFIG}'::regclass AND contype = 'u') AS uq`,
      );
      // configuracao_filial: tocar_updated_at, antes, depois, sem_exclusao; histórico: tocar_updated_at,
      // somente_insercao, somente_insercao_truncate, antes.
      expect(r).toEqual({ gatilhos: 8, uq: 1 });
      const filial = randomUUID();
      recusaDetalhada(banco.conexao, sqlConfig(filial, 'true', 'NULL'), '23514', SEM_ALTERADO_POR, APP_A);
      executar(banco.conexao, sqlConfig(filial, 'true', `'${A.usuario}'`), APP_A);
      expect(historico(filial)).toEqual([{ anterior: null, novo: true, por: A.usuario }]);
      const id = inserirTitulo('true');
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.titulo SET conta_como_real = false WHERE id = '${id}';`,
        '42501',
        CONTA_COMO_REAL,
        APP_A,
      );
    });
  },
);
