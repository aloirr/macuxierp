/**
 * T-0128 (migração 0089, RN-FIS-06): colunas do DIFAL p_fcp_uf_dest e difal_base_dupla em fiscal.regra_tributaria e
 * fiscal.regra_base. Mesmo tipo, nulidade e padrão (nenhum) nas duas tabelas; linha antiga fica com as duas nulas;
 * faixa 0 a 1000000; só a linha de ICMS aceita as colunas (so_o_tributo); DIFAL interestadual sem campo de ST passa no
 * catálogo; RLS entre dois tenants; reexecução.
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
  permitirSetRole,
  rodarScript,
  verboso,
} from './apoio.ts';
import {
  fixtureFaturamento,
  fixtureModulos,
  fixturePlataforma,
  novoTenant,
  regraTributaria,
} from './fixture.ts';

const MIGRACAO = '0089_fiscal_regra_difal.sql';
const A = novoTenant('difal-a');
const B = novoTenant('difal-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const APP_B = { papel: 'macuxierp_app', tenant: B.id };

/** INSERT de uma regra base (valores já em SQL); padrão: ICMS AM para PA, sem ST. */
function regraBase(campos: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    chave: `'am.pa.00'`,
    titulo: `'AM para PA, tributada integralmente'`,
    uf_origem: `'AM'`,
    uf_destino: `'PA'`,
    codigo: `'00'`,
    aliquota_icms: '120000',
    fonte_tipo: `'lei'`,
    fonte_referencia: `'RICMS-AM'`,
    versao: `'2026.1'`,
    vigencia_inicio: `'2026-01-01'`,
    ...campos,
  };
  const colunas = Object.keys(base);
  return `INSERT INTO fiscal.regra_base (${colunas.join(', ')}) VALUES (${colunas.map((k) => base[k]).join(', ')});`;
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — colunas do DIFAL na regra (T-0128, 0089)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes | undefined;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0089');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t)).join('\n'),
    );
    // Linha antiga, gravada pela versão anterior (não conhece as colunas).
    executar(banco.conexao, regraTributaria({ uf_destino: `'RR'` }), APP_A);
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('as duas colunas têm o mesmo tipo, nulidade e nenhum padrão nas duas tabelas', () => {
    const colunas = consultar<{ tabela: string; coluna: string; tipo: string; nula: string; padrao: string | null }>(
      banco.conexao,
      `SELECT table_name AS tabela, column_name AS coluna, data_type AS tipo, is_nullable AS nula,
              column_default AS padrao
       FROM information_schema.columns
       WHERE table_schema = 'fiscal' AND column_name IN ('p_fcp_uf_dest', 'difal_base_dupla')
       ORDER BY table_name, column_name`,
    );
    expect(colunas).toEqual([
      { tabela: 'regra_base', coluna: 'difal_base_dupla', tipo: 'boolean', nula: 'YES', padrao: null },
      { tabela: 'regra_base', coluna: 'p_fcp_uf_dest', tipo: 'integer', nula: 'YES', padrao: null },
      { tabela: 'regra_tributaria', coluna: 'difal_base_dupla', tipo: 'boolean', nula: 'YES', padrao: null },
      { tabela: 'regra_tributaria', coluna: 'p_fcp_uf_dest', tipo: 'integer', nula: 'YES', padrao: null },
    ]);
    // Paridade geral do catálogo (a da 0082) continua.
    const diferencas = consultar<{ coluna: string }>(
      banco.conexao,
      `SELECT t.column_name AS coluna FROM information_schema.columns t
       LEFT JOIN information_schema.columns b ON b.table_schema = 'fiscal' AND b.table_name = 'regra_base'
         AND b.column_name = t.column_name
       WHERE t.table_schema = 'fiscal' AND t.table_name = 'regra_tributaria'
         AND t.column_name NOT IN ('tenant_id', 'regra_base_id')
         AND (b.column_name IS NULL OR b.data_type <> t.data_type OR b.is_nullable <> t.is_nullable
              OR coalesce(b.column_default, '') <> coalesce(t.column_default, ''))`,
    );
    expect(diferencas).toEqual([]);
  });

  it('a linha antiga fica com as duas nulas; a nova grava 0, 20000, true e false e lê de volta', () => {
    executar(banco.conexao, regraTributaria({ uf_destino: `'AP'` }), APP_A);
    executar(
      banco.conexao,
      regraTributaria({
        uf_destino: `'PA'`,
        tipo_cliente: `'nao_contribuinte'`,
        aliquota_interna_destino: '190000',
        p_fcp_uf_dest: '20000',
        difal_base_dupla: 'true',
      }),
      APP_A,
    );
    executar(
      banco.conexao,
      regraTributaria({ uf_destino: `'AC'`, p_fcp_uf_dest: '0', difal_base_dupla: 'false' }),
      APP_A,
    );
    const linhas = consultar<{ uf: string; fcp: number | null; dupla: boolean | null }>(
      banco.conexao,
      `SELECT uf_destino AS uf, p_fcp_uf_dest AS fcp, difal_base_dupla AS dupla FROM fiscal.regra_tributaria
       WHERE uf_destino IN ('RR', 'AP', 'PA', 'AC') ORDER BY uf_destino`,
      APP_A,
    );
    expect(linhas).toEqual([
      { uf: 'AC', fcp: 0, dupla: false },
      { uf: 'AP', fcp: null, dupla: null },
      { uf: 'PA', fcp: 20000, dupla: true },
      { uf: 'RR', fcp: null, dupla: null },
    ]);
  });

  it.each([
    ['regra_tributaria', '-1'],
    ['regra_tributaria', '1000001'],
    ['regra_base', '-1'],
    ['regra_base', '1000001'],
  ])('%s recusa p_fcp_uf_dest = %s (23514, *_p_fcp_uf_dest_ck)', (tabela, valor) => {
    const sql =
      tabela === 'regra_base'
        ? regraBase({ chave: `'faixa.${valor.replace('-', 'm')}'`, p_fcp_uf_dest: valor })
        : regraTributaria({ uf_destino: `'MT'`, p_fcp_uf_dest: valor });
    const e = falhaDetalhada(() =>
      executar(banco.conexao, verboso(sql), tabela === 'regra_base' ? undefined : APP_A),
    );
    expect(e.saida).toMatch(/23514/);
    expect(e.mensagem).toMatch(new RegExp(`${tabela}_p_fcp_uf_dest_ck`));
  });

  it.each([
    ['regra_tributaria', 'p_fcp_uf_dest', '20000'],
    ['regra_tributaria', 'difal_base_dupla', 'false'],
    ['regra_base', 'p_fcp_uf_dest', '20000'],
    ['regra_base', 'difal_base_dupla', 'true'],
  ])('%s: linha de IPI com %s falha em so_o_tributo (23514)', (tabela, coluna, valor) => {
    const campos = { tributo: `'ipi'`, codigo: 'NULL', aliquota_icms: 'NULL', cst_ipi: `'50'`, [coluna]: valor };
    const sql =
      tabela === 'regra_base'
        ? regraBase({ chave: `'ipi.${coluna}'`, ...campos })
        : regraTributaria({ ...campos, cst_pis: 'NULL', cst_cofins: 'NULL', versao_nt_rtc: 'NULL' });
    const e = falhaDetalhada(() =>
      executar(banco.conexao, verboso(sql), tabela === 'regra_base' ? undefined : APP_A),
    );
    expect(e.saida).toMatch(/23514/);
    expect(e.mensagem).toMatch(new RegExp(`${tabela}_so_o_tributo`));
  });

  it('catálogo: regra interestadual com as colunas do DIFAL (sem campo de ST) passa no sem_st_interestadual', () => {
    executar(banco.conexao, regraBase({ p_fcp_uf_dest: '20000', difal_base_dupla: 'true' }));
    const [r] = consultar<{ fcp: number; dupla: boolean }>(
      banco.conexao,
      `SELECT p_fcp_uf_dest AS fcp, difal_base_dupla AS dupla FROM fiscal.regra_base WHERE chave = 'am.pa.00'`,
      APP_B,
    );
    expect(r).toEqual({ fcp: 20000, dupla: true });
  });

  it('RLS: o tenant B não vê as regras do DIFAL de A', () => {
    const [v] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM fiscal.regra_tributaria WHERE p_fcp_uf_dest IS NOT NULL`,
      APP_B,
    );
    expect(v).toEqual({ n: 0 });
  });

  it('a 0089 é reexecutável: rodar o arquivo de novo não duplica coluna nem CHECK', () => {
    const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
    rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
    const [r] = consultar<{ cols: number; cks: number }>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM pg_attribute WHERE attrelid IN ('fiscal.regra_tributaria'::regclass,
                 'fiscal.regra_base'::regclass) AND attname IN ('p_fcp_uf_dest', 'difal_base_dupla')
                 AND NOT attisdropped) AS cols,
              (SELECT count(*)::int FROM pg_constraint WHERE conname IN ('regra_tributaria_p_fcp_uf_dest_ck',
                 'regra_base_p_fcp_uf_dest_ck', 'regra_tributaria_so_o_tributo', 'regra_base_so_o_tributo')) AS cks`,
    );
    expect(r).toEqual({ cols: 4, cks: 4 });
  });
});
