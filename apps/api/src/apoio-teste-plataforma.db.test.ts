/**
 * RD-1926: a opção `plataforma` do `appPgDeTeste` monta os plugins de plataforma de PRODUÇÃO (`pluginsPlataforma`) com as
 * dependências do teste por cima. Aqui, o `cadastros` com a fonte HTTP de CNPJ dublada (só o `fetch`): o "Atualizar pela
 * Receita" (T-0101) grava a ficha sem sair à rede. Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { fontesHttp } from '@macuxierp/cadastros/api';
import { RepositorioCoreSql } from '@macuxierp/core/api';
import { CABECALHO_CSRF_CONFIG, COOKIE_CONFIG } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, ARGON2_RAPIDO } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';
import { dependenciasCadastros } from './modulos';

const EMAIL_SA = 'sa-rd1926@exemplo.invalid';
const SENHA_SA = 'senha-do-superadmin-de-teste';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
const CNPJ = '11222333000181';

describe.skipIf(!PG_DISPONIVEL)('appPgDeTeste com a opção plataforma (RD-1926)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let token: string;
  const urls: string[] = [];

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO),
    ]);
    // O único dublê: o `fetch` da BrasilAPI das fontes de produção.
    const buscar = async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ cnpj: CNPJ, razao_social: 'RD1926 FICTICIA LTDA', descricao_situacao_cadastral: 'ATIVA', uf: 'AM', codigo_municipio_ibge: 1302603 }) };
    };
    const cadastros = dependenciasCadastros(new RepositorioCoreSql(), { fontes: fontesHttp(buscar as never) });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', plataforma: { cadastros } }));
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('o "Atualizar pela Receita" de produção usa o cadastros do teste: a fonte dublada responde e a ficha é gravada', async () => {
    const id = await criarTenant(b.admin, `rd1926-${randomUUID().slice(0, 8)}`, ['core', 'cadastros']);
    await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [id, 'Empresa Antiga Ficticia', CNPJ]);
    const r = await app.inject({ method: 'POST', url: `/v1/plataforma/empresas/${id}/receita`, headers: CSRF, cookies: { [COOKIE_CONFIG]: token } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'ok' });
    expect(urls).toEqual([`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`]);
    const [e] = (await b.admin.query('SELECT razao_social, receita_fonte FROM core.empresa WHERE tenant_id = $1', [id])).rows;
    expect(e).toEqual({ razao_social: 'RD1926 FICTICIA LTDA', receita_fonte: 'brasilapi' });
  });
});
