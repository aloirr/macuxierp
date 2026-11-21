/**
 * T-0003, lote 2: tabelas oficiais (D9, RF-CAD-10). Carga versionada com fonte e data, conferência do sha256 e dos
 * registros, leitura por todo tenant, nenhuma gravação pela aplicação e a versão nova fechando o código que sumiu.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256Arquivo } from '../src/comum.ts';
import { migrar } from '../src/migrar.ts';
import { carregarOficiais, conferirCarga, lerFontes, PASTA_OFICIAIS } from '../src/oficiais.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  falha,
  executar,
  PG_DISPONIVEL,
  permitirSetRole,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const A = novoTenant('oficiais-a');

describe('fontes das tabelas oficiais (sem banco)', () => {
  const cargas = lerFontes();

  it('toda carga tem fonte, url, data de referência, sha256 e registros que batem com o arquivo', () => {
    expect(cargas.length).toBeGreaterThanOrEqual(9);
    for (const c of cargas) {
      expect(() => conferirCarga(c), c.carga).not.toThrow();
      const linhas = readFileSync(join(PASTA_OFICIAIS, c.arquivo), 'utf8').trimEnd().split('\n').length - 1;
      expect(linhas, c.carga).toBe(c.registros);
    }
  });

  it('cobre NCM, CEST, CFOP, CST/CSOSN, municípios do IBGE e cClassTrib', () => {
    expect(new Set(cargas.map((c) => c.tabela))).toEqual(
      new Set(['uf', 'municipio', 'ncm', 'cest', 'cest_ncm', 'cfop', 'cst', 'classificacao_tributaria']),
    );
  });

  it('recusa arquivo com sha256 diferente do fontes.json', () => {
    const [primeira] = cargas;
    expect(() => conferirCarga({ ...primeira!, sha256: '0'.repeat(64) })).toThrow(/sha256/);
  });

  it('códigos de município do IBGE com dígito verificador (salvo as 9 exceções do próprio IBGE)', () => {
    const c = cargas.find((x) => x.tabela === 'municipio')!;
    const codigos = readFileSync(join(PASTA_OFICIAIS, c.arquivo), 'utf8')
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.slice(1, 8));
    const invalidos = codigos.filter((cod) => {
      let soma = 0;
      for (let i = 0; i < 6; i++) {
        const v = Number(cod[i]) * (i % 2 ? 2 : 1);
        soma += v > 9 ? v - 9 : v;
      }
      return (10 - (soma % 10)) % 10 !== Number(cod[6]);
    });
    expect(invalidos.sort()).toEqual([
      '2201919',
      '2201988',
      '2202251',
      '2611533',
      '3117836',
      '3152131',
      '4305871',
      '5203939',
      '5203962',
    ]);
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — tabelas oficiais (T-0003, lote 2)', () => {
  let banco: BancoDeTeste;
  let pastaTemp: string | undefined;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao);
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A));
  });

  afterAll(() => {
    banco?.remover();
    if (pastaTemp) rmSync(pastaTemp, { recursive: true, force: true });
  });

  it('carrega todas as versões com fonte e data, uma vez', () => {
    const versoes = consultar<{ carga: string; registros: number; fonte: string; data_referencia: string }>(
      banco.conexao,
      'SELECT carga, registros, fonte, data_referencia::text FROM cadastros.tabela_oficial_versao ORDER BY carga',
    );
    expect(versoes.map((v) => v.carga)).toEqual(
      lerFontes()
        .map((c) => c.carga)
        .sort(),
    );
    for (const v of versoes) {
      expect(v.fonte.length).toBeGreaterThan(10);
      expect(v.data_referencia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(carregarOficiais(banco.conexao)).toEqual([]);
  });

  it('as contagens batem com as fontes', () => {
    const esperado: Record<string, number> = {};
    for (const c of lerFontes()) esperado[c.tabela] = (esperado[c.tabela] ?? 0) + c.registros;
    const tabelas = Object.keys(esperado).sort();
    const [n] = consultar<Record<string, number>>(
      banco.conexao,
      `SELECT ${tabelas.map((t) => `(SELECT count(*) FROM cadastros.${t})::int AS ${t}`).join(', ')}`,
    );
    expect(n).toEqual(esperado);
  });

  it('todo tenant lê (Manaus, CFOP 5102, CST 00 e cClassTrib 000001); nenhum papel grava', () => {
    const ctx = { papel: 'macuxierp_app', tenant: A.id };
    expect(
      consultar(banco.conexao, `SELECT nome, uf FROM cadastros.municipio WHERE codigo = '1302603'`, ctx),
    ).toEqual([{ nome: 'Manaus', uf: 'AM' }]);
    expect(
      consultar(banco.conexao, `SELECT descricao FROM cadastros.cfop WHERE codigo = '5102'`, ctx),
    ).toHaveLength(1);
    expect(
      consultar(banco.conexao, `SELECT codigo FROM cadastros.cst WHERE tipo = 'icms' AND codigo = '00'`, ctx),
    ).toHaveLength(1);
    expect(
      consultar(
        banco.conexao,
        `SELECT cst FROM cadastros.classificacao_tributaria WHERE tipo = 'ibs_cbs' AND codigo = '000001'`,
        ctx,
      ),
    ).toEqual([{ cst: '000' }]);
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      expect(consultar(banco.conexao, 'SELECT count(*)::int AS n FROM cadastros.ncm', { papel })[0]).toEqual({
        n: lerFontes().find((c) => c.carga === 'ncm')?.registros,
      });
      const erro = falha(() =>
        executar(banco.conexao, `UPDATE cadastros.ncm SET descricao = 'x' WHERE codigo = '22021000';`, {
          papel,
          tenant: A.id,
        }),
      );
      expect(erro, papel).toMatch(/permission denied/);
    }
  });

  it('versão nova: atualiza o que continua, insere o novo e fecha o que sumiu (nada é apagado)', () => {
    pastaTemp = mkdtempSync(join(tmpdir(), 'macuxi-oficiais-'));
    cpSync(PASTA_OFICIAIS, pastaTemp, { recursive: true });
    const cfop = lerFontes().find((c) => c.carga === 'cfop')!;
    const arquivo = 'cfop/teste-nova.csv';
    const linhas = readFileSync(join(PASTA_OFICIAIS, cfop.arquivo), 'utf8').trimEnd().split('\n');
    const novas = [
      linhas[0],
      ...linhas.slice(1).filter((l) => !l.startsWith('"1000"')),
      '"7999","CFOP de teste"',
    ]
      .map((l) =>
        l!.startsWith('"5102"') ? '"5102","Venda de mercadoria adquirida de terceiros (teste)"' : l,
      )
      .join('\n');
    writeFileSync(join(pastaTemp, arquivo), `${novas}\n`);
    const nova = {
      ...cfop,
      versao: 'teste',
      arquivo,
      data_referencia: '2026-11-21',
      sha256: sha256Arquivo(join(pastaTemp, arquivo)),
    };
    writeFileSync(join(pastaTemp, 'fontes.json'), JSON.stringify({ cargas: [nova] }));

    expect(carregarOficiais(banco.conexao, pastaTemp)).toEqual(['cfop@teste']);
    const linhasCfop = consultar<{ codigo: string; descricao: string; vigencia_fim: string | null }>(
      banco.conexao,
      `SELECT codigo, descricao, vigencia_fim::text FROM cadastros.cfop WHERE codigo IN ('1000', '5102', '7999') ORDER BY 1`,
    );
    expect(linhasCfop).toEqual([
      { codigo: '1000', descricao: expect.any(String), vigencia_fim: '2026-11-21' },
      { codigo: '5102', descricao: 'Venda de mercadoria adquirida de terceiros (teste)', vigencia_fim: null },
      { codigo: '7999', descricao: 'CFOP de teste', vigencia_fim: null },
    ]);
    const [total] = consultar<{ n: number }>(banco.conexao, 'SELECT count(*)::int AS n FROM cadastros.cfop');
    expect(total?.n).toBe(690);
  });
});
