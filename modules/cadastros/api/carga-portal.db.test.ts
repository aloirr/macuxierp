/**
 * "Substituir tudo" do /config no PostgreSQL real (T-0058, RN-CAD-10): a inativação em lote roda na MESMA transação da carga
 * (rollback desfaz os dois), só no tenant da transação (RLS + `tenant_id`), com `deleted_at` (nunca apaga) e o evento
 * `inativo`. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, type ContextoRota, type Transacao } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { gravarCargaPortal } from './carga-portal';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const oficial = (nome: string, b: Buffer): Buffer | string =>
  nome === 'produto.csv' ? b.toString('utf8').replace(';2106.90.30;;', ';22021000;0300700;').replace(';21069030;;', ';22021000;0300700;') : b;
const fixture = () => readdirSync(pasta).filter((f) => f.endsWith('.csv')).map((nome) => ({ nome, conteudo: oficial(nome, readFileSync(join(pasta, nome))) }));
const FRASE = 'autorizo substituir tudo';
const certificados = { filialTemA1Valido: async () => true };

describe.skipIf(!PG_DISPONIVEL)('carga no /config (substituir tudo) no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
  const inativos = async (t: string) => (await admin('SELECT count(*)::int AS n FROM cadastros.produto WHERE tenant_id = $1 AND deleted_at IS NOT NULL', [t]))[0]!.n as number;
  const total = async (t: string) => (await admin('SELECT count(*)::int AS n FROM cadastros.produto WHERE tenant_id = $1', [t]))[0]!.n as number;

  async function carregarTudo(tenant: string) {
    await app.comTenant(tenant, async (tx) => {
      const amb = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }), new Date('2026-11-23T15:00:00Z'), tx);
      const r = await amb.chamar('POST', '/cargas', { sessao: sessaoDe('administrador'), corpo: { modo: 'gravar' }, arquivos: fixture() });
      expect(r.status).toBe(200);
    });
  }
  /** Só o primeiro produto no arquivo; `falhar` desfaz a transação depois do substituir. */
  async function substituir(tenant: string, falhar = false) {
    const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
    const linhas = (oficial('produto.csv', readFileSync(join(pasta, 'produto.csv'))) as string | Buffer).toString().trim().split('\n');
    const run = app.comTenant(tenant, async (tx: Transacao) => {
      const c = {
        sessao: sessaoDe('administrador'), tx, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
        publicar: async (e: { nome: string; agregado_id: string; payload: Record<string, unknown> }) => void eventos.push(e),
        auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
      } as unknown as ContextoRota;
      const r = await gravarCargaPortal({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }, c, {
        cadastro: 'produto', modo: 'substituir_tudo', frase: FRASE, arquivo: new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from(linhas.slice(0, 2).join('\n'))),
      });
      if (falhar) throw new Error('desfaz');
      return r;
    });
    return { run, eventos };
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    A = await criarTenant(efemero.admin, 'portal-a', ['cadastros']);
    B = await criarTenant(efemero.admin, 'portal-b', ['cadastros']);
    await carregarTudo(A);
    await carregarTudo(B);
  }, 180_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-10: a inativação em lote está na mesma transação da carga (erro depois desfaz tudo)', async () => {
    const { run } = await substituir(A, true);
    await expect(run).rejects.toThrow('desfaz');
    expect(await inativos(A)).toBe(0);
  }, 120_000);

  it('RN-CAD-10: inativa só no tenant da transação (deleted_at, sem apagar) e publica o evento com inativo', async () => {
    const { run, eventos } = await substituir(A);
    const r = await run;
    expect(r).toMatchObject({ gravadas: 1, inativadas: 1 });
    expect(await total(A)).toBe(2);
    expect(await inativos(A)).toBe(1);
    expect(await inativos(B)).toBe(0);
    const inativo = (await admin('SELECT id FROM cadastros.produto WHERE tenant_id = $1 AND deleted_at IS NOT NULL', [A]))[0]!.id as string;
    const ev = eventos.filter((e) => e.nome === 'cadastros.produto.alterado@1' && e.agregado_id === inativo);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.payload.inativo).toBe(true);
  }, 120_000);

  describe('reativação na carga seguinte (RN-CAD-08/10, D6)', () => {
    const csv = (n: number, ativoVazio: boolean) => {
      const l = (oficial('produto.csv', readFileSync(join(pasta, 'produto.csv'))) as string | Buffer).toString().trim().split('\n');
      return l.slice(0, n + 1).map((x, i) => (ativoVazio && i > 0 ? x.replace(';sim;', ';;') : x)).join('\n');
    };
    const rodar = (tenant: string, modo: 'adicionar' | 'substituir_tudo', conteudo: string) =>
      app.comTenant(tenant, async (tx: Transacao) => {
        const c = {
          sessao: sessaoDe('administrador'), tx, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
          publicar: async () => undefined, auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
        } as unknown as ContextoRota;
        return gravarCargaPortal({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }, c, {
          cadastro: 'produto', modo, ...(modo === 'substituir_tudo' ? { frase: FRASE } : {}), arquivo: new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from(conteudo)),
        });
      });
    const linhasDe = async (t: string) => (await admin("SELECT deleted_at FROM cadastros.produto WHERE tenant_id = $1 AND external_id = 'P-EX-02'", [t]));

    it('RN-CAD-10: substituir_tudo reativa na carga seguinte o inativado que volta SEM a coluna ativo, com uma linha só', async () => {
      const T = await criarTenant(efemero.admin, 'portal-reativa', ['cadastros']);
      await carregarTudo(T);
      await rodar(T, 'substituir_tudo', csv(1, false));
      expect((await linhasDe(T))[0]?.deleted_at).not.toBeNull();
      await rodar(T, 'substituir_tudo', csv(2, true));
      const l = await linhasDe(T);
      expect(l).toHaveLength(1);
      expect(l[0]?.deleted_at).toBeNull();
    }, 120_000);

    it('RN-CAD-08 (decisão do PO, 23/11): no adicionar, o inativado que volta no arquivo sem ativo é reativado, numa linha só', async () => {
      const T = await criarTenant(efemero.admin, 'portal-adicionar', ['cadastros']);
      await carregarTudo(T);
      await rodar(T, 'substituir_tudo', csv(1, false));
      expect((await linhasDe(T))[0]?.deleted_at).not.toBeNull();
      await rodar(T, 'adicionar', csv(2, true));
      const l = await linhasDe(T);
      expect(l).toHaveLength(1);
      expect(l[0]?.deleted_at).toBeNull();
    }, 120_000);

    it('RN-CAD-08 (decisão do PO): ativo=nao explícito continua inativo no adicionar', async () => {
      const T = await criarTenant(efemero.admin, 'portal-ativo-nao', ['cadastros']);
      await carregarTudo(T);
      await rodar(T, 'substituir_tudo', csv(1, false));
      await rodar(T, 'adicionar', csv(2, false).replace(/^(P-EX-02;.*?);sim;/m, '$1;nao;'));
      const l = await linhasDe(T);
      expect(l).toHaveLength(1);
      expect(l[0]?.deleted_at).not.toBeNull();
    }, 120_000);

    it('RN-CAD-08 (decisão do PO): a rota do BKO (POST /cargas) também reativa o inativado que volta sem ativo', async () => {
      const T = await criarTenant(efemero.admin, 'portal-bko', ['cadastros']);
      await carregarTudo(T);
      await rodar(T, 'substituir_tudo', csv(1, false));
      expect((await linhasDe(T))[0]?.deleted_at).not.toBeNull();
      await app.comTenant(T, async (tx) => {
        const amb = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }), new Date('2026-11-23T15:00:00Z'), tx);
        const r = await amb.chamar('POST', '/cargas', { sessao: sessaoDe('administrador'), corpo: { modo: 'gravar' }, arquivos: [{ nome: 'produto.csv', conteudo: csv(2, true) }] });
        expect(r.status).toBe(200);
      });
      const l = await linhasDe(T);
      expect(l).toHaveLength(1);
      expect(l[0]?.deleted_at).toBeNull();
    }, 120_000);
  });

  describe('condição de pagamento (a forma vive nela, RN-CAD-09; RN-CAD-10)', () => {
    const rodar = (tenant: string, cadastro: 'condicao_pagamento', conteudo: string) =>
      app.comTenant(tenant, async (tx: Transacao) => {
        const c = {
          sessao: sessaoDe('administrador'), tx, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
          publicar: async () => undefined, auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
        } as unknown as ContextoRota;
        return gravarCargaPortal({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }, c, {
          cadastro, modo: 'substituir_tudo', frase: FRASE, arquivo: new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from(conteudo)),
        });
      });
    const ativas = async (t: string) => (await admin('SELECT count(*)::int AS n FROM cadastros.condicao_pagamento WHERE tenant_id = $1 AND deleted_at IS NULL', [t]))[0]!.n as number;
    const arq = (nome: string, n?: number) => {
      const l = readFileSync(join(pasta, nome), 'utf8').trim().split('\n');
      return (n ? l.slice(0, n + 1) : l).join('\n');
    };

    it('RN-CAD-10: substituir_tudo com condicoes_pagamento.csv inativa só as condições ausentes', async () => {
      const T = await criarTenant(efemero.admin, 'portal-condicao', ['cadastros']);
      await carregarTudo(T);
      const antes = await ativas(T);
      await rodar(T, 'condicao_pagamento', arq('condicoes_pagamento.csv', 1));
      expect(await ativas(T)).toBe(1);
      expect(antes).toBeGreaterThan(1);
    }, 120_000);
  });
});
