/**
 * T-0057 (v0.3.11, cenário B; decisão do Alexandre: "entra nesta"), migração 0051: os limites do schema cadastros
 * passam a ser os do Hub (/integracao/v1). O external_id de toda tabela de cadastros (e o forma_external_id da
 * condicao_pagamento, que segue o external_id desde a 0010) vai de 64 para 200; o código da forma de pagamento
 * (forma_codigo, 0010) vai de 20 para 30. Os CHECKs sem nome da 0004, 0005, 0010 e 0040 saem e entram CHECKs com nome
 * (<tabela>_<coluna>_tamanho). RN-CAD-08 (o external_id é o código da carga: reativa sem duplicar) e RN-CORE-05
 * (escrita idempotente por external_id). Fora do escopo (continuam em 64): plataforma, core, pedido, faturamento,
 * fiscal, integracao_fdv e sefaz_simulador.
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
  falha,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0051_cadastros_limites_hub.sql', import.meta.url));
const A = novoTenant('limites-0051-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const SA = '5a000000-0000-4000-8000-000000000511';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

/** As 23 tabelas do schema cadastros com external_id (0004, 0005 e 0040). */
const TABELAS = [
  'carga_portal',
  'cest',
  'cest_ncm',
  'cfop',
  'classificacao_tributaria',
  'cliente',
  'cliente_contato',
  'cliente_endereco',
  'condicao_pagamento',
  'consulta_externa',
  'cst',
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
] as const;

/** [tabela, coluna, limite] de todos os CHECKs com nome da 0051. */
const LIMITES: ReadonlyArray<readonly [string, string, number]> = [
  ...TABELAS.map((t) => [t, 'external_id', 200] as const),
  ['condicao_pagamento', 'forma_external_id', 200],
  ['condicao_pagamento', 'forma_codigo', 30],
];

/** CHECKs de tamanho (length(<coluna>) <= n) do schema, por tabela e coluna. */
const checksDe = (b: BancoDeTeste, esquema: string) =>
  consultar<{ tabela: string; nome: string; def: string }>(
    b.conexao,
    `SELECT r.relname AS tabela, c.conname AS nome, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE c.contype = 'c' AND n.nspname = '${esquema}'
        AND pg_get_constraintdef(c.oid) ~ 'length\\((external_id|forma_external_id|forma_codigo)\\) <='
`,
  ).sort((x, y) => (x.tabela + ' ' + x.nome < y.tabela + ' ' + y.nome ? -1 : 1));

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — limites do Hub no cadastros (T-0057, 0051)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao);
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}${fixtureModulos(A)}
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0051@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO cadastros.carga_portal (tenant_id, cadastro, modo, superadmin_id)
  VALUES ('${A.id}', 'vendedor', 'adicionar', '${SA}');
UPDATE cadastros.condicao_pagamento SET forma_external_id = 'forma-av', forma_codigo = 'AV', forma_nome = 'À vista'
 WHERE tenant_id = '${A.id}';`,
    );
  });

  afterAll(() => banco?.remover());

  it('cada coluna tem um CHECK só, com nome <tabela>_<coluna>_tamanho e o limite do Hub (200 e 30)', () => {
    const esperado = LIMITES.map(([t, col, n]) => ({
      tabela: t,
      nome: `${t}_${col}_tamanho`,
      def: `CHECK ((length(${col}) <= ${n}))`,
    })).sort((x, y) => (x.tabela + ' ' + x.nome < y.tabela + ' ' + y.nome ? -1 : 1));
    expect(checksDe(banco, 'cadastros')).toEqual(esperado);
  });

  it('200 aceita e 201 recusa no external_id de cada tabela (e no forma_external_id); 30 e 31 no forma_codigo', () => {
    for (const [t, col, n] of LIMITES) {
      // estoque_movimento é só de inserção (somente_insercao): o limite vale no INSERT.
      const gravar = (tamanho: number, letra: string): string =>
        t === 'estoque_movimento'
          ? `INSERT INTO cadastros.estoque_movimento (tenant_id, filial_id, produto_id, tipo, quantidade, motivo,
               external_id) VALUES ('${A.id}', '${A.filial}', '${A.produto}', 'entrada', 1, 'teste 0051',
               repeat('${letra}', ${tamanho}));`
          : `UPDATE cadastros.${t} SET ${col} = repeat('${letra}', ${tamanho})
              WHERE ctid = (SELECT ctid FROM cadastros.${t} ORDER BY ctid LIMIT 1);`;
      executar(banco.conexao, gravar(n, 'a'));
      expect(
        consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM cadastros.${t} WHERE ${col} = repeat('a', ${n})`,
        ),
      ).toEqual([{ n: 1 }]);
      expect({ t, col, erro: falha(() => executar(banco.conexao, gravar(n + 1, 'b'))) }).toMatchObject({
        t,
        col,
        erro: expect.stringContaining(`${t}_${col}_tamanho`),
      });
    }
  });

  it('a carga do portal (macuxierp_app, upsert por external_id) grava e reativa com external_id de 200 (RN-CAD-08)', () => {
    const ext = 'v'.repeat(200);
    const upsert = (nome: string): string =>
      `INSERT INTO cadastros.vendedor (tenant_id, codigo, nome, filial_id, external_id)
         VALUES (plataforma.tenant_atual(), 'V200', '${nome}', '${A.filial}', '${ext}')
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET nome = EXCLUDED.nome, deleted_at = NULL;`;
    executar(banco.conexao, upsert('Vendedor 200'), APP_A);
    executar(banco.conexao, `UPDATE cadastros.vendedor SET deleted_at = now() WHERE external_id = '${ext}';`, APP_A);
    executar(banco.conexao, upsert('Vendedor 200 reativado'), APP_A);
    expect(
      consultar(banco.conexao, `SELECT nome, deleted_at FROM cadastros.vendedor WHERE external_id = '${ext}'`, APP_A),
    ).toEqual([{ nome: 'Vendedor 200 reativado', deleted_at: null }]);

    // A condição com a forma do Hub: forma_external_id de 200 e código de 30.
    executar(
      banco.conexao,
      `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, external_id,
         forma_external_id, forma_codigo, forma_nome)
       VALUES (plataforma.tenant_atual(), 'B30', 'Boleto 30', '15', '{30}', repeat('p', 200), repeat('f', 200),
         repeat('C', 30), 'Boleto');`,
      APP_A,
    );
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE cadastros.condicao_pagamento SET forma_codigo = repeat('C', 31) WHERE codigo = 'B30';`,
          APP_A,
        ),
      ),
    ).toMatch(/condicao_pagamento_forma_codigo_tamanho/);
  });

  it('fora do cadastros nada muda: os outros schemas seguem com o external_id <= 64', () => {
    for (const esquema of ['plataforma', 'core', 'pedido', 'faturamento', 'fiscal', 'integracao_fdv']) {
      const checks = checksDe(banco, esquema);
      expect(checks.length).toBeGreaterThan(0);
      for (const c of checks) expect({ esquema, ...c }).toMatchObject({ def: 'CHECK ((length(external_id) <= 64))' });
    }
  });

  it('sobre o esquema anterior: preserva as linhas, e reexecutar a 0051 não muda nada', () => {
    const antes = pastaComMigracoesAntesDe('0051');
    const b = criarBancoDeTeste();
    try {
      migrar(b.conexao, { pasta: antes.pasta, oficiais: false });
      const B = novoTenant('limites-0051-b');
      executar(
        b.conexao,
        `${fixturePlataforma(B)}${fixtureModulos(B)}
UPDATE cadastros.vendedor SET external_id = repeat('v', 64) WHERE tenant_id = '${B.id}';
UPDATE cadastros.condicao_pagamento SET forma_external_id = repeat('f', 64), forma_codigo = repeat('C', 20)
 WHERE tenant_id = '${B.id}';`,
      );
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(b.conexao, sql, { transacao: true });
      const depois = checksDe(b, 'cadastros');
      rodarScript(b.conexao, sql, { transacao: true });
      expect(checksDe(b, 'cadastros')).toEqual(depois);
      expect(depois).toHaveLength(LIMITES.length);
      expect(depois.every((c) => c.nome.endsWith('_tamanho'))).toBe(true);
      expect(
        consultar(
          b.conexao,
          `SELECT v.external_id = repeat('v', 64) AS v, c.forma_codigo = repeat('C', 20) AS c
             FROM cadastros.vendedor v JOIN cadastros.condicao_pagamento c USING (tenant_id)
            WHERE v.tenant_id = '${B.id}'`,
        ),
      ).toEqual([{ v: true, c: true }]);
    } finally {
      b.remover();
      antes.remover();
    }
  });
});
