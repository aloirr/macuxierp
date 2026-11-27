/**
 * T-0092 (ADR 0019, opção A; migração 0054): os CHECKs de tamanho do cadastros alargados para os limites do Hub
 * (hub-v1 do SDK): external_id e forma_external_id até 200 (eram 64) e forma_codigo até 30 (era 20). O banco sobe até a
 * 0053 com a massa no limite antigo (o legado), depois recebe a 0054, que não reescreve dado (docs/banco/README.md).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falhaDetalhada,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  type PastaDeMigracoes,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixtureEntrada, fixtureEntradaForma, fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = '0054_cadastros_limites_hub.sql';
const A = novoTenant('limites-0054');
const SA = '5a000000-0000-4000-8000-000000000541';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

/** [tabela, coluna, limite novo]: todas as do schema cadastros com external_id, mais as duas colunas da forma. */
const ALARGADAS: readonly (readonly [string, string, number])[] = [
  ...[
    'carga_portal',
    'cest',
    'cest_ncm',
    'cfop',
    'classificacao_tributaria',
    'cliente',
    'cliente_contato',
    'cliente_endereco',
    'cnae', // 0066 (T-0106): nasce com 200
    'condicao_pagamento',
    'consulta_externa',
    'cst',
    // 0071 (T-0057): as quatro da entrada nascem com 200, como o resto do cadastros
    'entrada_credencial',
    'entrada_cursor',
    'entrada_forma', // 0074 (T-0057): nasce com 200
    'entrada_lote',
    'entrada_sinal',
    'estoque_movimento',
    'estoque_saldo',
    'filial',
    'municipio',
    'ncm',
    'produto',
    'produto_unidade',
    'tabela_oficial_versao',
    'tabela_preco',
    'tabela_preco_item',
    'uf',
    'vendedor',
  ].map((t) => [t, 'external_id', 200] as const),
  ['condicao_pagamento', 'forma_external_id', 200],
  ['condicao_pagamento', 'forma_codigo', 30],
];

/** Tabela só de inserção: o teste grava uma cópia da linha da massa, com id novo. */
const SO_INSERCAO = new Set(['estoque_movimento']);

/** Grava `tamanho` caracteres na coluna de uma linha da tabela (como o admin da migração). */
const gravarSql = (tabela: string, coluna: string, tamanho: number): string =>
  SO_INSERCAO.has(tabela)
    ? `INSERT INTO cadastros.${tabela}
         SELECT (jsonb_populate_record(m, jsonb_build_object('id', gen_random_uuid(), '${coluna}', repeat('x', ${tamanho})))).*
           FROM cadastros.${tabela} m LIMIT 1;`
    : `UPDATE cadastros.${tabela} SET ${coluna} = repeat('x', ${tamanho})
        WHERE ctid = (SELECT ctid FROM cadastros.${tabela} LIMIT 1);`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — limites do Hub no cadastros (T-0092, 0054)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes | undefined;
  const checks = (): { tabela: string; nome: string; def: string; validado: boolean }[] =>
    consultar(
      banco.conexao,
      `SELECT c.relname AS tabela, k.conname AS nome, pg_get_constraintdef(k.oid) AS def, k.convalidated AS validado
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relnamespace = 'cadastros'::regnamespace AND k.contype = 'c'
          AND pg_get_constraintdef(k.oid) ~ '^CHECK \\(\\(length\\((external_id|forma_external_id|forma_codigo)\\) <= '
        ORDER BY 1, 2`,
    );

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0054');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    // Legado no limite antigo: 64 no external_id e no forma_external_id, 20 no forma_codigo.
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}${fixtureModulos(A)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0054@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO cadastros.carga_portal (tenant_id, cadastro, modo, superadmin_id) VALUES ('${A.id}', 'produto', 'adicionar', '${SA}');
UPDATE cadastros.cliente SET external_id = repeat('v', 64);
UPDATE cadastros.condicao_pagamento SET forma_external_id = repeat('f', 64), forma_codigo = repeat('c', 20);`,
    );
    // A 0054 e a carga das tabelas oficiais (cest, ncm, municipio... ganham linhas para o teste de cada tabela).
    expect(migrar(banco.conexao, { oficiais: true })).toContain(MIGRACAO);
    executar(banco.conexao, fixtureEntrada(A) + fixtureEntradaForma(A));
  }, 300_000);

  afterAll(() => {
    anteriores?.remover();
    banco?.remover();
  });

  it('(a) cada CHECK alargado tem o nome de sempre, está validado e nenhum do cadastros ficou em 64 ou 20', () => {
    expect(checks()).toEqual(
      [...ALARGADAS]
        .map(([tabela, coluna, limite]) => ({
          tabela,
          nome: `${tabela}_${coluna}_check`,
          def: `CHECK ((length(${coluna}) <= ${limite}))`,
          validado: true,
        }))
        .sort((x, y) => (x.tabela === y.tabela ? (x.nome < y.nome ? -1 : 1) : x.tabela < y.tabela ? -1 : 1)),
    );
    // fora do cadastros segue em 64 (não recebe chave do Hub)
    const [fora] = consultar<{ def: string }>(
      banco.conexao,
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'pedido_external_id_check'
          AND conrelid = 'pedido.pedido'::regclass`,
    );
    expect(fora?.def).toBe('CHECK ((length(external_id) <= 64))');
  });

  it('(b) o legado no limite antigo fica como estava (sem reescrita)', () => {
    expect(
      consultar(
        banco.conexao,
        `SELECT (SELECT external_id FROM cadastros.cliente LIMIT 1) = repeat('v', 64) AS cliente,
                forma_external_id = repeat('f', 64) AS forma_external_id, forma_codigo = repeat('c', 20) AS forma_codigo
           FROM cadastros.condicao_pagamento`,
      ),
    ).toEqual([{ cliente: true, forma_external_id: true, forma_codigo: true }]);
  });

  it('(c) em cada tabela tocada o limite passa e um a mais cai em 23514 no CHECK da coluna', () => {
    for (const [tabela, coluna, limite] of ALARGADAS) {
      const e = falhaDetalhada(() => executar(banco.conexao, verboso(gravarSql(tabela, coluna, limite + 1))));
      expect({
        tabela,
        coluna,
        codigo: e.saida.includes('23514'),
        check: e.saida.includes(`${tabela}_${coluna}_check`),
      }).toEqual({ tabela, coluna, codigo: true, check: true });
      executar(banco.conexao, gravarSql(tabela, coluna, limite));
      const [n] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM cadastros.${tabela} WHERE length(${coluna}) = ${limite}`,
      );
      expect({ tabela, coluna, gravadas: n?.n }).toEqual({ tabela, coluna, gravadas: 1 });
    }
  });

  it('(d) reexecutar a 0054 não muda CHECK nem dado', () => {
    const migracao = listarMigracoes().find((m) => m.nome === MIGRACAO);
    const antes = checks();
    rodarScript(banco.conexao, readFileSync(migracao!.caminho, 'utf8'), { transacao: true });
    expect(checks()).toEqual(antes);
  });
});
