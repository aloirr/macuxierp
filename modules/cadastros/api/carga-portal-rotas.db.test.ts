/**
 * Rotas do portal no PostgreSQL real (T-0058, 0040): iniciar e concluir pelas funções do banco (sessão de superadmin, sem
 * `BYPASSRLS`), a etapa do tenant na RLS do `macuxierp_app`, a execução em `cadastros.carga_portal` e a situação. A
 * transação de plataforma é montada aqui com o admin do teste e a sessão posta (a troca de papel e o 409/422 do SQLSTATE
 * são da apps/api). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, CAMINHOS_CARGAS_PLATAFORMA, ErroApi, type ContextoPlataformaPorEtapa, type SituacaoCargasPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarPluginPlataformaCadastros } from './carga-portal-rotas';
import { fontesHttp } from './fontes-http';
import { criarPluginCadastros } from './index';
import { repositoriosSql } from './sql';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const oficial = (nome: string, b: Buffer): Buffer | string =>
  nome === 'produto.csv' ? b.toString('utf8').replace(';2106.90.30;;', ';22021000;0300700;').replace(';21069030;;', ';22021000;0300700;') : b;
const fixture = () => readdirSync(pasta).filter((f) => f.endsWith('.csv')).map((nome) => ({ nome, conteudo: oficial(nome, readFileSync(join(pasta, nome))) }));
const FRASE = 'autorizo substituir tudo';
const certificados = { filialTemA1Valido: async () => true };
const SA = '5a000000-0000-4000-8000-000000000458';
const SESSAO = '5e000000-0000-4000-8000-000000000458';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

describe.skipIf(!PG_DISPONIVEL)('rotas da carga do portal no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  const admin = async (sql: string, p: unknown[] = []): Promise<Record<string, any>[]> => (await efemero.admin.query(sql, p)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** `ContextoPlataformaPorEtapa` de teste: uma transação de cada vez, a de plataforma com a sessão posta, a do tenant na RLS. */
  const contexto = (): ContextoPlataformaPorEtapa => ({
    sessao: { superadmin_id: SA, sessao_id: SESSAO }, request_id: `req-${randomUUID()}`, agora: new Date('2026-11-23T15:00:00Z'),
    async comPlataforma<R>(f: (tx: Transacao) => Promise<R>): Promise<R> {
      const cli = await efemero.admin.connect();
      try {
        await cli.query('BEGIN');
        await cli.query("SELECT set_config('macuxierp.sessao_superadmin', $1, true)", [SESSAO]);
        const r = await f({ consultar: async <L>(sql: string, p: readonly unknown[] = []) => (await cli.query(sql, [...p])).rows as L[] });
        await cli.query('COMMIT');
        return r;
      } catch (e) {
        await cli.query('ROLLBACK');
        throw e;
      } finally {
        cli.release();
      }
    },
    comTenant: (tenant, f) => app.comTenant(tenant, f),
  });
  const eventos: string[] = [];
  const plugin = () => criarPluginPlataformaCadastros({
    deps: { repositorios: repositoriosSql, fontes: fontesHttp(), certificados },
    outbox: { gravar: async (_t, e) => { eventos.push(e.nome); return 1; } },
  });
  const chamar = (tenant: string, caminho: string, cadastro: string, conteudo: string | Buffer, o: { modo?: string; frase?: string } = {}) =>
    plugin().rotas.find((r) => r.caminho === caminho)!.executar(contexto(), {
      corpo: o.frase === undefined ? {} : { frase: o.frase }, consulta: { modo: o.modo ?? 'adicionar' }, params: { id: tenant, cadastro },
      cabecalhos: {}, arquivos: {}, todosArquivos: { arquivo: [new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from(conteudo))] },
    });
  const execucoes = (t: string) => admin('SELECT cadastro, modo, resultado, gravadas, com_erro, inativadas, superadmin_id FROM cadastros.carga_portal WHERE tenant_id = $1 ORDER BY iniciada_em', [t]);
  const produto = () => (oficial('produto.csv', readFileSync(join(pasta, 'produto.csv'))) as string | Buffer).toString().trim().split('\n');
  const ativosProduto = async (t: string) => (await admin('SELECT count(*)::int AS n FROM cadastros.produto WHERE tenant_id = $1 AND deleted_at IS NULL', [t]))[0]!.n as number;

  async function novoTenant(slug: string): Promise<string> {
    const t = await criarTenant(efemero.admin, slug, ['cadastros']);
    await app.comTenant(t, async (tx) => {
      const amb = criarAmbiente(criarPluginCadastros({ repositorios: repositoriosSql, fontes: fontesHttp(), certificados }), new Date('2026-11-23T15:00:00Z'), tx);
      expect((await amb.chamar('POST', '/cargas', { sessao: sessaoDe('administrador'), corpo: { modo: 'gravar' }, arquivos: fixture() })).status).toBe(200);
    });
    return t;
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    app = efemero.banco('macuxierp_app');
    await admin(`INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'sa0058@plataforma.teste', 'Superadmin Ficticio', $2, false, true)`, [SA, HASH]);
    await admin(`INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em) VALUES ($1, $2, encode(sha256(convert_to($3, 'UTF8')), 'hex'), now() + interval '8 hours', now())`, [SESSAO, SA, SESSAO]);
  }, 180_000);
  afterAll(async () => {
    await efemero?.remover();
  });

  it('RN-CAD-10: gravar substituir_tudo abre a execução, inativa no tenant e conclui com as contagens (superadmin na execução)', async () => {
    const T = await novoTenant('rota-subst');
    const outro = await novoTenant('rota-outro');
    const r = await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', produto().slice(0, 2).join('\n'), { modo: 'substituir_tudo', frase: FRASE });
    expect(r.corpo).toMatchObject({ cadastro: 'produto', modo: 'substituir_tudo', gravadas: 1, inativadas: 1 });
    expect(await ativosProduto(T)).toBe(1);
    expect(await ativosProduto(outro)).toBe(2);
    expect(await execucoes(T)).toEqual([{ cadastro: 'produto', modo: 'substituir_tudo', resultado: 'concluida', gravadas: 1, com_erro: 0, inativadas: 1, superadmin_id: SA }]);
    const aud = await admin("SELECT acao, superadmin_id FROM plataforma.auditoria WHERE tenant_id = $1 AND acao LIKE 'cadastros.carga.%' ORDER BY ocorrido_em", [T]);
    expect(aud.map((a) => a.acao)).toEqual(['cadastros.carga.iniciar', 'cadastros.carga.concluir']);
    expect(aud.every((a) => a.superadmin_id === SA)).toBe(true);
  }, 120_000);

  it('RN-CAD-10: a auditoria do concluir leva enderecos_inativados no depois só no Substituir tudo do cliente (o do produto não grava a chave)', async () => {
    const T = await novoTenant('rota-aud-end');
    const depoisDe = async () => (await admin("SELECT depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'cadastros.carga.concluir' ORDER BY ocorrido_em DESC LIMIT 1", [T]))[0]!.depois as Record<string, unknown>;
    const cliente = (oficial('cliente.csv', readFileSync(join(pasta, 'cliente.csv'))) as string | Buffer).toString().trim().split('\n');
    await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'cliente', cliente.slice(0, 2).join('\n'), { modo: 'substituir_tudo', frase: FRASE });
    expect(await depoisDe()).toMatchObject({ inativadas: 1, enderecos_inativados: 2 });
    await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', produto().slice(0, 2).join('\n'), { modo: 'substituir_tudo', frase: FRASE });
    expect(await depoisDe()).not.toHaveProperty('enderecos_inativados');
  }, 120_000);

  it('RN-CAD-10: a situação reflete a carga concluída (portal_carga_situacao)', async () => {
    const T = await novoTenant('rota-situacao');
    await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', produto().slice(0, 2).join('\n'));
    const s = (await contexto().comPlataforma((tx) => tx.consultar<{ s: { cadastros: { cadastro: string; ativos: number; ultima_carga: { quantidade: number } | null }[] } }>('SELECT cadastros.portal_carga_situacao($1) AS s', [T])))[0]!.s;
    expect(s.cadastros.find((x) => x.cadastro === 'produto')).toMatchObject({ ativos: 2, ultima_carga: { quantidade: 1 } });
  }, 120_000);

  it('RF-CAD-11: GET situacao devolve as 8 linhas no formato do SDK, com a carga concluída e a 0040', async () => {
    const T = await novoTenant('rota-situacao-get');
    await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', produto().slice(0, 2).join('\n'));
    const r = await plugin().rotas.find((x) => x.caminho === CAMINHOS_CARGAS_PLATAFORMA.situacao)!.executar(contexto(), { corpo: undefined, consulta: undefined, params: { id: T } });
    const s = r.corpo as SituacaoCargasPlataforma;
    expect(s).toMatchObject({ empresa_id: T, modulo_licenciado: true });
    expect(s.cadastros).toHaveLength(8);
    expect(s.cadastros.find((x) => x.cadastro === 'produto')).toMatchObject({ situacao: 'carregado', ultima_carga: { quantidade: 1 } });
  }, 120_000);

  it('RN-CAD-10: falha na etapa do tenant desfaz o tenant e conclui a execução como falhou (o erro original sobe)', async () => {
    const T = await novoTenant('rota-falha');
    const e = await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', 'coluna_errada\nx\n', { modo: 'substituir_tudo', frase: FRASE }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect(e).toMatchObject({ status: 409, detalhes: { codigo: 'nada_a_gravar' } });
    expect(await ativosProduto(T)).toBe(2);
    expect(await execucoes(T)).toMatchObject([{ resultado: 'falhou', gravadas: 0, com_erro: 0, inativadas: null }]);
    // livre de novo: a próxima carga não é barrada
    await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', produto().join('\n'));
  }, 120_000);

  it('RN-CAD-10: carga em andamento na empresa barra a seguinte com MXC01 (a apps/api responde 409 carga_em_andamento)', async () => {
    const T = await novoTenant('rota-andamento');
    await contexto().comPlataforma((tx) => tx.consultar('SELECT cadastros.portal_carga_iniciar($1, $2, $3, $4)', [T, 'produto', 'adicionar', 'req-aberta']));
    await expect(chamar(T, CAMINHOS_CARGAS_PLATAFORMA.gravar, 'produto', produto().join('\n'))).rejects.toMatchObject({ code: 'MXC01' });
    expect(await execucoes(T)).toMatchObject([{ resultado: null }]);
  }, 120_000);

  it('RN-CAD-10: validar não grava, não abre execução e prevê o efeito', async () => {
    const T = await novoTenant('rota-validar');
    const r = await chamar(T, CAMINHOS_CARGAS_PLATAFORMA.validar, 'produto', produto().slice(0, 2).join('\n'), { modo: 'substituir_tudo' });
    expect(r.corpo).toMatchObject({ prontas: 1, com_erro: 0, efeito: { total: 2, a_inativar: 1 } });
    expect(await ativosProduto(T)).toBe(2);
    expect(await execucoes(T)).toEqual([]);
  }, 120_000);
});
