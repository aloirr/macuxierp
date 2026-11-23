/**
 * T-0050 (E6.5, parte de banco da 0035): dados da empresa e e-mail do 1º administrador no portal `/config` (ADR 0012 §2
 * e §4), pela API real (plataforma.empresa_json por trás de empresa_ler e empresas_listar) e pela função de revelar
 * (plataforma.empresa_primeiro_admin_email) no papel real macuxierp_config, com a sessão que o login da API abriu.
 * - o detalhe traz razao_social, cnpj, cidade e uf da filial padrão e primeiro_admin.email_mascarado, nunca o e-mail;
 * - a lista e a busca não trazem o e-mail (nem pela busca com o próprio e-mail);
 * - POST /empresas/:id/primeiro-admin/email (#322) devolve o e-mail em claro (EmailPrimeiroAdminResposta) com no-store,
 *   audita 'plataforma.admin.revelar_email' no tenant alvo, com o superadmin_id e o request_id e SEM o e-mail; recusado
 *   (sem CSRF, sem cookie, troca pendente, 404) não devolve o e-mail nem audita;
 * - a função do banco, chamada direto no papel real, recusa sessão inventada, encerrada ou com troca pendente (MXS01):
 *   a defesa do banco vale mesmo se a guarda da API falhar.
 * O db/testes/empresa-dados-0035.db.test.ts (banco-dados) cobre a máscara, os nulos e os privilégios função a função;
 * aqui entra a costura com a API.
 * Dados fictícios (exemplo.invalid; município 1302603 de uma tabela oficial de teste). Sem Postgres pula.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, destinoDeLogs } from '../../../apps/api/src/apoio-teste';
import { CABECALHOS_SENHA_PROVISORIA, EmailPrimeiroAdminResposta } from '../../../packages/platform-sdk/src/index';
import { atalhosPortal, erroComoPapel, inserirSuperadmin, PAPEL_CONFIG, SENHA_SA, sha256, type AppPortal } from '../../apoio/portal-pg';

const EMAIL_SA = 'sa-e6-email@exemplo.invalid';
const EMAIL_SA_TROCA = 'sa-e6-email-troca@exemplo.invalid';
const SLUG = 'e6-email-admin';
const SLUG_SEM_ADM = 'e6-email-sem-admin';
const EMAIL_ADM = 'joana.fict-e6@exemplo.invalid';
const MASCARADO = 'jo****@exemplo.invalid';
const CNPJ = '12345678000195';
const REVELAR = (id: string) => `SELECT plataforma.empresa_primeiro_admin_email('${id}', 'req-e6-revelar') AS email`;

interface Empresa {
  id: string;
  razao_social: string | null;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  primeiro_admin: { email_mascarado: string; [k: string]: unknown } | null;
}

describe.skipIf(!PG_DISPONIVEL)('portal /config: dados da empresa e e-mail do 1º admin (T-0050 E6.5, migração 0035)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  const logs: string[] = [];
  let token = '';
  let empresa = '';
  let superadmin = '';
  let semAdmin = '';
  const URL_EMAIL = (id: string) => `/v1/plataforma/empresas/${id}/primeiro-admin/email`;

  /** Id da sessão do portal (o que a API põe em macuxierp.sessao_superadmin) a partir do token do cookie. */
  const sessaoDe = async (t: string) =>
    (await b.admin.query<{ sessao_id: string }>('SELECT sessao_id FROM plataforma.superadmin_sessao_por_token($1)', [sha256(t)])).rows[0]?.sessao_id;
  const erroRevelar = (sessao: string | undefined) => erroComoPapel(b, PAPEL_CONFIG, { sessao, confirmar: true }, REVELAR(empresa));
  const auditoriasRevelar = async () =>
    (
      await b.admin.query<{ tenant_id: string; usuario_id: string | null; superadmin_id: string; entidade: string; request_id: string; antes: unknown; depois: unknown }>(
        "SELECT tenant_id, usuario_id, superadmin_id, entidade, request_id, antes, depois FROM plataforma.auditoria WHERE acao = 'plataforma.admin.revelar_email' ORDER BY ocorrido_em",
      )
    ).rows;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    superadmin = await inserirSuperadmin(b, EMAIL_SA);
    await inserirSuperadmin(b, EMAIL_SA_TROCA, { deveTrocar: true });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', logger: { level: 'info', stream: destinoDeLogs(logs) } }));
    p = atalhosPortal(app);
    token = await p.sessao(EMAIL_SA);
    const criada = await p.pedir('POST', '/v1/plataforma/empresas', { token, corpo: { slug: SLUG, nome: 'Empresa Fictícia E-mail E6' }, chave: randomUUID() });
    empresa = criada.json<{ id: string }>().id;
    const vazia = await p.pedir('POST', '/v1/plataforma/empresas', { token, corpo: { slug: SLUG_SEM_ADM, nome: 'Empresa Fictícia Sem Admin E6' }, chave: randomUUID() });
    semAdmin = vazia.json<{ id: string }>().id;
    const adm = await p.pedir('POST', `/v1/plataforma/empresas/${empresa}/primeiro-admin`, { token, corpo: { email: EMAIL_ADM, nome: 'Joana Fictícia' }, chave: randomUUID() });
    expect(adm.statusCode).toBe(201);
    // Dados do tenant que o administrador cadastraria no BKO: empresa e filial padrão em Manaus (tabela oficial de teste).
    const versao = randomUUID();
    await b.admin.query(
      `INSERT INTO cadastros.tabela_oficial_versao (id, tabela, carga, versao, fonte, url, data_referencia, arquivo, sha256, registros)
       VALUES ($1, 'municipio', 'municipio-e6', 't-e6', 'IBGE (teste)', 'https://exemplo.invalid', '2026-01-01', 'municipio.csv', repeat('e', 64), 1)`,
      [versao],
    );
    await b.admin.query("INSERT INTO cadastros.municipio (codigo, nome, uf, vigencia_inicio, vigencia_fim, versao_id) VALUES ('1302603', 'Manaus', 'AM', '2020-01-01', NULL, $1)", [versao]);
    await b.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Fictícia E-mail E6 Ltda', $2)", [empresa, CNPJ]);
    await b.admin.query(
      `INSERT INTO cadastros.filial (tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, padrao, emissora, nfe_serie, nfe_numero_inicial)
       VALUES ($1, $2, 'Filial Fictícia E6', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000', true, true, 1, 1)`,
      [empresa, CNPJ],
    );
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('GET /empresas/:id: razão social, CNPJ, cidade/UF da filial padrão e só o e-mail mascarado do 1º admin', async () => {
    const r = await p.pedir('GET', `/v1/plataforma/empresas/${empresa}`, { token });
    expect(r.statusCode).toBe(200);
    expect(r.json<Empresa>()).toMatchObject({
      id: empresa,
      razao_social: 'Empresa Fictícia E-mail E6 Ltda',
      cnpj: CNPJ,
      cidade: 'Manaus',
      uf: 'AM',
      primeiro_admin: { email_mascarado: MASCARADO },
    });
    expect(r.body).not.toContain(EMAIL_ADM);
    expect(r.body).not.toContain('joana.fict');
  });

  it('GET /empresas (lista e busca): nunca o e-mail; a busca é só no slug (o e-mail não acha a empresa)', async () => {
    const lista = await p.pedir('GET', '/v1/plataforma/empresas', { token });
    const busca = await p.pedir('GET', `/v1/plataforma/empresas?busca=${SLUG}`, { token });
    for (const r of [lista, busca]) {
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain(empresa);
      expect(r.body).not.toContain(EMAIL_ADM);
      expect(r.body).not.toContain('joana.fict');
    }
    for (const termo of [EMAIL_ADM, 'joana.fict']) {
      const r = await p.pedir('GET', `/v1/plataforma/empresas?busca=${encodeURIComponent(termo)}`, { token });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain(empresa);
      expect(r.body).not.toContain(EMAIL_ADM);
    }
  });

  it('POST .../primeiro-admin/email recusado (sem CSRF, sem cookie, troca de senha pendente): sem o e-mail e sem auditoria', async () => {
    const semCsrf = await Promise.all([false, '0'].map((csrf) => p.pedir('POST', URL_EMAIL(empresa), { token, csrf: csrf as false | string })));
    const semCookie = await p.pedir('POST', URL_EMAIL(empresa));
    const troca = await p.pedir('POST', URL_EMAIL(empresa), { token: await p.sessao(EMAIL_SA_TROCA) });
    for (const r of semCsrf) expect(r.json<{ codigo: string }>()).toMatchObject({ codigo: 'ORIGEM_RECUSADA' });
    expect(semCsrf.map((r) => r.statusCode)).toEqual([403, 403]);
    expect(semCookie.statusCode).toBe(401);
    expect(troca.statusCode).toBe(403);
    expect(troca.json<{ codigo: string }>().codigo).toBe('TROCAR_SENHA');
    for (const r of [...semCsrf, semCookie, troca]) expect(r.body).not.toContain(EMAIL_ADM);
    expect(await auditoriasRevelar()).toHaveLength(0);
  });

  it('POST .../primeiro-admin/email: empresa sem administrador ou inexistente = 404, sem auditoria', async () => {
    for (const id of [semAdmin, randomUUID()]) {
      const r = await p.pedir('POST', URL_EMAIL(id), { token });
      expect(r.statusCode, id).toBe(404);
      expect(r.body).not.toContain('@');
    }
    expect(await auditoriasRevelar()).toHaveLength(0);
  });

  it('POST .../primeiro-admin/email: 200 com o e-mail em claro (EmailPrimeiroAdminResposta), no-store, e auditoria no tenant alvo sem o e-mail', async () => {
    const r = await p.pedir('POST', URL_EMAIL(empresa), { token });
    expect(r.statusCode).toBe(200);
    expect(EmailPrimeiroAdminResposta.parse(r.json())).toEqual({ email: EMAIL_ADM });
    for (const [k, v] of Object.entries(CABECALHOS_SENHA_PROVISORIA)) expect(r.headers[k], k).toBe(v);
    const aud = await auditoriasRevelar();
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ tenant_id: empresa, usuario_id: null, superadmin_id: superadmin, entidade: 'usuario', request_id: r.headers['x-request-id'], antes: null });
    const texto = JSON.stringify([aud[0]!.antes, aud[0]!.depois]);
    expect(texto).not.toContain(EMAIL_ADM);
    expect(texto).not.toContain('joana.fict');
    expect(texto).not.toContain('@');
    // sem idempotência: nada da resposta guardado no banco
    const idem = await b.admin.query("SELECT resposta FROM plataforma.idempotencia WHERE rota LIKE '%primeiro-admin/email%'");
    expect(JSON.stringify(idem.rows)).not.toContain(EMAIL_ADM);
  });

  it('função do banco direto no papel real: sem sessão, sessão inventada, troca pendente ou encerrada = MXS01; nada auditado', async () => {
    const antes = (await auditoriasRevelar()).length;
    expect(await erroRevelar(undefined)).toBe('MXS01');
    expect(await erroRevelar(randomUUID())).toBe('MXS01');
    const troca = await p.entrar(EMAIL_SA_TROCA, SENHA_SA);
    expect(troca.statusCode).toBe(200);
    expect(await erroRevelar(await sessaoDe(p.cookieDe(troca)))).toBe('MXS01');
    // sessão encerrada pelo "sair" da API
    const outro = await p.sessao(EMAIL_SA);
    const sessao = await sessaoDe(outro);
    expect((await p.pedir('POST', '/v1/plataforma/auth/sair', { token: outro })).statusCode).toBe(204);
    expect(await erroRevelar(sessao)).toBe('MXS01');
    expect(await auditoriasRevelar()).toHaveLength(antes);
  });

  it('regra 8: o log pino da API (inclusive o da revelação) não traz o e-mail do admin (nem a parte local)', () => {
    const tudo = logs.join('\n');
    expect(tudo).toContain('/primeiro-admin/email');
    for (const x of [EMAIL_ADM, 'joana.fict', MASCARADO]) expect(tudo).not.toContain(x);
  });
});
