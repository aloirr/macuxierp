/**
 * T-0057 (v0.3.18), migração 0074: cadastros.entrada_forma guarda a forma de pagamento do lote /entrada/v1 para o
 * prazo_pagamento que chega depois (RN-CAD-09). Worker com SELECT, INSERT e UPDATE (sem DELETE) e o único
 * (tenant_id, external_id) do upsert; app só SELECT desde a 0075 (v0.3.19). Motivo em docs/banco/README.md (0074). Dados fictícios.
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
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  privilegiosDe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0074_cadastros_entrada_forma.sql', import.meta.url));
const MIGRACAO_0075 = fileURLToPath(new URL('../migrations/0075_cadastros_entrada_forma_app_leitura.sql', import.meta.url));
const A = novoTenant('forma-0074-a');
const B = novoTenant('forma-0074-b');
const WORKER = (t: Tenant) => ({ papel: 'macuxierp_worker', tenant: t.id });
const APP = (t: Tenant) => ({ papel: 'macuxierp_app', tenant: t.id });

/** O upsert do worker: chave (tenant_id, external_id), a mesma da busca do prazo_pagamento. */
const upsert = (ext: string, nome: string, conector = 'entrada-forma-0074-a') =>
  `INSERT INTO cadastros.entrada_forma (tenant_id, conector_id, external_id, codigo, nome, tpag)
     VALUES (plataforma.tenant_atual(), '${conector}', '${ext}', 'BOL', '${nome}', '15')
   ON CONFLICT (tenant_id, external_id) DO UPDATE SET conector_id = EXCLUDED.conector_id, codigo = EXCLUDED.codigo,
     nome = EXCLUDED.nome, tpag = EXCLUDED.tpag, ativo = true, deleted_at = NULL;`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — cadastros.entrada_forma (T-0057, 0074)', () => {
  let banco: BancoDeTeste;
  /** Privilégios de app, worker e leitura na tabela: S (0075), SIU e S, sem DELETE nem TRUNCATE. */
  const PRIV = () => ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'].map((p) => privilegiosDe(banco.conexao, p, 'cadastros.entrada_forma'));

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n'));
  });

  afterAll(() => banco?.remover());

  it('privilégios: app S (0075), worker SIU, leitura S; ninguém com DELETE nem TRUNCATE', () => {
    expect(PRIV()).toEqual(['S', 'SIU', 'S']);
  });

  it('0075: o upsert do app dá 42501 (quem grava é o worker)', () => {
    recusaDetalhada(banco.conexao, upsert('FP-APP', 'Boleto'), '42501', /permission denied/, APP(A));
  });

  it('o worker grava pelo upsert e o reenvio da mesma forma atualiza a linha (único tenant_id, external_id)', () => {
    rodarComo(banco.conexao, upsert('FP-73', 'Boleto'), WORKER(A));
    rodarComo(banco.conexao, upsert('FP-73', 'Boleto novo', 'entrada-forma-0074-x'), WORKER(A));
    const [l] = consultar<{ n: number; nome: string; conector: string }>(
      banco.conexao,
      `SELECT count(*)::int AS n, max(nome) AS nome, max(conector_id) AS conector FROM cadastros.entrada_forma
        WHERE external_id = 'FP-73'`,
    );
    expect(l).toEqual({ n: 1, nome: 'Boleto novo', conector: 'entrada-forma-0074-x' });
    // o mesmo external_id em outro tenant é outra forma
    rodarComo(banco.conexao, upsert('FP-73', 'Boleto B'), WORKER(B));
    const [t] = consultar<{ n: number }>(banco.conexao, `SELECT count(*)::int AS n FROM cadastros.entrada_forma WHERE external_id = 'FP-73'`);
    expect(t?.n).toBe(2);
  });

  it('o único vale também para a linha apagada (deleted_at): o reenvio revive a forma, sem duplicar', () => {
    rodarComo(banco.conexao, `UPDATE cadastros.entrada_forma SET deleted_at = now(), ativo = false WHERE external_id = 'FP-73';`, WORKER(A));
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.entrada_forma (tenant_id, conector_id, external_id, codigo, nome)
         VALUES (plataforma.tenant_atual(), 'entrada-forma-0074-a', 'FP-73', 'BOL', 'Duplicada');`,
      '23505',
      /entrada_forma_upsert_uq/,
      WORKER(A),
    );
    rodarComo(banco.conexao, upsert('FP-73', 'Boleto de volta'), WORKER(A));
    const n = numeros(
      rodarComo(banco.conexao, `SELECT count(*) FROM cadastros.entrada_forma WHERE external_id = 'FP-73' AND deleted_at IS NULL AND ativo;`, WORKER(A)),
    );
    expect(n).toEqual([1]);
  });

  it('CHECKs: tpag com 2 dígitos (ou nulo), nome até 60, código até 30', () => {
    for (const [col, val] of [['tpag', "'1'"], ['nome', "repeat('n', 61)"], ['codigo', "repeat('c', 31)"]] as const) {
      recusaDetalhada(
        banco.conexao,
        `UPDATE cadastros.entrada_forma SET ${col} = ${val} WHERE external_id = 'FP-73';`,
        '23514',
        new RegExp(`entrada_forma_${col}_check`),
        WORKER(A),
      );
    }
    expect(numeros(rodarComo(banco.conexao, `WITH u AS (UPDATE cadastros.entrada_forma SET tpag = NULL WHERE external_id = 'FP-73' RETURNING 1) SELECT count(*) FROM u;`, WORKER(A)))).toEqual([1]);
  });

  it('RN-CAD-16: o worker lê o cliente', () => {
    // SELECT da 0004; a contagem é provada em completar-prazos-medios.db.test.ts
    expect(privilegiosDe(banco.conexao, 'macuxierp_worker', 'cadastros.cliente')).toBe('SIU');
  });

  it('a 0074 e a 0075 rodam de novo sem erro, sem ampliar privilégio e com um único índice de external_id', () => {
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    rodarScript(banco.conexao, readFileSync(MIGRACAO_0075, 'utf8'), { transacao: true });
    expect(PRIV()).toEqual(['S', 'SIU', 'S']);
    const idx = consultar<{ i: string }>(
      banco.conexao,
      `SELECT indexname AS i FROM pg_indexes WHERE schemaname = 'cadastros' AND tablename = 'entrada_forma' ORDER BY 1`,
    );
    expect(idx.map((x) => x.i)).toEqual(['entrada_forma_pkey', 'entrada_forma_tenant_id_uq', 'entrada_forma_upsert_uq']);
  });
});
