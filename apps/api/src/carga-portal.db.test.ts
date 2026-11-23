/**
 * Carga de cadastros pelo portal `/config` na API de produção (T-0058, v0.3.5a; ADR 0013, adendo de 23/11/2026): o
 * `montarDependenciasProducao` monta o plugin de plataforma do cadastros com as dependências do BKO e a outbox da API.
 * Ponta a ponta no PostgreSQL migrado (0040): sessão de superadmin, CSRF, multipart, `gravar` em `adicionar` de um CSV
 * pequeno de filial; a filial fica no tenant (RLS) e o evento sai na outbox.
 * Dados fictícios. Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import {
  CABECALHO_CSRF_CONFIG,
  CAMINHOS_CARGAS_PLATAFORMA as C,
  CAMPO_ARQUIVO_CARGA_PORTAL,
  COOKIE_CONFIG,
  PREFIXO_PLATAFORMA,
} from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formulario } from './apoio-multipart';
import { ARGON2_RAPIDO, appPgDeTeste } from './apoio-teste';
import { gerarHashSenha } from './auth/senha';

const EMAIL_SA = 'sa-carga-portal@exemplo.invalid';
const SENHA_SA = 'senha-do-superadmin-de-teste';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
/** Uma filial fictícia, no layout do modelo do portal (cabeçalho e separador `;`). */
const CSV_FILIAL = [
  'external_id;codigo;nome;alterado_em;ativo;cidade;uf;cnpj;logradouro;numero;complemento;bairro;cep;telefone;crt;ie;regime_pis_cofins',
  'F-PORTAL-01;01;Filial Fictícia do Portal;;sim;Manaus;AM;99.000.001/0001-01;Rua Exemplo;100;;Centro;69000-000;0000000000;3;012300004;nao_cumulativo',
  '',
].join('\n');

describe.skipIf(!PG_DISPONIVEL)('carga de cadastros no portal /config pela API de produção (T-0058)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let tenant: string;
  let token: string;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, `carga-portal-${randomUUID().slice(0, 8)}`, ['core', 'cadastros']);
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO),
    ]);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao' }));
    const r = await app.inject({ method: 'POST', url: `${PREFIXO_PLATAFORMA}/auth/entrar`, headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const gravar = (o: { csrf?: boolean } = {}) => {
    const f = formulario({}, [{ campo: CAMPO_ARQUIVO_CARGA_PORTAL, conteudo: Buffer.from(CSV_FILIAL), nome: 'filiais.csv', tipo: 'text/csv' }]);
    return app.inject({
      method: 'POST',
      url: `${PREFIXO_PLATAFORMA}${C.gravar.replace(':id', tenant).replace(':cadastro', 'filial')}?modo=adicionar`,
      payload: f.payload,
      headers: { ...f.headers, ...(o.csrf === false ? {} : CSRF) },
      cookies: { [COOKIE_CONFIG]: token },
    });
  };

  it('sem o cabeçalho de CSRF é 403 e nada é gravado', async () => {
    expect((await gravar({ csrf: false })).statusCode).toBe(403);
    expect((await b.admin.query('SELECT count(*)::int AS n FROM cadastros.filial WHERE tenant_id = $1', [tenant])).rows[0].n).toBe(0);
  });

  it('gravar em adicionar: a filial entra no tenant, o evento sai na outbox e a situação mostra carregado', async () => {
    const r = await gravar();
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ gravadas: 1, com_erro: 0 });

    const filiais = await b.admin.query<{ external_id: string }>('SELECT external_id FROM cadastros.filial WHERE tenant_id = $1 AND deleted_at IS NULL', [tenant]);
    expect(filiais.rows.map((f) => f.external_id)).toEqual(['F-PORTAL-01']);
    const eventos = await b.admin.query<{ n: number }>("SELECT count(*)::int AS n FROM plataforma.evento WHERE tenant_id = $1 AND nome LIKE 'cadastros.%'", [tenant]);
    expect(eventos.rows[0]!.n).toBeGreaterThan(0);
  });
});
