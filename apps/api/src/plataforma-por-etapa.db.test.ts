/**
 * Rota de plataforma por etapa (T-0058, ADR 0013, adendo de 23/11/2026) contra o PostgreSQL migrado, com as dependências
 * de produção e um plugin de plataforma DE TESTE (não é rota de produção): a etapa de plataforma roda no papel
 * `macuxierp_config`; o `comTenant` abre outra transação no `macuxierp_app`, com `app.tenant_id` = `:id` da rota, e a
 * RLS mostra só as filiais desse tenant; o multipart chega com o limite da rota. Dados fictícios.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { CABECALHO_CSRF_CONFIG, COOKIE_CONFIG, definirPluginPlataforma, definirRotaPlataforma } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formulario } from './apoio-multipart';
import { ARGON2_RAPIDO, inserirFilialDeTeste, JWT_SEGREDO_DE_TESTE } from './apoio-teste';
import { criarApp } from './app';
import { gerarHashSenha } from './auth/senha';
import { montarDependenciasProducao } from './modulos';

const EMAIL_SA = 'sa-por-etapa@exemplo.invalid';
const SENHA_SA = 'senha-do-superadmin-de-teste';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
// Caminho só de teste: o `/gravar` de verdade é do plugin do cadastros, já montado pelo `montarDependenciasProducao`.
const CAMINHO = '/empresas/:id/cadastros/cargas/:cadastro/etapa-de-teste';

interface Leitura {
  papel_plataforma: string;
  papel_tenant: string;
  tenant: string;
  filiais: string[];
  outra_visivel: number;
  bytes: number;
}

/** Plugin só de teste: as três etapas da carga do portal, sem SQL de cadastros (as funções da carga são do banco-dados). */
function pluginDeTeste(outraFilial: () => string) {
  return definirPluginPlataforma([
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: CAMINHO,
      acao: 'plataforma.cadastros.carga',
      transacoes: 'por_etapa',
      tempoMaximoMs: 120_000,
      multipart: { arquivos: [{ campo: 'arquivos', tamanhoMaximo: 1_024, quantidadeMaxima: 2 }], tamanhoMaximoTotal: 1_024 },
      async executar(c, e) {
        const id = e.params.id!;
        const [p] = await c.comPlataforma((tx) => tx.consultar<{ papel: string }>('SELECT current_user::text AS papel'));
        const lido = await c.comTenant(id, async (tx) => {
          const [t] = await tx.consultar<{ papel: string; tenant: string }>("SELECT current_user::text AS papel, current_setting('app.tenant_id') AS tenant");
          const filiais = await tx.consultar<{ id: string }>('SELECT id FROM cadastros.filial ORDER BY id');
          const [o] = await tx.consultar<{ n: number }>('SELECT count(*)::int AS n FROM cadastros.filial WHERE id = $1', [outraFilial()]);
          return { papel_tenant: t!.papel, tenant: t!.tenant, filiais: filiais.map((f) => f.id), outra_visivel: o!.n };
        });
        await c.comPlataforma((tx) => tx.consultar('SELECT 1'));
        const bytes = (e.todosArquivos?.arquivos ?? []).reduce((s, a) => s + a.tamanho, 0);
        const corpo: Leitura = { papel_plataforma: p!.papel, ...lido, bytes };
        return { corpo };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: '/empresas/:id/cadastros/cargas/:cadastro/outro',
      acao: 'plataforma.cadastros.carga',
      transacoes: 'por_etapa',
      async executar(c) {
        await c.comPlataforma((tx) => tx.consultar('SELECT 1'));
        return { corpo: await c.comTenant(outraFilial(), async () => 'nunca') };
      },
    }),
  ]);
}

describe.skipIf(!PG_DISPONIVEL)('rota de plataforma por etapa: comTenant (T-0058)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  const filialA = randomUUID();
  const filialB = randomUUID();
  let token: string;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenantA = await criarTenant(b.admin, `etapa-a-${randomUUID().slice(0, 8)}`, ['core', 'cadastros']);
    tenantB = await criarTenant(b.admin, `etapa-b-${randomUUID().slice(0, 8)}`, ['core', 'cadastros']);
    await inserirFilialDeTeste(b.admin, tenantA, { id: filialA, cnpj: '11222333000181', nome: 'Matriz A (teste)' });
    await inserirFilialDeTeste(b.admin, tenantB, { id: filialB, cnpj: '11222333000181', nome: 'Matriz B (teste)' });
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO),
    ]);
    const producao = montarDependenciasProducao({
      banco: b.banco('macuxierp_app'),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
    });
    const plataforma = producao.plataforma!;
    app = await criarApp({
      ...producao,
      auth: { ...producao.auth, argon2: ARGON2_RAPIDO },
      plataforma: { ...plataforma, plugins: [...plataforma.plugins, pluginDeTeste(() => filialB)] },
      logger: false,
    });
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const enviar = (url: string, arquivos: { nome: string; conteudo: string }[], o: { token?: string } = {}) => {
    const f = formulario({ modo: 'mesclar' }, arquivos.map((a) => ({ campo: 'arquivos', conteudo: a.conteudo, nome: a.nome, tipo: 'text/csv' })));
    return app.inject({
      method: 'POST',
      url,
      payload: f.payload,
      headers: { ...f.headers, ...CSRF },
      ...(o.token === '' ? {} : { cookies: { [COOKIE_CONFIG]: o.token ?? token } }),
    });
  };
  const url = (tenant: string) => `/v1/plataforma${CAMINHO.replace(':id', tenant).replace(':cadastro', 'filial')}`;

  it('plataforma no macuxierp_config; o comTenant em outra transação no macuxierp_app, só com o tenant da rota (RLS)', async () => {
    const r = await enviar(url(tenantA), [{ nome: 'filial.csv', conteudo: 'cnpj;nome\n1;2\n' }]);
    expect(r.statusCode).toBe(200);
    const l = r.json<Leitura>();
    expect(l).toMatchObject({ papel_plataforma: 'macuxierp_config', papel_tenant: 'macuxierp_app', tenant: tenantA, filiais: [filialA], outra_visivel: 0 });
    expect(l.bytes).toBe(Buffer.byteLength('cnpj;nome\n1;2\n'));
  });

  it('outro :id na URL troca o tenant da transação, e só ele aparece', async () => {
    const r = await enviar(url(tenantB), [{ nome: 'filial.csv', conteudo: 'x' }]);
    expect(r.statusCode).toBe(200);
    expect(r.json<Leitura>()).toMatchObject({ tenant: tenantB, filiais: [filialB] });
  });

  it('comTenant com tenant que não é o :id da rota é 500 (erro de programação)', async () => {
    const r = await enviar(`/v1/plataforma/empresas/${tenantA}/cadastros/cargas/filial/outro`, []);
    expect(r.statusCode).toBe(500);
  });

  it('multipart com o limite da rota: acima do total é 413 ARQUIVO_GRANDE; sem sessão é 401 antes de ler o arquivo', async () => {
    const grande = await enviar(url(tenantA), [{ nome: 'filial.csv', conteudo: 'a'.repeat(700) }, { nome: 'filial.csv', conteudo: 'b'.repeat(700) }]);
    expect(grande.statusCode).toBe(413);
    expect(grande.json<{ codigo: string }>().codigo).toBe('ARQUIVO_GRANDE');
    const semSessao = await enviar(url(tenantA), [{ nome: 'filial.csv', conteudo: 'x' }], { token: '' });
    expect(semSessao.statusCode).toBe(401);
  });
});
