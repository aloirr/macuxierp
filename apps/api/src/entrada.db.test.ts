/**
 * `/v1/entrada` (e o legado `/entrada/v1`) de ponta a ponta (T-0057 E3, ADR 0014 §1, §3 e §4) contra o PostgreSQL migrado com a 0071, com as
 * dependências de produção (`appPgDeTeste`, `montarDependenciasProducao`): o portal `/config` cria a chave (só o HMAC com
 * o pepper vai ao banco), o conector manda o lote, lê o lote e o cursor, e a revogação, a empresa suspensa e a falta do
 * pepper fecham a entrada. A chave nunca aparece em log nem auditoria. Dados fictícios. Sem Postgres pula; com
 * MACUXI_PG_EXIGIR=1 falha.
 */
import { randomBytes } from 'node:crypto';
import {
  CABECALHO_CONECTOR_ID_ENTRADA,
  CABECALHO_CSRF_CONFIG,
  CAMINHOS_ENTRADA_PLATAFORMA as C,
  CODIGO_EMPRESA_INATIVA_ENTRADA,
  COOKIE_CONFIG,
  CredencialEntradaCriada,
  PortalEntradaLeitura,
  PREFIXO_ENTRADA,
  PREFIXOS_ENTRADA,
  PREFIXO_PLATAFORMA,
} from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARGON2_RAPIDO, appPgDeTeste, destinoDeLogs } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';
import { hmacChaveEntrada } from './entrada/autenticacao';

const SENHA_SA = 'senha-do-superadmin-de-teste';
const EMAIL_SA = 'sa-portal-entrada@exemplo.invalid';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
/** Pepper gerado a cada execução: nenhum segredo fixo no teste. */
const PEPPER = randomBytes(32);

const url = (caminho: string, id: string) => `${PREFIXO_PLATAFORMA}${caminho.replace(':id', id)}`;
const registro = (n: number) => ({ external_id: `V${n}`, alterado_em: '2026-11-27T01:00:00.000Z', ativo: true, nome: `Vendedor ${n}` });
const LOTE = {
  versao_contrato: 'v1', entidade: 'vendedor', modo: 'delta', enviado_em: '2026-11-27T01:00:00.000Z', cursor: null,
  registros: [registro(1), registro(2)], linhas_invalidas: [], linhas_invalidas_omitidas: 0,
};

describe.skipIf(!PG_DISPONIVEL)('/v1/entrada (e o legado /entrada/v1) de ponta a ponta pela API (T-0057 E3)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let semPepper: FastifyInstance;
  let token: string;
  let A: string;
  let OUTRA: string;
  const logs: string[] = [];

  const portal = (a: FastifyInstance, method: 'GET' | 'POST' | 'DELETE', u: string, payload?: Record<string, unknown>) =>
    a.inject({ method, url: u, cookies: { [COOKIE_CONFIG]: token }, headers: CSRF, ...(payload ? { payload } : {}) });
  const entrada = (a: FastifyInstance, method: 'GET' | 'POST', u: string, conector: string, chave: string, payload?: Record<string, unknown>, idem?: string, prefixo = PREFIXO_ENTRADA) =>
    a.inject({
      method,
      url: `${prefixo}${u}`,
      headers: { authorization: `Bearer ${chave}`, [CABECALHO_CONECTOR_ID_ENTRADA]: conector, ...(idem ? { 'idempotency-key': idem } : {}) },
      ...(payload ? { payload } : {}),
    });
  const criarChave = async (tenant: string, conector: string) => {
    const r = await portal(app, 'POST', url(C.credencial, tenant), { conector_id: conector });
    expect(r.statusCode, r.body).toBe(201);
    return CredencialEntradaCriada.parse(r.json());
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await b.admin.query(
      `INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`,
      [EMAIL_SA, await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO)],
    );
    A = await criarTenant(b.admin, 'entrada-api-a', ['core', 'cadastros']);
    OUTRA = await criarTenant(b.admin, 'entrada-api-outra', ['core', 'cadastros']);
    const logger = { level: 'debug', stream: destinoDeLogs(logs) };
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', pepperEntrada: PEPPER, logger }));
    ({ app: semPepper } = await appPgDeTeste({ b, modulos: 'producao', logger }));
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', remoteAddress: '10.9.0.2', headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await semPepper?.close();
    await b?.remover();
  });

  it('o portal cria a chave (só o HMAC no banco), o conector manda o lote, lê o lote e o cursor, e a revogação fecha na hora', async () => {
    const cred = await criarChave(A, 'erp-entrada-a');
    expect(cred).toMatchObject({ conector_id: 'erp-entrada-a', prefixo: cred.chave.slice(0, 8) });
    const [guardada] = (await b.admin.query('SELECT encode(chave_hmac, \'hex\') AS h FROM cadastros.entrada_credencial WHERE tenant_id = $1', [A])).rows;
    expect(guardada.h).toBe(hmacChaveEntrada(PEPPER, cred.chave));

    const aceito = await entrada(app, 'POST', '/lotes', cred.conector_id, cred.chave, LOTE, 'lote-e3-0001');
    expect(aceito.statusCode, aceito.body).toBe(202);
    expect(aceito.json()).toMatchObject({ status: 'recebido', entidade: 'vendedor', recebidos: 2 });
    const lido = await entrada(app, 'GET', `/lotes/${aceito.json().lote_id}`, cred.conector_id, cred.chave);
    expect([lido.statusCode, lido.json().status]).toEqual([200, 'recebido']);
    const cursor = await entrada(app, 'GET', '/cursores/vendedor', cred.conector_id, cred.chave);
    expect([cursor.statusCode, cursor.json()]).toEqual([200, { entidade: 'vendedor', cursor: null, atualizado_em: null }]);
    const [trabalho] = (await b.admin.query("SELECT count(*)::int AS n FROM plataforma.trabalho WHERE tenant_id = $1 AND tipo = 'cadastros.entrada_lote'", [A])).rows;
    expect(trabalho.n).toBe(1);

    const leitura = await portal(app, 'GET', url(C.ler, A));
    expect(leitura.statusCode, leitura.body).toBe(200);
    const corpo = PortalEntradaLeitura.parse(leitura.json());
    expect(corpo.credenciais).toEqual([{ conector_id: 'erp-entrada-a', prefixo: cred.prefixo, criada_em: cred.criada_em, revogada_em: null }]);
    expect(corpo.lotes).toEqual([expect.objectContaining({ entidade: 'vendedor', modo: 'delta', status: 'recebido', recebidos: 2 })]);

    const rev = await portal(app, 'DELETE', `${url(C.credencial, A)}?conector_id=erp-entrada-a`);
    expect([rev.statusCode, rev.json().conector_id]).toEqual([200, 'erp-entrada-a']);
    expect((await entrada(app, 'GET', '/cursores/vendedor', cred.conector_id, cred.chave)).statusCode).toBe(401);
    expect((await portal(app, 'DELETE', `${url(C.credencial, A)}?conector_id=erp-entrada-a`)).statusCode).toBe(404);

    // a chave nunca vai a log nem a auditoria
    const auditoria = (await b.admin.query("SELECT to_jsonb(a)::text AS l FROM plataforma.auditoria a WHERE acao LIKE 'cadastros.entrada.%'", [])).rows.map((x: { l: string }) => x.l);
    expect(auditoria.length).toBeGreaterThanOrEqual(2);
    for (const l of [...logs, ...auditoria]) expect(l).not.toContain(cred.chave);
  });

  it('trocar a chave invalida a anterior na hora; o conector_id fica preso à empresa (409 em outra)', async () => {
    const velha = await criarChave(A, 'erp-entrada-troca');
    const nova = await criarChave(A, 'erp-entrada-troca');
    expect((await entrada(app, 'GET', '/cursores/vendedor', 'erp-entrada-troca', velha.chave)).statusCode).toBe(401);
    expect((await entrada(app, 'GET', '/cursores/vendedor', 'erp-entrada-troca', nova.chave)).statusCode).toBe(200);
    const r = await portal(app, 'POST', url(C.credencial, OUTRA), { conector_id: 'erp-entrada-troca' });
    expect([r.statusCode, r.json().codigo]).toEqual([409, 'CONFLITO']);
  });

  it('ADR 0014 §1: empresa suspensa responde 403 EMPRESA_INATIVA, com a chave certa', async () => {
    const cred = await criarChave(OUTRA, 'erp-entrada-suspensa');
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [OUTRA]);
    try {
      const r = await entrada(app, 'GET', '/cursores/vendedor', cred.conector_id, cred.chave);
      expect([r.statusCode, r.json().codigo]).toEqual([403, CODIGO_EMPRESA_INATIVA_ENTRADA]);
    } finally {
      await b.admin.query("UPDATE plataforma.tenant SET situacao = 'ativo' WHERE id = $1", [OUTRA]);
    }
  });

  it('sem o pepper: criar a chave e a /entrada/v1 respondem 503; ler segue', async () => {
    expect((await portal(semPepper, 'POST', url(C.credencial, A), { conector_id: 'erp-sem-pepper' })).statusCode).toBe(503);
    expect((await entrada(semPepper, 'GET', '/cursores/vendedor', 'erp-entrada-troca', 'a'.repeat(43))).statusCode).toBe(503);
    expect((await portal(semPepper, 'GET', url(C.ler, A))).statusCode).toBe(200);
  });
  // ADR 0014, adendo de 27/11 (hotfix v0.3.24).
  it('toda rota pública da api fica sob o /v1 (o túnel só manda o /v1* à api); a única exceção é o legado da entrada', () => {
    const rotas = caminhosDasRotas(app.printRoutes({ commonPrefix: false }));
    expect(rotas.length).toBeGreaterThan(50);
    // literais de propósito: o teste não pode passar só porque a constante mudou junto (o legado sai no contract)
    const fora = rotas.filter((r) => !r.startsWith('/v1/'));
    expect(fora.filter((r) => !r.startsWith('/entrada/v1/')), fora.join(', ')).toEqual([]);
    for (const c of ['/lotes', '/lotes/:id', '/cursores/:entidade', '/sinal']) expect(rotas).toContain(`/v1/entrada${c}`);
  });

  it('o prefixo novo /v1/entrada e o legado respondem igual; o hook do /v1 não confunde a chave do conector com o JWT do BKO', async () => {
    const cred = await criarChave(A, 'erp-entrada-prefixos');
    for (const prefixo of PREFIXOS_ENTRADA) {
      const r = await entrada(app, 'GET', '/cursores/vendedor', cred.conector_id, cred.chave, undefined, undefined, prefixo);
      expect([r.statusCode, r.json()], `${prefixo}: ${r.body}`).toEqual([200, { entidade: 'vendedor', cursor: null, atualizado_em: null }]);
    }
    const aceito = await entrada(app, 'POST', '/lotes', cred.conector_id, cred.chave, LOTE, 'lote-prefixo-0001');
    expect(aceito.statusCode, aceito.body).toBe(202);
    // o consulta do lote aceito aponta para o prefixo novo
    expect(aceito.json<{ consulta: string }>().consulta).toBe(`${PREFIXO_ENTRADA}/lotes/${aceito.json<{ lote_id: string }>().lote_id}`);
    // a chave errada continua 401 no prefixo novo (o JWT do BKO não abre a entrada)
    expect((await entrada(app, 'GET', '/cursores/vendedor', cred.conector_id, 'b'.repeat(43))).statusCode).toBe(401);
    // o que a conferência pelo domínio do publicar espera (conferir-logos.mjs): POST /v1/entrada/sinal sem chave = 401 JSON
    const semChave = await app.inject({ method: 'POST', url: `${PREFIXO_ENTRADA}/sinal`, payload: {} });
    expect([semChave.statusCode, semChave.headers['content-type'], semChave.json().codigo]).toEqual([401, expect.stringMatching(/^application\/json/), 'NAO_AUTENTICADO']);
  });
});

/** Os caminhos completos das rotas a partir da árvore do `printRoutes` do Fastify (uma linha por segmento). */
function caminhosDasRotas(arvore: string): string[] {
  const pilha: string[] = [];
  const rotas: string[] = [];
  for (const linha of arvore.split('\n')) {
    const m = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+)(?: \((.+)\))?/.exec(linha);
    if (!m) continue;
    const nivel = m[1]!.length / 4;
    pilha.length = nivel;
    pilha[nivel] = m[2]!;
    if (m[3]) rotas.push(pilha.join(''));
  }
  return rotas;
}
