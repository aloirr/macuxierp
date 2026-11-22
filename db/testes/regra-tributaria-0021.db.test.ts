/**
 * T-0020, lote 4 (migração 0021): fiscal.regra_tributaria ganha p_dif (diferimento do CST 51) e p_icms_efet (ICMS
 * efetivo do CST 60/CSOSN 500), integer escala 4, nulos e sem padrão, com CHECKs nomeados de 0 a 1000000
 * (docs/banco/README.md); só a linha do ICMS as aceita (regra_tributaria_so_o_tributo recriado). Estrutura, limites,
 * RLS entre dois tenants nas colunas novas, privilégios e reexecução.
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
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarComo,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixtureFaturamento, fixtureModulos, fixturePlataforma, novoTenant, regraTributaria } from './fixture.ts';

const MIGRACAO = '0021_regra_tributaria_pdif_picms_efet.sql';
const CK_DIF = 'regra_tributaria_p_dif_ck';
const CK_EFET = 'regra_tributaria_p_icms_efet_ck';
const A = novoTenant('pdif-a');
const B = novoTenant('pdif-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const APP_B = { papel: 'macuxierp_app', tenant: B.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };

/** Regra do ICMS (CST 51 por padrão) com p_dif e p_icms_efet (valores em SQL); uf_destino distingue o cadastro. */
const regra = (uf: string, pDif: string, pIcmsEfet: string, codigo = '51'): string =>
  regraTributaria({ uf_destino: `'${uf}'`, codigo: `'${codigo}'`, p_dif: pDif, p_icms_efet: pIcmsEfet });

/** Linha dedicada do IPI (como em fiscal.db.test.ts): sem os campos do ICMS, do PIS e da COFINS. */
const IPI = {
  tributo: `'ipi'`,
  uf_destino: `'SE'`,
  codigo: 'OMITIR',
  aliquota_icms: 'OMITIR',
  cst_pis: 'OMITIR',
  cst_cofins: 'OMITIR',
  cst_ipi: `'50'`,
  aliquota_ipi: '65000',
};

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — regra tributária p_dif e p_icms_efet (T-0020, 0021)', () => {
  let banco: BancoDeTeste;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(
      banco.conexao,
      [A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t) + fixtureFaturamento(t)).join('\n'),
    );
  });

  afterAll(() => banco?.remover());

  it('as duas colunas são integer, nulas e sem padrão; os CHECKs nomeados existem e estão validados', () => {
    const colunas = consultar<{ nome: string; tipo: string; nula: string; padrao: string | null }>(
      banco.conexao,
      `SELECT column_name AS nome, data_type AS tipo, is_nullable AS nula, column_default AS padrao
       FROM information_schema.columns
       WHERE table_schema = 'fiscal' AND table_name = 'regra_tributaria' AND column_name IN ('p_dif', 'p_icms_efet')
       ORDER BY column_name`,
    );
    expect(colunas).toEqual([
      { nome: 'p_dif', tipo: 'integer', nula: 'YES', padrao: null },
      { nome: 'p_icms_efet', tipo: 'integer', nula: 'YES', padrao: null },
    ]);
    const cks = consultar<{ nome: string; validada: boolean }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validada FROM pg_constraint
       WHERE conrelid = 'fiscal.regra_tributaria'::regclass AND conname IN ('${CK_DIF}', '${CK_EFET}')
       ORDER BY conname`,
    );
    expect(cks).toEqual([
      { nome: CK_DIF, validada: true },
      { nome: CK_EFET, validada: true },
    ]);
    // A linha da massa (antes das colunas existirem no fluxo) fica nula.
    const [r] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM fiscal.regra_tributaria WHERE p_dif IS NOT NULL OR p_icms_efet IS NOT NULL`,
      APP_A,
    );
    expect(r).toEqual({ n: 0 });
  });

  it('0 e 1000000 passam nas duas colunas (o app grava)', () => {
    executar(banco.conexao, regra('PA', '0', '1000000'), APP_A);
    executar(banco.conexao, regra('RR', '1000000', '0', '60'), APP_A);
    const linhas = consultar<{ uf: string; d: number; e: number }>(
      banco.conexao,
      `SELECT uf_destino AS uf, p_dif AS d, p_icms_efet AS e FROM fiscal.regra_tributaria
       WHERE uf_destino IN ('PA', 'RR') ORDER BY uf_destino`,
      APP_A,
    );
    expect(linhas).toEqual([
      { uf: 'PA', d: 0, e: 1000000 },
      { uf: 'RR', d: 1000000, e: 0 },
    ]);
  });

  it.each([
    ['p_dif', '-1', 'NULL', CK_DIF],
    ['p_dif', '1000001', 'NULL', CK_DIF],
    ['p_icms_efet', 'NULL', '-1', CK_EFET],
    ['p_icms_efet', 'NULL', '1000001', CK_EFET],
  ])('%s = %s/%s fora da faixa falha com 23514 e o nome do CHECK', (_c, pDif, pEfet, ck) => {
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(regra('AP', pDif, pEfet)), APP_A));
    expect(e.saida).toMatch(/23514/);
    expect(e.mensagem).toMatch(new RegExp(ck));
  });

  it.each([
    ['p_dif', '100000'],
    ['p_icms_efet', '180000'],
  ])('tributo ipi com %s falha com 23514 em regra_tributaria_so_o_tributo (só o ICMS aceita)', (coluna, valor) => {
    const e = falhaDetalhada(() =>
      executar(banco.conexao, verboso(regraTributaria({ ...IPI, [coluna]: valor })), APP_A),
    );
    expect(e.saida).toMatch(/23514/);
    expect(e.mensagem).toMatch(/regra_tributaria_so_o_tributo/);
  });

  it('RLS: o tenant B não vê nem atualiza a regra do tenant A com as colunas preenchidas (UPDATE atinge 0 linhas)', () => {
    const [vista] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM fiscal.regra_tributaria WHERE tenant_id = '${A.id}'`,
      APP_B,
    );
    expect(vista).toEqual({ n: 0 });
    const mudou = rodarComo(
      banco.conexao,
      `UPDATE fiscal.regra_tributaria SET p_dif = 500000, p_icms_efet = 170000
       WHERE tenant_id = '${A.id}' RETURNING 1;`,
      APP_B,
    );
    expect(numeros(mudou)).toEqual([]);
    const linhas = consultar<{ uf: string; d: number; e: number }>(
      banco.conexao,
      `SELECT uf_destino AS uf, p_dif AS d, p_icms_efet AS e FROM fiscal.regra_tributaria
       WHERE tenant_id = '${A.id}' AND uf_destino IN ('PA', 'RR') ORDER BY uf_destino`,
    );
    expect(linhas).toEqual([
      { uf: 'PA', d: 0, e: 1000000 },
      { uf: 'RR', d: 1000000, e: 0 },
    ]);
  });

  it('o app atualiza as colunas novas e a leitura as lê', () => {
    executar(
      banco.conexao,
      `UPDATE fiscal.regra_tributaria SET p_dif = 333300, p_icms_efet = 180000 WHERE uf_destino = 'PA';`,
      APP_A,
    );
    const [lida] = consultar<{ d: number; e: number }>(
      banco.conexao,
      `SELECT p_dif AS d, p_icms_efet AS e FROM fiscal.regra_tributaria WHERE uf_destino = 'PA'`,
      LEITURA_A,
    );
    expect(lida).toEqual({ d: 333300, e: 180000 });
  });

  it('a 0021 é reexecutável: rodar o arquivo de novo não dá erro nem duplica colunas nem CHECKs', () => {
    const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
    rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
    const [r] = consultar<{ cols: number; cks: number }>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'fiscal.regra_tributaria'::regclass
                 AND attname IN ('p_dif', 'p_icms_efet') AND NOT attisdropped) AS cols,
              (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'fiscal.regra_tributaria'::regclass
                 AND conname IN ('${CK_DIF}', '${CK_EFET}', 'regra_tributaria_so_o_tributo')) AS cks`,
    );
    expect(r).toEqual({ cols: 2, cks: 3 });
  });
});
