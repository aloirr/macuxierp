/**
 * T-0127 (v0.3.32): seed fiscal de EXEMPLO (db/seeds/fiscal-exemplo.sql). Carrega no banco de teste, regras base no
 * tenant de referência e regras tributárias só no tenant de teste (RLS entre dois tenants), ajustar_mva explícito,
 * nada de ST interestadual, exemplo marcado na fonte_referencia, idempotente (roda de novo sem duplicar), recusa banco que não é de teste
 * e não faz parte do migrar.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carregarSeedFiscalExemplo, sqlSeedFiscalExemplo } from '../seeds/fiscal-exemplo.ts';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import { conexaoDoAmbiente } from '../src/psql.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const A = novoTenant('seed-a');
const B = novoTenant('seed-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const APP_B = { papel: 'macuxierp_app', tenant: B.id };
const LEITURA_B = { papel: 'macuxierp_leitura', tenant: B.id };
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
/** Texto da fonte que aparece na tela (pedido da marca, v0.3.32): sem caminho de arquivo e sem nome de ambiente. */
const FONTE = 'Exemplo para demonstração, sem valor fiscal';

interface Contagem {
  base: number;
  trib_a: number;
  trib_b: number;
}

describe('seed fiscal de exemplo fora do deploy', () => {
  it('não é migração nem lido pelo db/src (o migrar do deploy não o carrega)', () => {
    expect(listarMigracoes().some((m) => /seed|exemplo/.test(m.nome))).toBe(false);
    const src = new URL('../src/', import.meta.url);
    const fontes = readdirSync(src, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.ts'))
      .map((d) => readFileSync(`${d.parentPath}/${d.name}`, 'utf8'));
    expect(fontes.some((f) => f.includes('seeds/'))).toBe(false);
  });

  it('recusa tenant que não é UUID antes de montar o SQL', () => {
    expect(() => sqlSeedFiscalExemplo("x'; DROP TABLE fiscal.regra_base; --")).toThrow(/UUID/);
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — seed fiscal de exemplo (T-0127)', () => {
  let banco: BancoDeTeste;

  const contar = (): Contagem => {
    const [c] = consultar<Contagem>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM fiscal.regra_base) AS base,
              (SELECT count(*)::int FROM fiscal.regra_tributaria WHERE tenant_id = '${A.id}') AS trib_a,
              (SELECT count(*)::int FROM fiscal.regra_tributaria WHERE tenant_id = '${B.id}') AS trib_b`,
    );
    return c as Contagem;
  };

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A) + fixturePlataforma(B));
  });

  afterAll(() => banco?.remover());

  it('o migrar sozinho deixa o catálogo e as regras vazios', () => {
    expect(contar()).toEqual({ base: 0, trib_a: 0, trib_b: 0 });
  });

  it('carrega 6 regras base no tenant de referência e 7 regras tributárias só no tenant de teste', () => {
    carregarSeedFiscalExemplo(banco.conexao, A.id);
    expect(contar()).toEqual({ base: 6, trib_a: 7, trib_b: 0 });
    const base = consultar<{ chave: string; tributo: string; tenant: string }>(
      banco.conexao,
      `SELECT chave, tributo, tenant_id::text AS tenant FROM fiscal.regra_base ORDER BY chave`,
    );
    expect(base.map((b) => b.chave)).toEqual([
      'exemplo.am.icms.interna.00',
      'exemplo.am.icms.interna.20',
      'exemplo.cofins.tributado.01',
      'exemplo.ipi.nao-tributado.53',
      'exemplo.ipi.tributado.50',
      'exemplo.pis.tributado.01',
    ]);
    expect(new Set(base.map((b) => b.tenant))).toEqual(new Set([REFERENCIA]));
    const [aplicadas] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM fiscal.regra_tributaria t JOIN fiscal.regra_base b ON b.id = t.regra_base_id
       WHERE t.tenant_id = '${A.id}' AND t.codigo IS NOT DISTINCT FROM b.codigo
         AND t.aliquota_icms IS NOT DISTINCT FROM b.aliquota_icms AND t.cst_pis IS NOT DISTINCT FROM b.cst_pis`,
    );
    expect(aplicadas).toEqual({ n: 6 });
  });

  it('exemplo marcado só na fonte (sem caminho nem e2e), título em português claro, ajustar_mva false e nada de ST', () => {
    const [b] = consultar<{ sem_exemplo: number; titulo_exemplo: number; texto_tecnico: number }>(
      banco.conexao,
      `SELECT count(*) FILTER (WHERE fonte_referencia IS DISTINCT FROM '${FONTE}')::int AS sem_exemplo,
              count(*) FILTER (WHERE titulo ILIKE 'exemplo%' OR titulo ~ 'CST|CSOSN')::int AS titulo_exemplo,
              count(*) FILTER (WHERE concat_ws(' ', titulo, descricao, fonte_referencia) ~* '(e2e|/|\\.sql)')::int
                AS texto_tecnico
       FROM fiscal.regra_base`,
    );
    expect(b).toEqual({ sem_exemplo: 0, titulo_exemplo: 0, texto_tecnico: 0 });
    const [titulo] = consultar<{ t: string }>(
      banco.conexao,
      `SELECT titulo AS t FROM fiscal.regra_base WHERE chave = 'exemplo.am.icms.interna.00'`,
    );
    expect(titulo?.t).toBe('ICMS interno de AM, regime normal, tributado integralmente');
    const [t] = consultar<{ sem_exemplo: number; mva_nao_falso: number; st: number }>(
      banco.conexao,
      `SELECT count(*) FILTER (WHERE fonte_referencia IS DISTINCT FROM '${FONTE}')::int AS sem_exemplo,
              count(*) FILTER (WHERE ajustar_mva IS DISTINCT FROM false)::int AS mva_nao_falso,
              count(*) FILTER (WHERE num_nonnulls(mod_bc_st, mva_original, mva_ajustada, reducao_bc_st,
                aliquota_interna_destino, p_fcp_st) > 0
                OR coalesce(codigo, '') IN ('10', '30', '70', '201', '202', '203')
                OR (tributo = 'icms' AND uf_origem IS DISTINCT FROM uf_destino))::int AS st
       FROM fiscal.regra_tributaria WHERE tenant_id = '${A.id}'`,
    );
    expect(t).toEqual({ sem_exemplo: 0, mva_nao_falso: 0, st: 0 });
  });

  it('RLS: o tenant de teste vê as suas 7 regras; o outro tenant não vê nenhuma e lê o catálogo', () => {
    const n = (ctx: typeof APP_A, tabela: string) =>
      consultar<{ n: number }>(banco.conexao, `SELECT count(*)::int AS n FROM ${tabela}`, ctx)[0]?.n;
    expect(n(APP_A, 'fiscal.regra_tributaria')).toBe(7);
    expect(n(APP_B, 'fiscal.regra_tributaria')).toBe(0);
    expect(n(LEITURA_B, 'fiscal.regra_tributaria')).toBe(0);
    expect(n(APP_B, 'fiscal.regra_base')).toBe(6);
    expect(n(LEITURA_B, 'fiscal.regra_base')).toBe(6);
  });

  it('roda de novo sem duplicar; um segundo tenant de teste reaproveita o catálogo', () => {
    carregarSeedFiscalExemplo(banco.conexao, A.id);
    carregarSeedFiscalExemplo(banco.conexao, A.id);
    expect(contar()).toEqual({ base: 6, trib_a: 7, trib_b: 0 });
    carregarSeedFiscalExemplo(banco.conexao, B.id);
    expect(contar()).toEqual({ base: 6, trib_a: 7, trib_b: 7 });
  });

  it('recusa o tenant de referência e tenant que não existe, sem gravar nada', () => {
    expect(falha(() => carregarSeedFiscalExemplo(banco.conexao, REFERENCIA))).toMatch(/referência/);
    expect(falha(() => carregarSeedFiscalExemplo(banco.conexao, randomUUID()))).toMatch(/não existe/);
    expect(contar()).toEqual({ base: 6, trib_a: 7, trib_b: 7 });
  });

  it('recusa banco que não é de teste nem de desenvolvimento (produção: macuxierp)', () => {
    const nome = `macuxierp_prova_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const raiz = conexaoDoAmbiente(process.env, 'postgres');
    rodarScript(raiz, `CREATE DATABASE ${nome};`);
    try {
      expect(falha(() => carregarSeedFiscalExemplo({ ...raiz, banco: nome }, A.id))).toMatch(
        /recusado no banco/,
      );
    } finally {
      rodarScript(raiz, `DROP DATABASE IF EXISTS ${nome};`);
    }
  });
});
