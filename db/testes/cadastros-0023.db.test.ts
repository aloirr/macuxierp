/**
 * T-0021 (migração 0023, recado R-20261122-020606): cadastros.filial.regime_pis_cofins (text, nulo, CHECK nomeado
 * filial_regime_pis_cofins_ck: cumulativo ou nao_cumulativo) e cadastros.produto.producao_propria (boolean NOT NULL
 * DEFAULT false). Estrutura, valores aceitos e recusados (gravados pelo app), linhas anteriores à 0023 e reexecução
 * (docs/banco/README.md).
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

const MIGRACAO = '0023_filial_regime_pis_produto_producao_propria.sql';
const CK = 'filial_regime_pis_cofins_ck';
const A = novoTenant('pis-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };

/** Produto novo do tenant A; `producao` = valor SQL da coluna, ou undefined para omiti-la. */
const produto = (codigo: string, producao?: string): string =>
  `INSERT INTO cadastros.produto (tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel,
     grupo_tributacao, custo_centavos${producao === undefined ? '' : ', producao_propria'})
   VALUES ('${A.id}', '${codigo}', 'Produto ${codigo}', '22021000', 'UN', 'UN', 'padrao', 100${
     producao === undefined ? '' : `, ${producao}`
   });`;

const regimeDaFilial = (): (string | null)[] =>
  consultar<{ r: string | null }>(
    banco0023.conexao,
    `SELECT regime_pis_cofins AS r FROM cadastros.filial WHERE id = '${A.filial}'`,
    APP_A,
  ).map((x) => x.r);

let banco0023: BancoDeTeste;

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — regime do PIS/COFINS e produção própria (T-0021, 0023)',
  () => {
    beforeAll(() => {
      banco0023 = criarBancoDeTeste();
      migrar(banco0023.conexao, { oficiais: false });
      permitirSetRole(banco0023.conexao);
      executar(banco0023.conexao, fixturePlataforma(A) + fixtureModulos(A));
    });

    afterAll(() => banco0023?.remover());

    it('tipos, nulidade e padrões; o CHECK nomeado existe e está validado', () => {
      const colunas = consultar<{
        tabela: string;
        nome: string;
        tipo: string;
        nula: string;
        padrao: string | null;
      }>(
        banco0023.conexao,
        `SELECT table_name AS tabela, column_name AS nome, data_type AS tipo, is_nullable AS nula,
              column_default AS padrao
       FROM information_schema.columns
       WHERE table_schema = 'cadastros' AND (table_name, column_name) IN
         (('filial', 'regime_pis_cofins'), ('produto', 'producao_propria'))
       ORDER BY table_name`,
      );
      expect(colunas).toEqual([
        { tabela: 'filial', nome: 'regime_pis_cofins', tipo: 'text', nula: 'YES', padrao: null },
        { tabela: 'produto', nome: 'producao_propria', tipo: 'boolean', nula: 'NO', padrao: 'false' },
      ]);
      const cks = consultar<{ nome: string; validada: boolean }>(
        banco0023.conexao,
        `SELECT conname AS nome, convalidated AS validada FROM pg_constraint
       WHERE conrelid = 'cadastros.filial'::regclass AND conname = '${CK}'`,
      );
      expect(cks).toEqual([{ nome: CK, validada: true }]);
    });

    it.each(['cumulativo', 'nao_cumulativo', null])(
      '%s passa no regime da filial (o app grava)',
      (regime) => {
        executar(
          banco0023.conexao,
          `UPDATE cadastros.filial SET regime_pis_cofins = ${regime === null ? 'NULL' : `'${regime}'`} WHERE id = '${A.filial}';`,
          APP_A,
        );
        expect(regimeDaFilial()).toEqual([regime]);
      },
    );

    it("'outro' falha com 23514 e o nome do CHECK", () => {
      const e = falhaDetalhada(() =>
        executar(
          banco0023.conexao,
          verboso(`UPDATE cadastros.filial SET regime_pis_cofins = 'outro' WHERE id = '${A.filial}';`),
          APP_A,
        ),
      );
      expect(e.saida).toMatch(/23514/);
      expect(e.mensagem).toMatch(new RegExp(CK));
    });

    it('produto sem producao_propria fica false; com true grava (o app); null falha com 23502', () => {
      executar(banco0023.conexao, produto('P2') + produto('P3', 'true'), APP_A);
      const linhas = consultar<{ codigo: string; p: boolean }>(
        banco0023.conexao,
        `SELECT codigo, producao_propria AS p FROM cadastros.produto WHERE codigo IN ('P2', 'P3') ORDER BY codigo`,
        APP_A,
      );
      expect(linhas).toEqual([
        { codigo: 'P2', p: false },
        { codigo: 'P3', p: true },
      ]);
      const e = falhaDetalhada(() => executar(banco0023.conexao, verboso(produto('P4', 'NULL')), APP_A));
      expect(e.saida).toMatch(/23502/);
      expect(e.mensagem).toMatch(/producao_propria/);
    });

    it('a 0023 é reexecutável: rodar o arquivo de novo não dá erro nem duplica colunas nem o CHECK', () => {
      const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
      rodarScript(banco0023.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
      const [r] = consultar<{ cols: number; cks: number }>(
        banco0023.conexao,
        `SELECT (SELECT count(*)::int FROM pg_attribute
                 WHERE (attrelid = 'cadastros.filial'::regclass AND attname = 'regime_pis_cofins'
                     OR attrelid = 'cadastros.produto'::regclass AND attname = 'producao_propria')
                   AND NOT attisdropped) AS cols,
              (SELECT count(*)::int FROM pg_constraint
                 WHERE conrelid = 'cadastros.filial'::regclass AND conname = '${CK}') AS cks`,
      );
      expect(r).toEqual({ cols: 2, cks: 1 });
    });
  },
);

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0023 sobre filial e produto já gravados (T-0021)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  const C = novoTenant('pis-c');

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0023');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('as linhas de antes da 0023 ficam com producao_propria = false e regime nulo', () => {
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    executar(banco.conexao, fixturePlataforma(C) + fixtureModulos(C));
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
    expect(migrar(banco.conexao, { oficiais: false })).not.toContain(MIGRACAO);
    const [r] = consultar<{ regime: string | null; producao: boolean[] }>(
      banco.conexao,
      `SELECT (SELECT regime_pis_cofins FROM cadastros.filial WHERE id = '${C.filial}') AS regime,
              (SELECT array_agg(producao_propria) FROM cadastros.produto WHERE tenant_id = '${C.id}') AS producao`,
    );
    expect(r).toEqual({ regime: null, producao: [false] });
  });
});
