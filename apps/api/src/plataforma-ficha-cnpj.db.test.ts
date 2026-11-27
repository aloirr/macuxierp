/**
 * RN-CORE-16 (v0.3.24): a ligação da porta `ConsultaNfeProducao` do faturamento no plugin de plataforma do core, pela
 * MONTAGEM DE PRODUÇÃO (`montarDependenciasProducao`, sem sobrescrever plugin). Prova que a situação da troca de CNPJ não
 * sai `consulta_indisponivel`, que a troca não é 503 por porta ausente (troca de verdade, auditada com uma ação de
 * `ACOES_PLATAFORMA`) e que, com NF-e autorizada em produção no tenant, a troca é bloqueada. Dados fictícios.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { ACOES_PLATAFORMA, CABECALHO_CSRF_CONFIG, COOKIE_CONFIG } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE } from './apoio-teste';
import { criarApp } from './app';
import { gerarHashSenha } from './auth/senha';
import { montarDependenciasProducao } from './modulos';

const EMAIL_SA = 'sa-ficha-cnpj@exemplo.invalid';
const SENHA_SA = 'senha-do-superadmin-de-teste';
const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' };
const CNPJ_ATUAL = '11222333000181';
const CNPJ_NOVO = '11444777000161';
/** Outro CNPJ válido para o teste do bloqueio: o CNPJ_NOVO já fica em uso depois do 1º teste. */
const CNPJ_NOVO_2 = '12345678000195';

describe.skipIf(!PG_DISPONIVEL)('Ficha da Receita: porta de NF-e em produção ligada na montagem de produção (RN-CORE-16)', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  let token: string;
  let seq = 0;

  const empresa = async () => {
    const id = await criarTenant(b.admin, `ficha-cnpj-${randomUUID().slice(0, 8)}`, ['core', 'cadastros', 'faturamento']);
    await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [id, 'Empresa Ficticia Ficha', CNPJ_ATUAL]);
    return id;
  };

  /** NF-e autorizada em produção semeada como admin, com os gatilhos de estado desligados só nesta conexão (a porta lê ambiente e status). */
  const notaAutorizadaProducao = async (tenant: string) => {
    seq += 1;
    const cnf = String(10_000_000 + seq);
    const chave = `13261112345678000195${'55'}001${String(seq).padStart(9, '0')}1${cnf}1`;
    const c = await b.admin.connect();
    try {
      await c.query("SET session_replication_role = 'replica'");
      await c.query(
        `INSERT INTO faturamento.nota (tenant_id, filial_id, cliente_id, ambiente, serie, numero, chave_acesso, c_nf, status, natureza_operacao, idempotencia_chave, protocolo, autorizada_em, tipo_emissao)
         VALUES ($1, $2, $3, 'producao', 1, $4, $5, $6, 'autorizada', 'Venda', $7, '113260000000001', $8, 1)`,
        [tenant, randomUUID(), randomUUID(), seq, chave, cnf, `idem-ficha-${seq}`, new Date('2026-11-20T12:00:00Z')],
      );
    } finally {
      await c.query('RESET session_replication_role');
      c.release();
    }
  };

  const situacao = (id: string) => app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${id}/cnpj`, cookies: { [COOKIE_CONFIG]: token } });
  const trocar = (id: string, cnpj_novo = CNPJ_NOVO) =>
    app.inject({ method: 'POST', url: `/v1/plataforma/empresas/${id}/cnpj`, headers: CSRF, cookies: { [COOKIE_CONFIG]: token }, payload: { cnpj_novo, confirmacao: true } });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await b.admin.query(`INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'Superadmin de teste', $2, false, true)`, [
      EMAIL_SA,
      await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO),
    ]);
    const producao = montarDependenciasProducao({
      banco: b.banco('macuxierp_app'),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
    });
    app = await criarApp({ ...producao, auth: { ...producao.auth, argon2: ARGON2_RAPIDO }, logger: false });
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', headers: CSRF, payload: { email: EMAIL_SA, senha: SENHA_SA } });
    expect(r.statusCode).toBe(200);
    token = r.cookies.find((x) => x.name === COOKIE_CONFIG)!.value;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('sem NF-e em produção: situação permitida e a troca grava, auditada com plataforma.empresa.trocar_cnpj (ACOES_PLATAFORMA)', async () => {
    const id = await empresa();
    const s = await situacao(id);
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json()).toEqual({ permitida: true });
    const t = await trocar(id);
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json()).toEqual({ estado: 'ok', cnpj: CNPJ_NOVO });
    const aud = (await b.admin.query<{ acao: string }>("SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 AND entidade = 'empresa'", [id])).rows;
    expect(aud.map((a) => a.acao)).toContain('plataforma.empresa.trocar_cnpj');
    for (const a of aud) expect(ACOES_PLATAFORMA).toContain(a.acao);
  });

  it('com NF-e autorizada em produção no tenant: situação bloqueada e a troca bloqueada, sem mudar o CNPJ', async () => {
    const id = await empresa();
    await notaAutorizadaProducao(id);
    const s = await situacao(id);
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json()).toMatchObject({ permitida: false, motivo: 'nfe_autorizada_producao' });
    const t = await trocar(id, CNPJ_NOVO_2);
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json()).toMatchObject({ estado: 'bloqueado', motivo: 'nfe_autorizada_producao' });
    const [e] = (await b.admin.query('SELECT cnpj FROM core.empresa WHERE tenant_id = $1', [id])).rows;
    expect(e).toEqual({ cnpj: CNPJ_ATUAL });
  });
});
