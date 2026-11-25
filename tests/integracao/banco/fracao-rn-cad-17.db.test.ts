/**
 * T-0097, K-1 e K-3 do plano da v0.3.13 (RN-CAD-17: fração só em KG e M, até 4 casas; R-20261124-211517), no PostgreSQL
 * real, no papel macuxierp_app e com RLS, pela rota de produção do cadastros (`POST /cargas` e as rotas de unidade e de
 * movimento), cada chamada numa transação do tenant como a API faz. Só o que o teste do módulo não cobre: a carga grava no
 * banco as linhas válidas e recusa só a imprópria, com arquivo, linha, campo e motivo; a unidade do produto pela carga
 * (`produto_unidade.csv`, campo `fator`) segue a mesma regra da rota; a troca de unidade no PATCH não deixa fator
 * fracionário em unidade que só aceita inteiro; e nada é gravado quando a rota recusa. Dados fictícios.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transacao } from '../../../packages/platform-sdk/src/index';
import type { BancoPg } from '../../../packages/platform-sdk/src/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { criarAmbiente, sessaoDe } from '../../../modules/cadastros/api/apoio-teste';
import { criarPluginCadastros, fontesHttp, repositoriosSql } from '../../../modules/cadastros/api/index';
import type { RelatorioCarga } from '../../../modules/cadastros/contracts';
import { comNcmOficial, PASTA_FIXTURE_CARGA } from '../../apoio/fixture-carga';

const PASTA = PASTA_FIXTURE_CARGA;
const fixture = (trocas: Record<string, string> = {}) =>
  readdirSync(PASTA)
    .filter((f) => f.endsWith('.csv') && f !== 'titulo.csv')
    .map((nome) => ({ nome, conteudo: Buffer.from(trocas[nome] ?? comNcmOficial(nome, readFileSync(join(PASTA, nome), 'utf8'))) }));

const CAB_ESTOQUE = 'external_id;deposito_external_id;produto_external_id;saldo;alterado_em;ativo;deposito_nome;filial_external_id';
const CAB_UNIDADE = 'external_id;produto_external_id;unidade;fator;alterado_em;ativo;ean;padrao';
const adm = sessaoDe('administrador');
const certificados = { filialTemA1Valido: async () => true };

describe.skipIf(!PG_DISPONIVEL)('RN-CAD-17 no banco real: carga e rotas do cadastro (T-0097, K-1 e K-3)', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  const admin = async (sql: string, p: unknown[] = []) => (await efemero.admin.query(sql, p)).rows as Record<string, unknown>[];
  const plugin = () => criarPluginCadastros({ repositorios: repositoriosSql as (tx: Transacao) => never, fontes: fontesHttp(), certificados });
  const chamar = (tenant: string, metodo: 'POST' | 'PATCH', caminho: string, o: { corpo?: unknown; arquivos?: { nome: string; conteudo: Buffer }[] }) =>
    app.comTenant(tenant, async (tx) => {
      const r = await criarAmbiente(plugin(), new Date('2026-11-24T15:00:00Z'), tx).chamar(metodo, caminho, { sessao: adm, ...o });
      return { status: r.status, corpo: r.corpo as Record<string, unknown> };
    });
  const carregar = async (tenant: string, modo: 'validar' | 'gravar', trocas: Record<string, string>) => {
    const r = await chamar(tenant, 'POST', '/cargas', { corpo: { modo }, arquivos: fixture(trocas) });
    return { status: r.status, rel: r.corpo as unknown as RelatorioCarga };
  };
  const saldos = async (tenant: string) =>
    (
      await admin(
        'SELECT p.external_id, s.quantidade::float8 AS q FROM cadastros.estoque_saldo s JOIN cadastros.produto p ON p.tenant_id = s.tenant_id AND p.id = s.produto_id WHERE s.tenant_id = $1 ORDER BY p.external_id',
        [tenant],
      )
    ).map((l) => `${l.external_id}=${l.q}`);
  const unidades = async (tenant: string) =>
    (await admin('SELECT unidade, fator::float8 AS f FROM cadastros.produto_unidade WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY unidade', [tenant])).map((l) => `${l.unidade}=${l.f}`);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('[K-3] estoque.csv: saldo 10,5 em produto UN é erro só da própria linha (arquivo, linha, campo saldo, RN-CAD-17, motivo) e não grava; a linha válida (2,25 em KG) grava', async () => {
    const T = await criarTenant(efemero.admin, 'fracao-estoque', ['cadastros']);
    // P-EX-01 é UN e P-EX-02 vira KG na fixture: a linha 2 (UN, 10,5) é a imprópria; a 3 (KG, 2,25) é válida.
    const produtoKg = comNcmOficial('produto.csv', readFileSync(join(PASTA, 'produto.csv'), 'utf8')).replace('Produto Exemplo 02;CX;', 'Produto Exemplo 02;KG;');
    const estoque = `${CAB_ESTOQUE}\nE-EX-01;D1;P-EX-01;10,5;;sim;Deposito 1;F-EX-01\nE-EX-02;D2;P-EX-02;2,25;;sim;Deposito 2;F-EX-01\n`;
    const g = await carregar(T, 'gravar', { 'produto.csv': produtoKg, 'estoque.csv': estoque });
    expect(g.status).toBe(200);
    const doEstoque = g.rel.erros.filter((e) => e.arquivo === 'estoque.csv');
    expect(doEstoque).toEqual([expect.objectContaining({ arquivo: 'estoque.csv', linha: 2, campo: 'saldo', codigo: 'RN-CAD-17' })]);
    expect(String((doEstoque[0] as { motivo?: string }).motivo)).toMatch(/KG e M/);
    // ×10^4: 2,25 → 22 500 no P-EX-02; o P-EX-01 fica sem saldo (nenhuma linha ou zero).
    const s = await saldos(T);
    expect(s.filter((x) => x.startsWith('P-EX-02='))).toEqual(['P-EX-02=22500']);
    expect(s.filter((x) => x.startsWith('P-EX-01=') && x !== 'P-EX-01=0')).toEqual([]);
  }, 120_000);

  it('[K-1/K-3] produto_unidade.csv: sem teto de fator (12000 grava); 0, negativo e mais de 4 casas são erro da própria linha no campo fator', async () => {
    const T = await criarTenant(efemero.admin, 'fracao-unidade', ['cadastros']);
    // A recusa de 1,5 fora de KG e o 1,5 em KG ficam no carga.db.test.ts do cadastros. Sem o teto de 9999 (#625), a carga
    // segue a rota (Qtd4 ≥ 1, sem máximo) e o banco (fator > 0): zero e negativo são erro da linha, nunca o CHECK do banco.
    const grande = await carregar(T, 'gravar', { 'produto_unidade.csv': `${CAB_UNIDADE}\nPU-EX-03;P-EX-01;FD;12000;;sim;;nao\n` });
    expect(grande.rel.erros).toEqual([]);
    expect(await unidades(T)).toContain('FD=120000000');
    for (const fator of ['0', '-2', '0,00001']) {
      const r = await carregar(T, 'validar', { 'produto_unidade.csv': `${CAB_UNIDADE}\nPU-EX-04;P-EX-01;PC;${fator};;sim;;nao\n` });
      expect(r.status, fator).toBe(200);
      expect(r.rel.erros, fator).toEqual([expect.objectContaining({ arquivo: 'produto_unidade.csv', linha: 2, campo: 'fator' })]);
    }
  }, 120_000);

  it('[K-1] rotas da unidade no banco: CX com fator 1,5 é 422 no campo fator e nada grava; PATCH que troca KG (1,5) para CX é 422; o fator inteiro passa', async () => {
    const T = await criarTenant(efemero.admin, 'fracao-rota', ['cadastros']);
    expect((await carregar(T, 'gravar', { 'produto_unidade.csv': `${CAB_UNIDADE}\n` })).rel.erros).toEqual([]);
    const pid = (await admin("SELECT id FROM cadastros.produto WHERE tenant_id = $1 AND external_id = 'P-EX-01'", [T]))[0]!.id as string;
    const cx = await chamar(T, 'POST', `/produtos/${pid}/unidades`, { corpo: { unidade: 'CX', fator: 15_000 } });
    expect(cx.status).toBe(422);
    expect(cx.corpo).toMatchObject({ codigo: 'RN-CAD-17' });
    expect(JSON.stringify(cx.corpo)).toContain('fator');
    expect(await unidades(T)).toEqual([]);
    const kg = await chamar(T, 'POST', `/produtos/${pid}/unidades`, { corpo: { unidade: 'KG', fator: 15_000 } });
    expect(kg.status).toBe(201);
    const troca = await chamar(T, 'PATCH', `/produtos/${pid}/unidades/${kg.corpo.id as string}`, { corpo: { unidade: 'CX' } });
    expect(troca.status).toBe(422);
    expect(await unidades(T)).toEqual(['KG=15000']);
    expect((await chamar(T, 'POST', `/produtos/${pid}/unidades`, { corpo: { unidade: 'CX', fator: 120_000 } })).status).toBe(201);
  }, 120_000);
});
