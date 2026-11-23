/**
 * Substituir tudo do cliente (com endereços) e da condição de pagamento no PostgreSQL real (T-0058, v0.3.6; RN-CAD-10): inativa com
 * `deleted_at` (nunca apaga), só no tenant da transação, na mesma transação da carga. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, type ContextoRota, type Transacao } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { aplicarSubstituicao, planejarSubstituicao } from './carga-substituir';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const oficial = (nome: string, b: Buffer): Buffer | string =>
  nome === 'produto.csv' ? b.toString('utf8').replace(';2106.90.30;;', ';22021000;0300700;').replace(';21069030;;', ';22021000;0300700;') : b;
const fixture = () => readdirSync(pasta).filter((f) => f.endsWith('.csv')).map((nome) => ({ nome, conteudo: oficial(nome, readFileSync(join(pasta, nome))) }));
const ler = (nome: string) => readFileSync(join(pasta, `${nome}.csv`), 'utf8').trim().split('\n');
const certificados = { filialTemA1Valido: async () => true };

describe.skipIf(!PG_DISPONIVEL)('Substituir tudo: cliente e condição no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const n = async (tabela: string, tenant: string, so: 'inativos' | 'todos') =>
    (await admin(`SELECT count(*)::int AS n FROM cadastros.${tabela} WHERE tenant_id = $1${so === 'inativos' ? ' AND deleted_at IS NOT NULL' : ''}`, [tenant]))[0]!.n as number;

  async function carregarTudo(tenant: string) {
    await app.comTenant(tenant, async (tx) => {
      const amb = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }), new Date('2026-11-23T15:00:00Z'), tx);
      expect((await amb.chamar('POST', '/cargas', { sessao: sessaoDe('administrador'), corpo: { modo: 'gravar' }, arquivos: fixture() })).status).toBe(200);
    });
  }
  async function substituir(tenant: string, cadastro: 'cliente' | 'condicao_pagamento', linhas: string[], falhar = false) {
    const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
    const run = app.comTenant(tenant, async (tx: Transacao) => {
      const c = {
        sessao: sessaoDe('administrador'), tx, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
        publicar: async (e: (typeof eventos)[number]) => void eventos.push(e), auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
      } as unknown as ContextoRota;
      const deps = { repositorios: repositoriosSql, fontes: fontesHttp(), certificados };
      const previsto = await planejarSubstituicao(deps, c, cadastro, new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from(linhas.join('\n'))));
      const r = await aplicarSubstituicao(deps, c, cadastro, previsto);
      if (falhar) throw new Error('desfaz');
      return r;
    });
    return { run, eventos };
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'subst-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'subst-b', ['cadastros']);
    await carregarTudo(A);
    await carregarTudo(B);
  }, 180_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('T-0058: o erro depois da inativação desfaz tudo (cliente e endereços, na mesma transação)', async () => {
    const [cab, c1] = ler('cliente');
    const { run } = await substituir(A, 'cliente', [cab!, c1!], true);
    await expect(run).rejects.toThrow('desfaz');
    expect(await n('cliente', A, 'inativos')).toBe(0);
    expect(await n('cliente_endereco', A, 'inativos')).toBe(0);
  }, 120_000);

  it('T-0058: cliente ausente e endereço ausente são inativados (deleted_at, sem apagar) só no tenant da transação', async () => {
    const totalCli = await n('cliente', A, 'todos');
    const totalEnd = await n('cliente_endereco', A, 'todos');
    const [cab, c1] = ler('cliente');
    const { run, eventos } = await substituir(A, 'cliente', [cab!, c1!]);
    const r = await run;
    expect(r.inativados).toHaveLength(1);
    expect(r.enderecos_inativados).toHaveLength(2);
    expect(await n('cliente', A, 'todos')).toBe(totalCli);
    expect(await n('cliente_endereco', A, 'todos')).toBe(totalEnd);
    expect(await n('cliente', A, 'inativos')).toBe(1);
    expect(await n('cliente_endereco', A, 'inativos')).toBe(2);
    expect(await n('cliente', B, 'inativos')).toBe(0);
    expect(await n('cliente_endereco', B, 'inativos')).toBe(0);
    const ev = eventos.filter((e) => e.nome === 'cadastros.cliente.alterado@1');
    expect(ev).toHaveLength(2);
    expect(ev.filter((e) => e.payload.inativo === true)).toHaveLength(1);
  }, 120_000);
});
