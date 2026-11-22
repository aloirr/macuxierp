/** T-0029, migração 0029. Motivo em docs/banco/README.md (0029). */
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
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0029_estoque_worker.sql', import.meta.url));
const A = novoTenant('estoque-0029-a');
const B = novoTenant('estoque-0029-b');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });

/** O que o consumidor faz (modules/cadastros/api/sql.ts: saldoParaAtualizar e gravarMovimento), numa transação. */
const baixaDoConsumidor = (t: Tenant, quantidade: number, ext: string): string => `
INSERT INTO cadastros.estoque_saldo (tenant_id, filial_id, produto_id, quantidade)
  VALUES (plataforma.tenant_atual(), '${t.filial}', '${t.produto}', 0)
  ON CONFLICT (tenant_id, filial_id, produto_id) DO NOTHING;
SELECT quantidade FROM cadastros.estoque_saldo WHERE filial_id = '${t.filial}' AND produto_id = '${t.produto}' FOR UPDATE;
INSERT INTO cadastros.estoque_movimento (tenant_id, filial_id, produto_id, tipo, quantidade, motivo, usuario_id, external_id, origem_tipo, origem_id)
  VALUES (plataforma.tenant_atual(), '${t.filial}', '${t.produto}', 'saida', ${quantidade}, 'NF-e 1/1', NULL, '${ext}', 'nfe', gen_random_uuid());
UPDATE cadastros.estoque_saldo SET quantidade = quantidade - ${quantidade}
  WHERE filial_id = '${t.filial}' AND produto_id = '${t.produto}';`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — estoque gravado pelo worker (T-0029, 0029)', () => {
  let banco: BancoDeTeste;

  const saldo = (t: Tenant): number =>
    Number(
      consultar<{ qtd: string }>(
        banco.conexao,
        `SELECT quantidade AS qtd FROM cadastros.estoque_saldo WHERE tenant_id = '${t.id}' AND filial_id = '${t.filial}' AND produto_id = '${t.produto}'`,
      )[0]!.qtd,
    );

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('worker igual ao app (movimento só de inserção); leitura só lê; DELETE para ninguém', () => {
    const matriz = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'].map((papel) => ({
      papel,
      saldo: privilegiosDe(banco.conexao, papel, 'cadastros.estoque_saldo'),
      movimento: privilegiosDe(banco.conexao, papel, 'cadastros.estoque_movimento'),
    }));
    expect(matriz).toEqual([
      { papel: 'macuxierp_app', saldo: 'SIU', movimento: 'SI' },
      { papel: 'macuxierp_worker', saldo: 'SIU', movimento: 'SI' },
      { papel: 'macuxierp_leitura', saldo: 'S', movimento: 'S' },
    ]);
    recusaDetalhada(banco.conexao, 'UPDATE cadastros.estoque_movimento SET motivo = motivo;', '42501', /permission denied/, WORKER(A));
  });

  it('sem worker_global no estoque: só a política isolamento_tenant', () => {
    expect(
      consultar<{ t: string; p: string }>(
        banco.conexao,
        `SELECT k.relname AS t, p.polname AS p FROM pg_policy p JOIN pg_class k ON k.oid = p.polrelid
         WHERE k.oid IN ('cadastros.estoque_saldo'::regclass, 'cadastros.estoque_movimento'::regclass) ORDER BY 1, 2`,
      ),
    ).toEqual([
      { t: 'estoque_movimento', p: 'isolamento_tenant' },
      { t: 'estoque_saldo', p: 'isolamento_tenant' },
    ]);
  });

  it('o worker insere o movimento e faz o upsert do saldo no próprio tenant (o caminho do consumidor)', () => {
    const antesB = saldo(B);
    rodarComo(banco.conexao, baixaDoConsumidor(A, 2_000, 'estoque-0029-a-1'), WORKER(A));
    expect(saldo(A)).toBe(100_000 - 2_000);
    expect(saldo(B)).toBe(antesB);
    // Saldo que ainda não existe: o INSERT ... ON CONFLICT cria a linha no tenant da sessão.
    const produto = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao, custo_centavos)
         VALUES ('${produto}', '${A.id}', 'P0029', 'Produto sem saldo', '22021000', 'UN', 'UN', 'padrao', 499);`,
    );
    rodarComo(banco.conexao, baixaDoConsumidor({ ...A, produto }, 500, 'estoque-0029-a-2'), WORKER(A));
    expect(saldo({ ...A, produto })).toBe(-500); // RN-CAD-07: a baixa pela nota nunca trava
    expect(
      consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM cadastros.estoque_movimento WHERE tenant_id = '${A.id}' AND external_id LIKE 'estoque-0029-a-%'`,
      ),
    ).toEqual([{ n: 2 }]);
  });

  it('RLS: o UPDATE do worker no saldo do tenant B atinge 0 linhas; o INSERT no B é recusado', () => {
    const antesB = saldo(B);
    const saida = rodarComo(
      banco.conexao,
      `WITH u AS (UPDATE cadastros.estoque_saldo SET quantidade = 0 WHERE tenant_id = '${B.id}' RETURNING 1) SELECT count(*) FROM u;`,
      WORKER(A),
    );
    expect(numeros(saida)).toEqual([0]);
    expect(saldo(B)).toBe(antesB);
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.estoque_movimento (tenant_id, filial_id, produto_id, tipo, quantidade, motivo)
         VALUES ('${B.id}', '${B.filial}', '${B.produto}', 'saida', 1, 'cruzado');`,
      '42501',
      /row-level security/,
      WORKER(A),
    );
  });

  it('a 0029 roda de novo sem erro e a matriz não muda', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    expect(privilegiosDe(banco.conexao, 'macuxierp_worker', 'cadastros.estoque_saldo')).toBe('SIU');
    expect(privilegiosDe(banco.conexao, 'macuxierp_worker', 'cadastros.estoque_movimento')).toBe('SI');
  });
});
