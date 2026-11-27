/**
 * Integração FDV no portal `/config` pela API (T-0056, ADR 0013) contra o PostgreSQL migrado com a 0038, com as dependências
 * de produção (`appPgDeTeste`, `pluginsPlataforma` com a chave do conector): sessão de superadmin, cifra com a
 * empresa alvo e a versão 1, 503 sem a chave mestra, 409 sem credencial, 422 sem a licença e nenhuma chamada ao Hub.
 * A chave do conector nunca aparece em resposta, log nem auditoria. Dados fictícios. Sem Postgres pula; com
 * MACUXI_PG_EXIGIR=1 falha.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CABECALHO_CSRF_CONFIG,
  CAMINHOS_INTEGRACAO_FDV_PLATAFORMA as C,
  COOKIE_CONFIG,
  decifrarCampo,
  MENSAGEM_SEM_CREDENCIAL_FDV,
  PREFIXO_PLATAFORMA,
} from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARGON2_RAPIDO, appPgDeTeste, destinoDeLogs } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';

const SENHA_SA = 'senha-do-superadmin-de-teste';
const EMAIL_SA = 'sa-portal-ifdv@exemplo.invalid';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
/** Chave mestra e chave do conector geradas a cada execução: nenhum segredo fixo no teste. */
const MESTRA = randomBytes(32);
const CHAVE = `conector-${randomBytes(24).toString('hex')}`;
const ENTRADA = { conector_id: 'erp-portal-api', chave: CHAVE, ambiente: 'teste' };

const url = (caminho: string, id: string) => `${PREFIXO_PLATAFORMA}${caminho.replace(':id', id)}`;

describe.skipIf(!PG_DISPONIVEL)('Integração FDV no portal /config pela API (T-0056, ADR 0013)', () => {
  let b: BancoEfemero;
  let comChave: FastifyInstance;
  let semChave: FastifyInstance;
  let token: string;
  let A: string;
  let SEM_CHAVE: string;
  let SEM_LICENCA: string;
  const logs: string[] = [];
  const corpos: string[] = [];
  const fetchEspiao = vi.fn<typeof fetch>(async () => {
    throw new Error('a API não chama o Hub nas rotas do portal');
  });

  const pedir = async (app: FastifyInstance, metodo: 'GET' | 'POST' | 'PUT', u: string, corpo?: unknown, chave?: string) => {
    const r = await app.inject({
      method: metodo,
      url: u,
      cookies: { [COOKIE_CONFIG]: token },
      headers: { ...CSRF, ...(chave ? { 'idempotency-key': chave } : {}) },
      ...(corpo !== undefined ? { payload: corpo as Record<string, unknown> } : {}),
    });
    corpos.push(r.body);
    return r;
  };

  const credenciais = async (t: string) =>
    (await b.admin.query('SELECT chave_cifrada, chave_prefixo, chave_mestra_versao FROM integracao_fdv.credencial WHERE tenant_id = $1', [t])).rows;
  const auditoria = async (t: string) =>
    (await b.admin.query("SELECT to_jsonb(a)::text AS linha FROM plataforma.auditoria a WHERE tenant_id = $1 AND acao LIKE 'integracao-fdv.%'", [t])).rows.map(
      (x: { linha: string }) => x.linha,
    );

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchEspiao);
    b = await criarBancoEfemero();
    await b.admin.query(
      `INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`,
      [EMAIL_SA, await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO)],
    );
    A = await criarTenant(b.admin, 'portal-api-ifdv-a', ['core', 'integracao-fdv']);
    SEM_CHAVE = await criarTenant(b.admin, 'portal-api-ifdv-sem-chave', ['core', 'integracao-fdv']);
    SEM_LICENCA = await criarTenant(b.admin, 'portal-api-ifdv-sem-lic', ['core']);
    const logger = { level: 'debug', stream: destinoDeLogs(logs) };
    ({ app: comChave } = await appPgDeTeste({ b, modulos: 'producao', chaveIntegracao: MESTRA, logger }));
    ({ app: semChave } = await appPgDeTeste({ b, modulos: 'producao', chaveIntegracao: null, logger }));
    const r = await comChave.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', remoteAddress: '10.9.0.1', headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await comChave?.close();
    await semChave?.close();
    await b?.remover();
  });

  it('com a chave mestra: PUT /credencial dá 201 e grava cifrado com a empresa alvo e a versão 1', async () => {
    expect((await pedir(comChave, 'PUT', url(C.credencial, A), ENTRADA)).statusCode).toBe(201);
    const linhas = await credenciais(A);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ chave_mestra_versao: 1 });
    expect(decifrarCampo({ chave: MESTRA, tenantId: A, cifrado: linhas[0].chave_cifrada }).toString('utf8')).toBe(CHAVE);
  });

  it('sem a chave mestra: PUT /credencial dá 503 CHAVE_INTEGRACAO_AUSENTE e nada é gravado', async () => {
    const r = await pedir(semChave, 'PUT', url(C.credencial, SEM_CHAVE), ENTRADA);
    expect([r.statusCode, r.json().codigo]).toEqual([503, 'CHAVE_INTEGRACAO_AUSENTE']);
    expect(await credenciais(SEM_CHAVE)).toEqual([]);
    expect(await auditoria(SEM_CHAVE)).toEqual([]);
    // a leitura segue de pé sem a chave
    expect((await pedir(semChave, 'GET', url(C.ler, SEM_CHAVE))).statusCode).toBe(200);
  });

  it('POST /credencial/testar sem credencial: 409 (MXI01, MENSAGEM_SEM_CREDENCIAL_FDV)', async () => {
    const r = await pedir(comChave, 'POST', url(C.testar, SEM_CHAVE), undefined, randomUUID());
    expect([r.statusCode, r.json().codigo, r.json().mensagem]).toEqual([409, 'CONFLITO', MENSAGEM_SEM_CREDENCIAL_FDV]);
  });

  it('empresa sem a licença integracao-fdv: PUT /credencial dá 422 RN-CORE-02 e nada é gravado', async () => {
    const r = await pedir(comChave, 'PUT', url(C.credencial, SEM_LICENCA), ENTRADA);
    expect([r.statusCode, r.json().codigo]).toEqual([422, 'RN-CORE-02']);
    expect(await credenciais(SEM_LICENCA)).toEqual([]);
  });

  it('nenhuma rota chamou o Hub (fetch) e a chave do conector não saiu em resposta, log nem auditoria', async () => {
    expect(fetchEspiao).not.toHaveBeenCalled();
    expect(corpos.length).toBeGreaterThan(0);
    expect(corpos.join('\n')).not.toContain(CHAVE);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(CHAVE);
    expect((await auditoria(A)).join('\n')).not.toContain(CHAVE);
  });
});
