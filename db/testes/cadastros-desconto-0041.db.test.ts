/**
 * T-0058 (v0.3.6, migração 0041; RN-CAD-11): cadastros.produto.desconto_maximo_bp (integer NULL, CHECK nomeado
 * produto_desconto_maximo_bp_ck: 0 a 10.000 pontos-base) e cadastros.tabela_preco_item.desconto_herdado (boolean NOT NULL
 * DEFAULT false; backfill true onde há external_id). Estrutura, valores aceitos e recusados (gravados pelo app), linhas
 * anteriores à 0041 e reexecução (docs/banco/README.md).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  executar,
  falhaDetalhada,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = '0041_cadastros_produto_desconto_maximo.sql';
const CK = 'produto_desconto_maximo_bp_ck';
const A = novoTenant('desc-0041-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };

/** Produto novo do tenant A; `desconto` = valor SQL da coluna, ou undefined para omiti-la. */
const produto = (codigo: string, desconto?: string): string =>
  `INSERT INTO cadastros.produto (tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel,
     grupo_tributacao, custo_centavos${desconto === undefined ? '' : ', desconto_maximo_bp'})
   VALUES ('${A.id}', '${codigo}', 'Produto ${codigo}', '22021000', 'UN', 'UN', 'padrao', 100${
     desconto === undefined ? '' : `, ${desconto}`
   });`;

let banco0041: BancoDeTeste;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — desconto máximo do produto (T-0058, 0041)', () => {
  beforeAll(() => {
    banco0041 = criarBancoDeTeste();
    migrar(banco0041.conexao, { oficiais: false });
    permitirSetRole(banco0041.conexao);
    executar(banco0041.conexao, fixturePlataforma(A) + fixtureModulos(A));
  });

  afterAll(() => banco0041?.remover());

  it('tipos, nulidade e padrões; o CHECK nomeado existe, está validado e cita 0..10000; as colunas são comentadas', () => {
    const colunas = consultar<{
      coluna: string;
      tipo: string;
      nula: string;
      padrao: string | null;
      comentario: string | null;
    }>(
      banco0041.conexao,
      `SELECT c.column_name AS coluna, c.data_type AS tipo, c.is_nullable AS nula, c.column_default AS padrao,
              col_description(format('%I.%I', c.table_schema, c.table_name)::regclass, c.ordinal_position::int) AS comentario
       FROM information_schema.columns c
       WHERE c.table_schema = 'cadastros' AND (c.table_name, c.column_name) IN
         (('produto', 'desconto_maximo_bp'), ('tabela_preco_item', 'desconto_herdado'))
       ORDER BY c.column_name`,
    );
    expect(colunas).toMatchObject([
      { coluna: 'desconto_herdado', tipo: 'boolean', nula: 'NO', padrao: 'false' },
      { coluna: 'desconto_maximo_bp', tipo: 'integer', nula: 'YES', padrao: null },
    ]);
    for (const c of colunas) expect(c.comentario).toMatch(/RN-CAD-11/);
    const cks = consultar<{ nome: string; validada: boolean; def: string }>(
      banco0041.conexao,
      `SELECT conname AS nome, convalidated AS validada, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'cadastros.produto'::regclass AND conname = '${CK}'`,
    );
    expect(cks).toHaveLength(1);
    expect(cks[0]).toMatchObject({ nome: CK, validada: true });
    expect(cks[0]?.def).toMatch(/desconto_maximo_bp >= 0.*desconto_maximo_bp <= 10000/);
  });

  it('sem a coluna fica NULL; NULL, 0, 1500 e 10000 gravam pelo macuxierp_app', () => {
    executar(
      banco0041.conexao,
      produto('D0') +
        produto('D1', '0') +
        produto('D2', '1500') +
        produto('D3', '10000') +
        produto('D4', 'NULL'),
      APP_A,
    );
    const linhas = consultar<{ codigo: string; d: number | null }>(
      banco0041.conexao,
      `SELECT codigo, desconto_maximo_bp AS d FROM cadastros.produto WHERE codigo LIKE 'D_' ORDER BY codigo`,
      APP_A,
    );
    expect(linhas).toEqual([
      { codigo: 'D0', d: null },
      { codigo: 'D1', d: 0 },
      { codigo: 'D2', d: 1500 },
      { codigo: 'D3', d: 10000 },
      { codigo: 'D4', d: null },
    ]);
    executar(
      banco0041.conexao,
      `UPDATE cadastros.produto SET desconto_maximo_bp = 2500 WHERE codigo = 'D1';`,
      APP_A,
    );
    expect(
      consultar<{ d: number }>(
        banco0041.conexao,
        `SELECT desconto_maximo_bp AS d FROM cadastros.produto WHERE codigo = 'D1'`,
        APP_A,
      ),
    ).toEqual([{ d: 2500 }]);
  });

  it.each(['-1', '10001'])('%s falha com 23514 e o nome do CHECK (insert e update)', (valor) => {
    for (const sql of [
      produto(`X${valor}`, valor),
      `UPDATE cadastros.produto SET desconto_maximo_bp = ${valor} WHERE codigo = 'D2';`,
    ]) {
      const e = falhaDetalhada(() => executar(banco0041.conexao, verboso(sql), APP_A));
      expect({ sql, saida: e.saida }).toMatchObject({ sql, saida: expect.stringMatching(/23514/) });
      expect(e.mensagem).toMatch(new RegExp(CK));
    }
  });

  it('item novo da tabela de preço nasce com desconto_herdado = false; o app grava true e false', () => {
    const herdado = (): boolean[] =>
      consultar<{ h: boolean }>(
        banco0041.conexao,
        `SELECT desconto_herdado AS h FROM cadastros.tabela_preco_item`,
        APP_A,
      ).map((x) => x.h);
    const gravar = (h: boolean): void =>
      executar(banco0041.conexao, `UPDATE cadastros.tabela_preco_item SET desconto_herdado = ${h};`, APP_A);
    expect(herdado()).toEqual([false]);
    gravar(true);
    expect(herdado()).toEqual([true]);
    gravar(false);
    expect(herdado()).toEqual([false]);
  });

  it('a 0041 é reexecutável: rodar o arquivo de novo não dá erro nem duplica as colunas nem o CHECK', () => {
    const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
    rodarScript(banco0041.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
    const [r] = consultar<{ cols: number; cks: number }>(
      banco0041.conexao,
      `SELECT (SELECT count(*)::int FROM pg_attribute
                 WHERE (attrelid, attname) IN (('cadastros.produto'::regclass, 'desconto_maximo_bp'),
                   ('cadastros.tabela_preco_item'::regclass, 'desconto_herdado')) AND NOT attisdropped) AS cols,
              (SELECT count(*)::int FROM pg_constraint
                 WHERE conrelid = 'cadastros.produto'::regclass AND conname = '${CK}') AS cks`,
    );
    expect(r).toEqual({ cols: 2, cks: 1 });
  });
});

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — 0041 sobre produto e tabela de preço já gravados (T-0058)',
  () => {
    let banco: BancoDeTeste;
    let anteriores: PastaDeMigracoes;
    const C = novoTenant('desc-0041-c');
    const APP_C = { papel: 'macuxierp_app', tenant: C.id };
    const itens = `SELECT p.codigo, i.desconto_herdado AS h, i.updated_at::text AS u
    FROM cadastros.tabela_preco_item i JOIN cadastros.produto p ON p.id = i.produto_id
    WHERE i.tenant_id = '${C.id}' ORDER BY p.codigo`;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      anteriores = pastaComMigracoesAntesDe('0041');
    });

    afterAll(() => {
      banco?.remover();
      anteriores?.remover();
    });

    it('produto fica com desconto NULL; item com external_id vira herdado, sem tocar o updated_at; a reexecução não refaz o backfill', () => {
      expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
      executar(
        banco.conexao,
        `${fixturePlataforma(C)}${fixtureModulos(C)}
       WITH p AS (
         INSERT INTO cadastros.produto (tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel,
           grupo_tributacao, custo_centavos, external_id)
         VALUES ('${C.id}', 'P2', 'Produto do FDV', '22021000', 'UN', 'UN', 'padrao', 100, 'fdv-p2') RETURNING id
       )
       INSERT INTO cadastros.tabela_preco_item (tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos, external_id)
         SELECT '${C.id}', t.id, '${C.filial}', p.id, 990, 'fdv-tp-p2'
         FROM p, cadastros.tabela_preco t WHERE t.tenant_id = '${C.id}';`,
      );
      const antes = consultar<{ codigo: string; u: string }>(
        banco.conexao,
        `SELECT p.codigo, i.updated_at::text AS u FROM cadastros.tabela_preco_item i
       JOIN cadastros.produto p ON p.id = i.produto_id WHERE i.tenant_id = '${C.id}' ORDER BY p.codigo`,
      );

      expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
      expect(migrar(banco.conexao, { oficiais: false })).not.toContain(MIGRACAO);
      const [r] = consultar<{ d: (number | null)[] }>(
        banco.conexao,
        `SELECT array_agg(desconto_maximo_bp ORDER BY codigo) AS d FROM cadastros.produto WHERE tenant_id = '${C.id}'`,
      );
      expect(r).toEqual({ d: [null, null] });
      expect(consultar(banco.conexao, itens)).toEqual([
        { codigo: 'P1', h: false, u: antes[0]?.u },
        { codigo: 'P2', h: true, u: antes[1]?.u },
      ]);

      executar(
        banco.conexao,
        `UPDATE cadastros.tabela_preco_item SET desconto_herdado = false WHERE external_id = 'fdv-tp-p2';`,
        APP_C,
      );
      const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
      rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
      expect(consultar<{ h: boolean }>(banco.conexao, itens).map((x) => x.h)).toEqual([false, false]);
    });
  },
);
