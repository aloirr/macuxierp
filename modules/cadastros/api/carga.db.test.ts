/**
 * Carga de CSV (T-0026) contra o PostgreSQL real, no papel macuxierp_app e com RLS: grava a fixture fictícia, regrava sem
 * duplicar nem mexer em `updated_at`, isola os tenants (A e B com os MESMOS external_id) e prova o SAVEPOINT por linha.
 * Cada carga roda numa transação só (`comTenant`), como a API faz. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transacao } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RelatorioCarga } from '../contracts';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarPluginCadastros } from './index';
import { fontesHttp } from './fontes-http';
import type { Repositorios } from './portas';
import { repositoriosSql } from './sql';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
/** A fixture do domain usa um NCM sem ST; nas tabelas oficiais reais o 2106.90.30 exige CEST, então o teste troca por NCM + CEST oficiais. */
const comNcmOficial = (nome: string, b: Buffer): Buffer | string =>
  nome === 'produto.csv' ? b.toString('utf8').replace(';2106.90.30;;', ';22021000;0300700;').replace(';21069030;;', ';22021000;0300700;') : b;
const fixture = (exceto: string[] = []) =>
  readdirSync(pasta).filter((f) => f.endsWith('.csv') && !exceto.includes(f)).map((nome) => ({ nome, conteudo: comNcmOficial(nome, readFileSync(join(pasta, nome))) }));
const adm = sessaoDe('administrador');
const certificados = { filialTemA1Valido: async () => true };

describe.skipIf(!PG_DISPONIVEL)('carga de CSV no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const plugin = (repositorios: (tx: Transacao) => Repositorios = repositoriosSql) => criarPluginCadastros({ repositorios, fontes: fontesHttp(), certificados });

  /** Uma carga = uma transação do tenant (a da rota). Devolve o relatório e os eventos publicados. */
  async function carregar(tenant: string, modo: 'validar' | 'gravar', arquivos = fixture(), repositorios?: (tx: Transacao) => Repositorios) {
    return app.comTenant(tenant, async (tx) => {
      const amb = criarAmbiente(plugin(repositorios), new Date('2026-11-21T15:00:00Z'), tx);
      const r = await amb.chamar('POST', '/cargas', { sessao: adm, corpo: { modo }, arquivos });
      return { status: r.status, rel: r.corpo as RelatorioCarga, eventos: amb.eventos, auditoria: amb.auditoria };
    });
  }
  const contar = async (tabela: string, tenant: string) => (await admin(`SELECT count(*)::int AS n FROM cadastros.${tabela} WHERE tenant_id = $1`, [tenant]))[0]!.n as number;
  const TABELAS = ['filial', 'vendedor', 'condicao_pagamento', 'produto', 'produto_unidade', 'tabela_preco', 'tabela_preco_item', 'cliente', 'cliente_endereco', 'estoque_saldo', 'estoque_movimento'];
  const fotos = async (tenant: string) => Object.fromEntries(await Promise.all(TABELAS.map(async (t) => [t, await admin(`SELECT id, updated_at FROM cadastros.${t} WHERE tenant_id = $1 ORDER BY id`, [tenant])])));

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'carga-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'carga-b', ['cadastros']);
  }, 120_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('validar no banco real prevê e não grava nada', async () => {
    const v = await carregar(A, 'validar');
    expect(v.status).toBe(200);
    expect(v.rel.erros).toEqual([]);
    expect(v.rel.entidades.find((e) => e.entidade === 'cliente')).toMatchObject({ inseridas: 2 });
    for (const t of TABELAS) expect(await contar(t, A), t).toBe(0);
    expect(v.eventos).toHaveLength(0);
  }, 120_000);

  it('gravar cria os 10 arquivos; regravar não duplica, não publica e não mexe em updated_at', async () => {
    const g = await carregar(A, 'gravar');
    expect(g.rel.erros).toEqual([]);
    expect(await contar('filial', A)).toBe(1);
    expect(await contar('cliente', A)).toBe(2);
    expect(await contar('condicao_pagamento', A)).toBe(3);
    expect(await contar('tabela_preco_item', A)).toBe(2);
    expect((await admin('SELECT quantidade::float8 AS q FROM cadastros.estoque_saldo WHERE tenant_id = $1', [A]))[0]!.q).toBe(147_500);
    expect((await admin('SELECT desconto_maximo_bp FROM cadastros.tabela_preco_item WHERE tenant_id = $1 ORDER BY preco_centavos', [A])).map((l) => l.desconto_maximo_bp)).toEqual([1250, 0]);
    expect(g.eventos.length).toBeGreaterThan(10);
    const antes = await fotos(A);
    const r = await carregar(A, 'gravar');
    expect(r.rel.erros).toEqual([]);
    for (const e of r.rel.entidades.filter((x) => x.situacao === 'processado')) expect({ e: e.entidade, i: e.inseridas, a: e.atualizadas, s: e.sem_mudanca }).toEqual({ e: e.entidade, i: 0, a: 0, s: e.lidas });
    expect(r.eventos).toHaveLength(0);
    expect(await fotos(A)).toEqual(antes);
  }, 180_000);

  it('ADR 0010 / RN-CORE-05 (C-10): depois da carga com chaves do kit, preço, unidade e endereço saem com external_id; a adoção leva external_id_anterior nulo no preço', async () => {
    const T = await criarTenant(efemero.admin, 'carga-c10', ['cadastros']);
    const g = await carregar(T, 'gravar');
    expect(g.rel.erros).toEqual([]);
    const de = (n: string) => g.eventos.filter((e) => e.nome === n).map((e) => e.payload as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(de('cadastros.preco.alterado@1').map((p) => p.external_id).sort()).toEqual(['PR-EX-01', 'PR-EX-02']);
    expect(de('cadastros.produto.alterado@1').flatMap((p) => p.unidades.map((u: { external_id: string }) => u.external_id))).toContain('PU-EX-01');
    expect(de('cadastros.cliente.alterado@1').flatMap((p) => p.enderecos.map((e: { external_id: string }) => e.external_id))).toContain('CE-EX-01');
    // adoção: zera a chave dos itens e recarrega
    await admin('UPDATE cadastros.tabela_preco_item SET external_id = NULL WHERE tenant_id = $1', [T]);
    const r = await carregar(T, 'gravar');
    expect(r.rel.erros).toEqual([]);
    const adotados = r.eventos.filter((e) => e.nome === 'cadastros.preco.alterado@1').map((e) => e.payload as Record<string, unknown>);
    expect(adotados).toHaveLength(2);
    for (const p of adotados) expect(p).toMatchObject({ external_id: expect.stringMatching(/^PR-EX-0[12]$/), external_id_anterior: null });
  }, 180_000);

  it('multi-tenant: B com os MESMOS external_id; a carga em A não lê nem altera B (linhas e updated_at)', async () => {
    const b = await carregar(B, 'gravar');
    expect(b.rel.erros).toEqual([]);
    expect(await contar('cliente', B)).toBe(2);
    const fotoB = await fotos(B);
    const vend = readFileSync(join(pasta, 'vendedor.csv'), 'utf8').replace('Vendedor Exemplo 01', 'Vendedor So Do A');
    const r = await carregar(A, 'gravar', [{ nome: 'vendedor.csv', conteudo: vend }]);
    expect(r.rel.entidades.find((e) => e.entidade === 'vendedor')).toMatchObject({ atualizadas: 1 });
    expect(await fotos(B)).toEqual(fotoB);
    expect((await admin('SELECT nome FROM cadastros.vendedor WHERE tenant_id = $1', [B]))[0]!.nome).toBe('Vendedor Exemplo 01');
    expect((await admin('SELECT nome FROM cadastros.vendedor WHERE tenant_id = $1', [A]))[0]!.nome).toBe('Vendedor So Do A');
  }, 180_000);

  it('multi-tenant: a carga não enxerga cadastros do outro tenant (RF-CAD-11: a referência a ele cai como CARGA_DEPENDENCIA, pois o arquivo da dependência não veio no lote)', async () => {
    const T = await criarTenant(efemero.admin, 'carga-c', ['cadastros']);
    const r = await carregar(T, 'gravar', fixture().filter((a) => ['vendedor.csv', 'preco.csv'].includes(a.nome)));
    expect(r.rel.erros.filter((e) => e.codigo === 'CARGA_DEPENDENCIA').map((e) => e.arquivo).sort()).toContain('vendedor.csv');
    expect(r.rel.erros.some((e) => e.codigo === 'CARGA_REFERENCIA')).toBe(false);
    expect(await contar('vendedor', T)).toBe(0);
    expect(await contar('tabela_preco_item', T)).toBe(0);
  }, 120_000);

  it('RF-CAD-11: dependência já no banco não gera aviso; ausente do banco e do lote gera CARGA_DEPENDENCIA sem o valor', async () => {
    await carregar(A, 'gravar');
    const ok = await carregar(A, 'validar', fixture().filter((a) => a.nome === 'vendedor.csv'));
    expect(ok.rel.erros).toEqual([]);
    const T = await criarTenant(efemero.admin, 'carga-dep', ['cadastros']);
    const r = await carregar(T, 'validar', fixture().filter((a) => a.nome === 'produto_unidade.csv'));
    expect(r.rel.erros).toContainEqual(expect.objectContaining({ codigo: 'CARGA_DEPENDENCIA', campo: 'produto_external_id', motivo: 'Faltam produtos: carregue produto.csv antes.', entidade_faltante: 'produto' }));
    expect(r.rel.erros.filter((e) => e.codigo !== 'CARGA_DEPENDENCIA').every((e) => e.entidade_faltante === undefined)).toBe(true);
  }, 120_000);

  it('D4: adota pela chave natural o cadastro feito sem external_id, sem duplicar', async () => {
    const T = await criarTenant(efemero.admin, 'carga-d', ['cadastros']);
    await carregar(T, 'gravar');
    await admin('UPDATE cadastros.filial SET external_id = NULL WHERE tenant_id = $1', [T]);
    const r = await carregar(T, 'gravar', fixture().filter((a) => ['filial.csv'].includes(a.nome)));
    expect(r.rel.entidades.find((e) => e.entidade === 'filial')).toMatchObject({ atualizadas: 1, inseridas: 0 });
    expect(await contar('filial', T)).toBe(1);
    expect((await admin('SELECT external_id FROM cadastros.filial WHERE tenant_id = $1', [T]))[0]!.external_id).toBe('F-EX-01');
  }, 120_000);

  it('D7: erro depois da escrita numa linha desfaz só ela (SAVEPOINT); as outras ficam e a chamada segue', async () => {
    const T = await criarTenant(efemero.admin, 'carga-e', ['cadastros']);
    const prod = comNcmOficial('produto.csv', readFileSync(join(pasta, 'produto.csv')));
    // o evento do produto lê as unidades: a falha injetada vem DEPOIS do INSERT do P-EX-02, dentro do mesmo SAVEPOINT
    const falha = (tx: Transacao): Repositorios => {
      const r = repositoriosSql(tx);
      const listar = r.produtos.unidades.listar.bind(r.produtos.unidades);
      r.produtos.unidades.listar = async (paiId) => {
        const [p] = await tx.consultar<{ codigo: string }>('SELECT codigo FROM cadastros.produto WHERE id = $1', [paiId]);
        if (p?.codigo === 'SKU-EX-02') throw new Error('falha injetada');
        return listar(paiId);
      };
      return r;
    };
    const r = await carregar(T, 'gravar', [{ nome: 'produto.csv', conteudo: prod }], falha);
    expect(r.status).toBe(200);
    expect(r.rel.erros).toEqual([expect.objectContaining({ arquivo: 'produto.csv', linha: 3, codigo: 'CARGA_BANCO' })]);
    expect(r.rel.entidades.find((e) => e.entidade === 'produto')).toMatchObject({ inseridas: 1, recusadas: 1 });
    expect((await admin('SELECT codigo FROM cadastros.produto WHERE tenant_id = $1', [T])).map((l) => l.codigo)).toEqual(['SKU-EX-01']);
  }, 120_000);

  it('RN-CAD-08: ativo = não inativa (deleted_at) e ativo = sim reativa, sem apagar', async () => {
    const T = await criarTenant(efemero.admin, 'carga-f', ['cadastros']);
    await carregar(T, 'gravar');
    const vend = (ativo: string) => readFileSync(join(pasta, 'vendedor.csv'), 'utf8').replace(';sim;', `;${ativo};`);
    await carregar(T, 'gravar', [{ nome: 'vendedor.csv', conteudo: vend('nao') }]);
    expect((await admin('SELECT deleted_at IS NOT NULL AS i FROM cadastros.vendedor WHERE tenant_id = $1', [T]))[0]!.i).toBe(true);
    await carregar(T, 'gravar', [{ nome: 'vendedor.csv', conteudo: vend('sim') }]);
    expect((await admin('SELECT deleted_at IS NOT NULL AS i FROM cadastros.vendedor WHERE tenant_id = $1', [T]))[0]!.i).toBe(false);
  }, 120_000);
  it('RN-CAD-09: reativar pela carga um cartão sem parcelas (desativado pela limpeza) é erro de linha, sem 23514 nem 500', async () => {
    const T = await criarTenant(efemero.admin, 'carga-g', ['cadastros']);
    await admin(
      `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, deleted_at, external_id, forma_external_id, forma_codigo, forma_nome)
       VALUES ($1, 'CC1', 'Cartão antigo', '03', '{30}', now(), 'PZ-CC1', 'FP-CC', 'CARTAO', 'Cartão')`,
      [T],
    );
    const csv = 'external_id;codigo;nome;alterado_em;ativo;ordem\nFP-CC;CARTAO;Cartão;;sim;1\n';
    const r = await carregar(T, 'gravar', [{ nome: 'forma_pagamento.csv', conteudo: csv }]);
    expect(r.status).toBe(200);
    expect(r.rel.erros).toEqual([expect.objectContaining({ arquivo: 'forma_pagamento.csv', linha: 2, codigo: 'RN-CAD-09' })]);
    expect((await admin('SELECT deleted_at IS NOT NULL AS i FROM cadastros.condicao_pagamento WHERE tenant_id = $1', [T]))[0]!.i).toBe(true);
  }, 120_000);
  it('RN-CAD-09: o 23514 real dos CHECKs 0017/0019 (gravação que burla o domain) vira 422 RN-CAD-09 e a transação segue utilizável', async () => {
    const T = await criarTenant(efemero.admin, 'carga-h', ['cadastros']);
    const tentar = (dados: Record<string, unknown>) =>
      app.comTenant(T, async (tx) => repositoriosSql(tx).condicoesPagamento.inserir({ codigo: 'H1', descricao: 'H', ...dados } as never).catch((e: unknown) => e));
    for (const dados of [{ forma_tpag: '01', prazos_dias: [0], parcelas_cartao: 3 }, { forma_tpag: '03', prazos_dias: [30], parcelas_cartao: null }]) {
      const e = (await tentar(dados)) as { status?: number; codigo?: string };
      expect({ status: e.status, codigo: e.codigo }).toEqual({ status: 422, codigo: 'RN-CAD-09' });
    }
  }, 120_000);
});
