/**
 * T-0021, migração 0024: dh_evento, id_lote e fuso_minutos em faturamento.nota_evento, gravados antes de transmitir e
 * imutáveis depois, salvo no reenvio de rejeitado para pendente (T-0018 §8; rejeição 573 no retry). A inutilização fica
 * de fora (o leiaute dela não tem dhEvento, idLote nem fuso). Motivo em docs/banco/README.md.
 */
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
  type PastaDeMigracoes,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import {
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  hashSql,
  novoTenant,
  type Tenant,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0024_evento_dh_lote_fuso.sql', import.meta.url));
const TABELAS = ['nota_evento'] as const;
type TabelaDh = (typeof TABELAS)[number];

interface Valores {
  dh?: string;
  lote?: string;
  fuso?: string;
}

/** Os três valores em SQL (padrão: os três preenchidos; 'NULL' para anular). */
const TRES: Required<Valores> = { dh: `'2026-11-22T14:00:00-04:00'`, lote: '1732298400123', fuso: '-240' };

interface Dh {
  dh: string | null;
  lote: string | null;
  fuso: number | null;
}

const CTX = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });

/** INSERT de uma CC-e pendente, na próxima sequência, no tenant da sessão. */
function sqlInserir(tabela: TabelaDh, t: Tenant, v: Valores | null): string {
  const col = v === null ? '' : ', dh_evento, id_lote, fuso_minutos';
  const val = v === null ? '' : `, ${v.dh ?? 'NULL'}, ${v.lote ?? 'NULL'}, ${v.fuso ?? 'NULL'}`;
  return `INSERT INTO faturamento.${tabela} (tenant_id, nota_id, tipo, n_seq_evento, texto${col})
  SELECT plataforma.tenant_atual(), '${t.nota}', 'cce', coalesce(max(e.n_seq_evento), 0) + 1,
    'Correção do complemento do endereço'${val}
  FROM faturamento.${tabela} e WHERE e.nota_id = '${t.nota}' AND e.tipo = 'cce'
  RETURNING id;`;
}

function inserir(banco: BancoDeTeste, tabela: TabelaDh, t: Tenant, v: Valores | null = TRES): string {
  const id = linhas(rodarComo(banco.conexao, sqlInserir(tabela, t, v), CTX(t))).find((l) =>
    /^[0-9a-f-]{36}$/.test(l),
  );
  if (!id) throw new Error(`INSERT em ${tabela} sem id`);
  return id;
}

function ler(banco: BancoDeTeste, tabela: TabelaDh, id: string, t: Tenant): Dh[] {
  return consultar<Dh>(
    banco.conexao,
    `SELECT to_char(dh_evento AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS dh, id_lote::text AS lote,
       fuso_minutos AS fuso
     FROM faturamento.${tabela} WHERE id = '${id}'`,
    CTX(t),
  );
}

const GRAVADO: Dh = { dh: '2026-11-22T18:00:00', lote: '1732298400123', fuso: -240 };

/** As três de TRES num SET. */
const TRES_SET = `dh_evento = ${TRES.dh}, id_lote = ${TRES.lote}, fuso_minutos = ${TRES.fuso}`;

const T0018 = /T-0018 §8: dh_evento, id_lote e fuso_minutos/;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — dh_evento, id_lote e fuso_minutos (T-0021, 0024)', () => {
  let banco: BancoDeTeste;
  const A = novoTenant('evento-dh-0024-a');

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A) + fixtureFaturamento(A));
  });

  afterAll(() => banco?.remover());

  it('colunas anuláveis com os tipos pedidos e CHECKs com nomes estáveis, validados; a inutilização sem elas', () => {
    const cols = consultar<{ tabela: string; coluna: string; tipo: string; nulo: boolean }>(
      banco.conexao,
      `SELECT c.relname AS tabela, a.attname AS coluna, format_type(a.atttypid, a.atttypmod) AS tipo,
         NOT a.attnotnull AS nulo
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       WHERE c.oid IN ('faturamento.nota_evento'::regclass, 'faturamento.inutilizacao'::regclass)
         AND NOT a.attisdropped AND a.attname IN ('dh_evento', 'id_lote', 'fuso_minutos')
       ORDER BY 1, a.attnum`,
    );
    expect(cols).toEqual([
      { tabela: 'nota_evento', coluna: 'dh_evento', tipo: 'timestamp with time zone', nulo: true },
      { tabela: 'nota_evento', coluna: 'id_lote', tipo: 'bigint', nulo: true },
      { tabela: 'nota_evento', coluna: 'fuso_minutos', tipo: 'smallint', nulo: true },
    ]);
    const cons = consultar<{ nome: string; validado: boolean }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validado FROM pg_constraint
       WHERE conrelid IN ('faturamento.nota_evento'::regclass, 'faturamento.inutilizacao'::regclass)
         AND conname ~ '_(dh_lote_fuso_juntos|id_lote|fuso_minutos)_ck$'
       ORDER BY 1`,
    );
    expect(cons).toEqual(
      ['nota_evento_dh_lote_fuso_juntos_ck', 'nota_evento_fuso_minutos_ck', 'nota_evento_id_lote_ck'].map(
        (nome) => ({ nome, validado: true }),
      ),
    );
  });

  it('as linhas da massa (gravadas sem os três) continuam com os três nulos', () => {
    const r = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM faturamento.nota_evento WHERE num_nulls(dh_evento, id_lote, fuso_minutos) = 3`,
    );
    expect(r).toEqual([{ n: 1 }]);
  });

  describe.each(TABELAS)('faturamento.%s', (tabela) => {
    it('o INSERT com os três passa e grava os valores', () => {
      const id = inserir(banco, tabela, A);
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
    });

    it('o INSERT com só um ou dois dos três cai no CHECK das três juntas', () => {
      for (const v of [
        { dh: TRES.dh },
        { lote: TRES.lote },
        { fuso: TRES.fuso },
        { dh: TRES.dh, lote: TRES.lote },
        { lote: TRES.lote, fuso: TRES.fuso },
        { dh: TRES.dh, fuso: TRES.fuso },
      ]) {
        recusaDetalhada(
          banco.conexao,
          sqlInserir(tabela, A, v),
          '23514',
          new RegExp(`${tabela}_dh_lote_fuso_juntos_ck`),
          CTX(A),
        );
      }
    });

    it('id_lote 0 (e acima de 15 dígitos) e fuso 841 (e −721) caem nos CHECKs', () => {
      for (const [v, ck] of [
        [{ lote: '0' }, 'id_lote'],
        [{ lote: '1000000000000000' }, 'id_lote'],
        [{ fuso: '841' }, 'fuso_minutos'],
        [{ fuso: '-721' }, 'fuso_minutos'],
      ] as const) {
        recusaDetalhada(
          banco.conexao,
          sqlInserir(tabela, A, { ...TRES, ...v }),
          '23514',
          new RegExp(`${tabela}_${ck}_ck`),
          CTX(A),
        );
      }
      // Os extremos passam.
      inserir(banco, tabela, A, { ...TRES, lote: '999999999999999', fuso: '840' });
      inserir(banco, tabela, A, { ...TRES, lote: '1', fuso: '-720' });
    });

    it('o UPDATE de status (rejeitado e de volta) mantém os três', () => {
      const id = inserir(banco, tabela, A);
      executar(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET status = 'rejeitado', c_stat = 573, x_motivo = 'Duplicidade de evento'
         WHERE id = '${id}';`,
        CTX(A),
      );
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
      executar(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET status = 'pendente' WHERE id = '${id}';`,
        CTX(A),
      );
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
    });

    it('o reenvio (rejeitado para pendente no mesmo UPDATE) troca as três por outras três', () => {
      const id = inserir(banco, tabela, A);
      const rejeitar = `UPDATE faturamento.${tabela} SET status = 'rejeitado', c_stat = 578,
        x_motivo = 'Data/hora do evento no futuro' WHERE id = '${id}';`;
      const novos = `dh_evento = '2026-11-22T15:30:00-04:00', id_lote = 1732303800456, fuso_minutos = -180`;
      executar(banco.conexao, rejeitar, CTX(A));
      // Rejeitado para pendente com nulo cai: as três não voltam a nulo nem no reenvio.
      for (const set of ['dh_evento = NULL, id_lote = NULL, fuso_minutos = NULL', 'id_lote = NULL']) {
        recusaDetalhada(
          banco.conexao,
          `UPDATE faturamento.${tabela} SET status = 'pendente', ${set} WHERE id = '${id}';`,
          '23514',
          T0018,
          CTX(A),
        );
      }
      executar(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET status = 'pendente', ${novos} WHERE id = '${id}';`,
        CTX(A),
      );
      expect(ler(banco, tabela, id, A)).toEqual([
        { dh: '2026-11-22T19:30:00', lote: '1732303800456', fuso: -180 },
      ]);
      // Pendente para pendente com valores novos cai.
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET status = 'pendente', ${TRES_SET} WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(A),
      );
      // Rejeitado sem voltar a pendente (só a rejeição de novo) também não troca.
      executar(banco.conexao, rejeitar, CTX(A));
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET ${TRES_SET} WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(A),
      );
    });

    it('o registro pelo XML guardado (gatilho AFTER da nota_xml) mantém os três', () => {
      const id = inserir(banco, tabela, A);
      const xml = `<proc>${tabela} ${id}</proc>`;
      executar(
        banco.conexao,
        `INSERT INTO faturamento.nota_xml (tenant_id, tipo, evento_id, protocolo, xml, sha256)
         VALUES (plataforma.tenant_atual(), 'evento_cce', '${id}', '113260000000099', '${xml}', ${hashSql(xml)});`,
        CTX(A),
      );
      expect(
        consultar<{ s: string }>(
          banco.conexao,
          `SELECT status AS s FROM faturamento.${tabela} WHERE id = '${id}'`,
          CTX(A),
        ),
      ).toEqual([{ s: 'registrado' }]);
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
    });

    it('o UPDATE que muda dh_evento, id_lote ou fuso_minutos cai (check_violation, T-0018 §8), dono incluso', () => {
      const id = inserir(banco, tabela, A);
      for (const set of [
        `dh_evento = dh_evento + interval '1 second'`,
        'id_lote = id_lote + 1',
        'fuso_minutos = -180',
        `dh_evento = now(), id_lote = 42, fuso_minutos = 0`,
      ]) {
        const sql = `UPDATE faturamento.${tabela} SET ${set} WHERE id = '${id}';`;
        recusaDetalhada(banco.conexao, sql, '23514', T0018, CTX(A));
        recusaDetalhada(banco.conexao, sql, '23514', T0018);
      }
      // Regravar os mesmos valores (a mesma transação de envio repetida) não é mudança.
      executar(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET dh_evento = dh_evento, id_lote = id_lote, fuso_minutos = fuso_minutos
         WHERE id = '${id}';`,
        CTX(A),
      );
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
    });

    it('o UPDATE de valor para nulo cai (as três ou uma só)', () => {
      const id = inserir(banco, tabela, A);
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET dh_evento = NULL, id_lote = NULL, fuso_minutos = NULL WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(A),
      );
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET id_lote = NULL WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(A),
      );
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
    });

    it('a linha com os três nulos recebe os valores uma vez (as três juntas) e depois fica travada', () => {
      const id = inserir(banco, tabela, A, null);
      expect(ler(banco, tabela, id, A)).toEqual([{ dh: null, lote: null, fuso: null }]);
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET id_lote = ${TRES.lote} WHERE id = '${id}';`,
        '23514',
        new RegExp(`${tabela}_dh_lote_fuso_juntos_ck`),
        CTX(A),
      );
      executar(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET ${TRES_SET}
         WHERE id = '${id}';`,
        CTX(A),
      );
      expect(ler(banco, tabela, id, A)).toEqual([GRAVADO]);
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET dh_evento = now(), id_lote = 7, fuso_minutos = -240 WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(A),
      );
    });

    it('a linha registrada sem os três não os recebe depois (registrado não muda)', () => {
      const [r] = consultar<{ id: string }>(
        banco.conexao,
        `SELECT id FROM faturamento.${tabela} WHERE status = 'registrado' AND dh_evento IS NULL LIMIT 1`,
        CTX(A),
      );
      expect(r).toBeDefined();
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET ${TRES_SET}
         WHERE id = '${r?.id}';`,
        '42501',
        /não muda/,
        CTX(A),
      );
    });
  });

  it('a 0024 roda de novo sem erro, sem duplicar constraints, e a trava continua valendo', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    const [r] = consultar<{ cons: number }>(
      banco.conexao,
      `SELECT count(*)::int AS cons FROM pg_constraint
       WHERE conrelid = 'faturamento.nota_evento'::regclass
         AND (pg_get_constraintdef(oid) LIKE '%num_nulls(dh_evento%' OR pg_get_constraintdef(oid) LIKE '%id_lote%'
           OR pg_get_constraintdef(oid) LIKE '%fuso_minutos%')`,
    );
    expect(r).toEqual({ cons: 3 });
    for (const tabela of TABELAS) {
      const id = inserir(banco, tabela, A);
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET id_lote = 5 WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(A),
      );
    }
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0024 sobre o evento pendente de antes (T-0021)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  const C = novoTenant('evento-dh-0024-c');

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0024');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('a linha pendente de antes da 0024 recebe os três uma vez e depois fica travada', () => {
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(
      '0024_evento_dh_lote_fuso.sql',
    );
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(C) + fixtureModulos(C) + fixtureFaturamento(C, true));
    const ids = Object.fromEntries(TABELAS.map((t) => [t, inserir(banco, t, C, null)])) as Record<
      TabelaDh,
      string
    >;

    expect(migrar(banco.conexao, { oficiais: false })).toContain('0024_evento_dh_lote_fuso.sql');
    const [v] = consultar<{ invalidas: number }>(
      banco.conexao,
      `SELECT count(*)::int AS invalidas FROM pg_constraint
       WHERE conrelid = 'faturamento.nota_evento'::regclass AND NOT convalidated`,
    );
    expect(v).toEqual({ invalidas: 0 });

    for (const tabela of TABELAS) {
      const id = ids[tabela];
      expect(ler(banco, tabela, id, C)).toEqual([{ dh: null, lote: null, fuso: null }]);
      executar(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET ${TRES_SET}
         WHERE id = '${id}';`,
        CTX(C),
      );
      expect(ler(banco, tabela, id, C)).toEqual([GRAVADO]);
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET dh_evento = now() WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(C),
      );
      recusaDetalhada(
        banco.conexao,
        `UPDATE faturamento.${tabela} SET fuso_minutos = NULL WHERE id = '${id}';`,
        '23514',
        T0018,
        CTX(C),
      );
    }
  });
});
