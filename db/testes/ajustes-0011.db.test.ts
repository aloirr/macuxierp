/**
 * T-0043 (migração 0011): a filial do aviso do A1 é a do certificado (FK composta), o CHECK de dias da RN-CORE-06
 * (teto 30, sem piso) e o índice (tenant_id, agregado_id, versao) da versão por agregado em plataforma.evento (T-0034).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
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

const MIGRACAO = fileURLToPath(new URL('../migrations/0011_aviso_a1_e_versao_evento.sql', import.meta.url));
const A = novoTenant('ajustes-0011-a');
const B = novoTenant('ajustes-0011-b');
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — ajustes do aviso do A1 e versão do evento (T-0043, 0011)', () => {
  let banco: BancoDeTeste;
  let cert: string;

  /** O INSERT do DestinoAvisos.registrarA1, como o worker no tenant A. */
  const aviso = (filial: string, dias: number, dia: string): string =>
    `INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia)
     VALUES (plataforma.tenant_atual(), '${cert}', '${filial}', '2026-12-03T00:00:00Z', ${dias}, '${dia}')
     ON CONFLICT (tenant_id, certificado_id, dia) DO NOTHING;`;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A));
    const [c] = consultar<{ id: string }>(banco.conexao, `SELECT id FROM core.certificado WHERE tenant_id = '${A.id}'`);
    cert = c!.id;
  });

  afterAll(() => banco?.remover());

  it('a filial do aviso tem de ser a do certificado (FK composta); a do certificado grava', () => {
    expect(falha(() => executar(banco.conexao, aviso(randomUUID(), 12, '2026-11-21'), WORKER_A))).toMatch(
      /aviso_a1_certificado_filial_fk/,
    );
    executar(banco.conexao, aviso(A.filial, 12, '2026-11-21'), WORKER_A);
    const [n] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM core.aviso_a1 WHERE dia = '2026-11-21' AND filial_id = '${A.filial}'`,
    );
    expect(n?.n).toBe(1);
  });

  it('RN-CORE-06: dias acima de 30 é recusado; 30, zero e vencido (negativo) gravam', () => {
    expect(falha(() => executar(banco.conexao, aviso(A.filial, 31, '2026-11-22'), WORKER_A))).toMatch(
      /aviso_a1_dias_janela/,
    );
    executar(banco.conexao, aviso(A.filial, 30, '2026-11-22'), WORKER_A);
    executar(banco.conexao, aviso(A.filial, 0, '2026-11-23'), WORKER_A);
    executar(banco.conexao, aviso(A.filial, -400, '2026-11-24'), WORKER_A);
  });

  it('o índice (tenant_id, agregado_id, versao) existe, não é único, e o max(versao) da T-0034 usa ele', () => {
    const [ix] = consultar<{ def: string; unico: boolean }>(
      banco.conexao,
      `SELECT pg_get_indexdef(i.indexrelid) AS def, i.indisunique AS unico FROM pg_index i
       WHERE i.indexrelid = 'plataforma.evento_agregado_versao_idx'::regclass`,
    );
    expect(ix?.unico).toBe(false);
    expect(ix?.def).toMatch(/\(tenant_id, agregado_id, versao\)$/);
    const plano = rodarScript(
      banco.conexao,
      `SET enable_seqscan = off;
       EXPLAIN (COSTS OFF) SELECT coalesce(max(versao), 0) + 1 AS versao FROM plataforma.evento
         WHERE tenant_id = '${A.id}' AND agregado_id = '${A.cliente}';`,
    );
    expect(plano).toMatch(/evento_agregado_versao_idx/);
  });

  it('a migração roda de novo sem erro, sem duplicar constraint nem índice, e a FK antiga segue fora', () => {
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    const [r] = consultar<{ cons: number; ix: number }>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conname IN
                ('certificado_tenant_id_filial_uq', 'aviso_a1_certificado_filial_fk', 'aviso_a1_dias_janela')) AS cons,
              (SELECT count(*)::int FROM pg_constraint WHERE conname = 'aviso_a1_certificado_fk') AS antiga,
              (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'plataforma'
                AND indexname = 'evento_agregado_versao_idx') AS ix`,
    );
    expect(r).toEqual({ cons: 3, antiga: 0, ix: 1 });
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0011 sobre aviso gravado antes com outra filial (T-0043)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0011');
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('o UPDATE da 0011 leva a filial do aviso para a do certificado e a FK composta passa a existir', () => {
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain('0011_aviso_a1_e_versao_evento.sql');
    executar(banco.conexao, fixturePlataforma(B) + fixtureModulos(B));
    const outra = randomUUID();
    // Como dono (fora da RLS), um aviso de outro dia com outra filial: a 0009 aceita.
    executar(
      banco.conexao,
      `INSERT INTO core.aviso_a1 (tenant_id, certificado_id, filial_id, valido_ate, dias, dia)
         SELECT tenant_id, id, '${outra}', valido_ate, 12, '2026-11-21' FROM core.certificado WHERE tenant_id = '${B.id}';`,
    );

    expect(migrar(banco.conexao, { oficiais: false })).toContain('0011_aviso_a1_e_versao_evento.sql');

    const [r] = consultar<{ certa: number; errada: number; fk: number }>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM core.aviso_a1 WHERE tenant_id = '${B.id}' AND dia = '2026-11-21'
                AND filial_id = '${B.filial}') AS certa,
              (SELECT count(*)::int FROM core.aviso_a1 WHERE filial_id = '${outra}') AS errada,
              (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'core.aviso_a1'::regclass
                AND conname = 'aviso_a1_certificado_filial_fk' AND contype = 'f') AS fk`,
    );
    expect(r).toEqual({ certa: 1, errada: 0, fk: 1 });
  });
});
