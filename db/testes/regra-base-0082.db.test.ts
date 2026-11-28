/**
 * T-0127 (migração 0082): fiscal.regra_tributaria.ajustar_mva sem padrão e nulável (condição do engenheiro na revisão
 * do #942), catálogo fiscal.regra_base no tenant de referência (D9) e regra_tributaria.regra_base_id. Linhas antigas
 * mantêm o valor, estrutura e paridade das colunas, CHECKs (sem ST interestadual), leitura por todo tenant, nenhuma
 * gravação pela aplicação, aplicação idempotente por tenant, RLS entre dois tenants e reexecução.
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
  privilegiosDe,
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

const MIGRACAO = '0082_fiscal_regra_base_ajustar_mva.sql';
const A = novoTenant('rbase-a');
const B = novoTenant('rbase-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const APP_B = { papel: 'macuxierp_app', tenant: B.id };
const LEITURA_B = { papel: 'macuxierp_leitura', tenant: B.id };

/** INSERT de uma regra base (valores já em SQL); padrão: ICMS interno do AM, sem ST. */
function regraBase(campos: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    chave: `'am.interna.00'`,
    titulo: `'AM interna, tributada integralmente'`,
    uf_origem: `'AM'`,
    uf_destino: `'AM'`,
    codigo: `'00'`,
    aliquota_icms: '200000',
    fonte_tipo: `'lei'`,
    fonte_referencia: `'RICMS-AM'`,
    versao: `'2026.1'`,
    vigencia_inicio: `'2026-01-01'`,
    ...campos,
  };
  const colunas = Object.keys(base).filter((k) => base[k] !== 'OMITIR');
  return `INSERT INTO fiscal.regra_base (${colunas.join(', ')}) VALUES (${colunas.map((k) => base[k]).join(', ')});`;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — catálogo regra_base e ajustar_mva sem padrão (T-0127, 0082)',
  () => {
    let banco: BancoDeTeste;
    let anteriores: PastaDeMigracoes | undefined;
    let interna = '';

    beforeAll(() => {
      banco = criarBancoDeTeste();
      anteriores = pastaComMigracoesAntesDe('0082');
      expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t)).join('\n'),
      );
      // Linha antiga: antes da 0082 o padrão (false) preenche ajustar_mva.
      executar(
        banco.conexao,
        regraTributaria({
          uf_destino: `'RR'`,
          codigo: `'10'`,
          mva_original: '400000',
          aliquota_interna_destino: '200000',
        }),
        APP_A,
      );
      expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
    });

    afterAll(() => {
      banco?.remover();
      anteriores?.remover();
    });

    it('ajustar_mva fica boolean, nulável e sem padrão nas duas tabelas', () => {
      const colunas = consultar<{ tabela: string; tipo: string; nula: string; padrao: string | null }>(
        banco.conexao,
        `SELECT table_name AS tabela, data_type AS tipo, is_nullable AS nula, column_default AS padrao
       FROM information_schema.columns
       WHERE table_schema = 'fiscal' AND column_name = 'ajustar_mva' ORDER BY table_name`,
      );
      expect(colunas).toEqual([
        { tabela: 'regra_base', tipo: 'boolean', nula: 'YES', padrao: null },
        { tabela: 'regra_tributaria', tipo: 'boolean', nula: 'YES', padrao: null },
      ]);
    });

    it('a linha gravada antes da 0082 mantém o false; a nova sem a coluna fica nula; true e false explícitos ficam', () => {
      executar(banco.conexao, regraTributaria({ uf_destino: `'AP'` }), APP_A);
      executar(banco.conexao, regraTributaria({ uf_destino: `'PA'`, ajustar_mva: 'true' }), APP_A);
      executar(banco.conexao, regraTributaria({ uf_destino: `'AC'`, ajustar_mva: 'false' }), APP_A);
      const linhas = consultar<{ uf: string; a: boolean | null }>(
        banco.conexao,
        `SELECT uf_destino AS uf, ajustar_mva AS a FROM fiscal.regra_tributaria
       WHERE uf_destino IN ('RR', 'AP', 'PA', 'AC') ORDER BY uf_destino`,
        APP_A,
      );
      expect(linhas).toEqual([
        { uf: 'AC', a: false },
        { uf: 'AP', a: null },
        { uf: 'PA', a: true },
        { uf: 'RR', a: false },
      ]);
    });

    it('regra_base tem as colunas de negócio da regra_tributaria com o mesmo tipo, nulidade e padrão', () => {
      const diferencas = consultar<{ coluna: string }>(
        banco.conexao,
        `SELECT t.column_name AS coluna FROM information_schema.columns t
       LEFT JOIN information_schema.columns b ON b.table_schema = 'fiscal' AND b.table_name = 'regra_base'
         AND b.column_name = t.column_name
       WHERE t.table_schema = 'fiscal' AND t.table_name = 'regra_tributaria'
         AND t.column_name NOT IN ('tenant_id', 'regra_base_id')
         AND (b.column_name IS NULL OR b.data_type <> t.data_type OR b.is_nullable <> t.is_nullable
              OR coalesce(b.column_default, '') <> coalesce(t.column_default, ''))
       ORDER BY 1`,
      );
      expect(diferencas).toEqual([]);
      const proprias = consultar<{ coluna: string; nula: string }>(
        banco.conexao,
        `SELECT column_name AS coluna, is_nullable AS nula FROM information_schema.columns
       WHERE table_schema = 'fiscal' AND table_name = 'regra_base'
         AND column_name NOT IN (SELECT column_name FROM information_schema.columns
                                 WHERE table_schema = 'fiscal' AND table_name = 'regra_tributaria')
       ORDER BY 1`,
      );
      expect(proprias).toEqual([
        { coluna: 'chave', nula: 'NO' },
        { coluna: 'descricao', nula: 'YES' },
        { coluna: 'titulo', nula: 'NO' },
      ]);
    });

    it('RLS ligada, índices criados e o catálogo começa vazio (sem fonte oficial no repositório)', () => {
      const [r] = consultar<{ rls: boolean; idx: number; n: number }>(
        banco.conexao,
        `SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'fiscal.regra_base'::regclass) AS rls,
              (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'fiscal' AND indexname IN
                ('regra_base_chave_uq', 'regra_base_uf_origem_idx', 'regra_base_external_id_uq',
                 'regra_base_tenant_id_uq', 'regra_tributaria_regra_base_uq')) AS idx,
              (SELECT count(*)::int FROM fiscal.regra_base) AS n`,
      );
      expect(r).toEqual({ rls: true, idx: 5, n: 0 });
    });

    it('a migração grava no catálogo; todo tenant lê; a aplicação não grava nem altera', () => {
      executar(banco.conexao, regraBase());
      const [linha] = consultar<{ id: string }>(
        banco.conexao,
        `SELECT id FROM fiscal.regra_base WHERE chave = 'am.interna.00'`,
      );
      interna = linha?.id ?? '';
      expect(interna).toMatch(/^[0-9a-f-]{36}$/);
      for (const ctx of [APP_A, APP_B, LEITURA_B]) {
        const [v] = consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM fiscal.regra_base`,
          ctx,
        );
        expect(v).toEqual({ n: 1 });
      }
      expect(privilegiosDe(banco.conexao, 'macuxierp_app', 'fiscal.regra_base')).toBe('S');
      expect(privilegiosDe(banco.conexao, 'macuxierp_leitura', 'fiscal.regra_base')).toBe('S');
      const ins = falhaDetalhada(() => executar(banco.conexao, regraBase({ chave: `'x.y'` }), APP_A));
      expect(ins.saida).toMatch(/42501|permission denied|permissão negada/);
      const upd = falhaDetalhada(() =>
        executar(banco.conexao, `UPDATE fiscal.regra_base SET titulo = 'x' WHERE id = '${interna}';`, APP_A),
      );
      expect(upd.saida).toMatch(/42501|permission denied|permissão negada/);
    });

    it('linha de tenant no catálogo falha em regra_base_so_referencia; chave repetida na mesma vigência falha', () => {
      const e = falhaDetalhada(() =>
        executar(banco.conexao, verboso(regraBase({ chave: `'outra'`, tenant_id: `'${A.id}'` }))),
      );
      expect(e.saida).toMatch(/23514/);
      expect(e.mensagem).toMatch(/regra_base_so_referencia/);
      const d = falhaDetalhada(() => executar(banco.conexao, verboso(regraBase())));
      expect(d.saida).toMatch(/23505/);
      expect(d.mensagem).toMatch(/regra_base_chave_uq/);
      // Vigência nova da mesma chave é linha nova.
      executar(banco.conexao, regraBase({ vigencia_inicio: `'2027-01-01'` }));
    });

    it.each([
      [
        'ST com UF de destino diferente',
        {
          chave: `'st.1'`,
          uf_destino: `'PA'`,
          codigo: `'10'`,
          mva_original: '400000',
          aliquota_interna_destino: '170000',
        },
      ],
      [
        'ST com destino nulo (todos)',
        {
          chave: `'st.2'`,
          uf_destino: 'NULL',
          codigo: `'10'`,
          mva_original: '400000',
          aliquota_interna_destino: '170000',
        },
      ],
      [
        'ST com origem nula (todas)',
        {
          chave: `'st.3'`,
          uf_origem: 'NULL',
          codigo: `'70'`,
          mva_original: '400000',
          aliquota_interna_destino: '170000',
        },
      ],
      [
        'CSOSN 201 interestadual sem campo de ST',
        { chave: `'st.4'`, crt: '1', uf_destino: `'RR'`, codigo: `'201'`, aliquota_icms: 'NULL' },
      ],
      [
        'ajustar_mva informado em regra interestadual',
        { chave: `'st.5'`, uf_destino: `'RR'`, ajustar_mva: 'false' },
      ],
    ])('%s falha em regra_base_sem_st_interestadual (23514)', (_nome, campos) => {
      const e = falhaDetalhada(() => executar(banco.conexao, verboso(regraBase(campos))));
      expect(e.saida).toMatch(/23514/);
      expect(e.mensagem).toMatch(/regra_base_sem_st_interestadual/);
    });

    it('ST interno (origem = destino), ST retido (60) interestadual e regra sem ST interestadual passam', () => {
      executar(
        banco.conexao,
        regraBase({
          chave: `'am.interna.10'`,
          codigo: `'10'`,
          mva_original: '400000',
          aliquota_interna_destino: '200000',
          ajustar_mva: 'false',
        }),
      );
      executar(
        banco.conexao,
        regraBase({ chave: `'am.pa.60'`, uf_destino: `'PA'`, codigo: `'60'`, aliquota_icms: 'NULL' }),
      );
      executar(
        banco.conexao,
        regraBase({ chave: `'am.pa.00'`, uf_destino: `'PA'`, aliquota_icms: '120000' }),
      );
    });

    it('os CHECKs da regra_tributaria valem no catálogo (CST x CRT, linha de IPI só com IPI)', () => {
      const crt = falhaDetalhada(() =>
        executar(banco.conexao, verboso(regraBase({ chave: `'c.1'`, crt: '1' }))),
      );
      expect(crt.mensagem).toMatch(/regra_base_cst_ou_csosn/);
      const ipi = falhaDetalhada(() =>
        executar(banco.conexao, verboso(regraBase({ chave: `'c.2'`, tributo: `'ipi'`, cst_ipi: `'50'` }))),
      );
      expect(ipi.mensagem).toMatch(/regra_base_so_o_tributo/);
    });

    it('aplicar a regra base no tenant: uma viva por tenant (23505), o outro tenant aplica a sua e não vê a de A', () => {
      const aplicar = (uf: string) =>
        regraTributaria({ uf_destino: `'${uf}'`, regra_base_id: `'${interna}'` });
      executar(banco.conexao, aplicar('AM'), APP_A);
      const dup = falhaDetalhada(() => executar(banco.conexao, verboso(aplicar('MT')), APP_A));
      expect(dup.saida).toMatch(/23505/);
      expect(dup.mensagem).toMatch(/regra_tributaria_regra_base_uq/);
      executar(banco.conexao, aplicar('AM'), APP_B);
      const [vista] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM fiscal.regra_tributaria WHERE regra_base_id = '${interna}'`,
        APP_B,
      );
      expect(vista).toEqual({ n: 1 });
      // Excluída (deleted_at) libera nova aplicação.
      executar(
        banco.conexao,
        `UPDATE fiscal.regra_tributaria SET deleted_at = now() WHERE regra_base_id = '${interna}';`,
        APP_A,
      );
      executar(banco.conexao, aplicar('MT'), APP_A);
      const fk = falhaDetalhada(() =>
        executar(
          banco.conexao,
          verboso(regraTributaria({ uf_destino: `'TO'`, regra_base_id: 'gen_random_uuid()' })),
          APP_A,
        ),
      );
      expect(fk.saida).toMatch(/23503/);
    });

    it('a 0082 é reexecutável: rodar o arquivo de novo não dá erro nem duplica coluna, FK ou índice', () => {
      const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
      rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
      const [r] = consultar<{ cols: number; fks: number; padrao: string | null }>(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'fiscal.regra_tributaria'::regclass
                 AND attname = 'regra_base_id' AND NOT attisdropped) AS cols,
              (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'fiscal.regra_tributaria'::regclass
                 AND conname = 'regra_tributaria_regra_base_fk') AS fks,
              (SELECT column_default FROM information_schema.columns WHERE table_schema = 'fiscal'
                 AND table_name = 'regra_tributaria' AND column_name = 'ajustar_mva') AS padrao`,
      );
      expect(r).toEqual({ cols: 1, fks: 1, padrao: null });
    });
  },
);
