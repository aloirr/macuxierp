/**
 * T-0101, etapa 2 (plano da v0.3.13, R-1 a R-6 na rota): "Atualizar pela Receita" e "Revelar" do portal `/config` na API
 * real, num só PostgreSQL efêmero com a migração 0063 (`empresa_ler` com a ficha, `empresa_gravar_receita`,
 * `empresa_contato_revelar`), no papel real `macuxierp_config`, com a sessão que o login da API abriu.
 * A montagem é a de produção (`montarDependenciasProducao` → `pluginsPlataforma`); só o plugin de plataforma do core é
 * recriado com a porta REAL dos cadastros (`criarConsultaCnpjParaCore`, rota por etapa do #666: consulta e cache no papel e
 * na RLS do tenant) sobre uma fonte HTTP dublê, nunca a rede. A montagem com a fonte HTTP real (#665) fica com a testes-2.
 * Cobre: perfil (só superadmin, CSRF, troca pendente, função sem EXECUTE no papel do BKO), empresa inexistente (404) e sem
 * `core.empresa` (409), gravação da ficha plana, cache do tenant sem contato, auditoria só com nomes de campo, repetição do
 * request_id (idempotência do banco), consulta pelo cache, falha da fonte (ficha e data intactas), Revelar auditado sem o
 * valor, RLS entre tenants e o log sem e-mail, telefone nem CPF.
 * Dados fictícios (tests/apoio/ficha-receita.ts). Sem Postgres pula.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { CABECALHOS_SENHA_PROVISORIA } from '../../../packages/platform-sdk/src/index';
import { ARGON2_RAPIDO, destinoDeLogs, JWT_SEGREDO_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { criarApp, type DependenciasApp } from '../../../apps/api/src/app';
import { gerarHashSenha } from '../../../apps/api/src/auth/senha';
import { montarDependenciasProducao } from '../../../apps/api/src/modulos';
import { criarPluginPlataformaCore, RepositorioPlataformaSql } from '../../../modules/core/api/index';
import { ContatoRevelado, FichaReceitaPlanaMascarada, ResultadoReceitaPlana } from '../../../modules/core/contracts/index';
import { MENSAGEM_SEM_CNPJ, mensagemDaFalhaReceita } from '../../../modules/core/domain/index';
import { criarConsultaCnpjParaCore, repositoriosSql, type FonteExterna } from '../../../modules/cadastros/api/index';
import { brutaBrasilApi, CNPJ_FICHA as CNPJ_A, CPF_FICHA as CPF, CPF_FICHA_FMT as CPF_FMT, EMAIL_FICHA as EMAIL, TELEFONE_FICHA as TELEFONE } from '../../apoio/ficha-receita';
import {
  atalhosPortal,
  comoPapel,
  erroComoPapel,
  inserirSuperadmin,
  PAPEL_CONFIG,
  semearMunicipioManaus,
  sha256,
  type AppPortal,
  type RespostaPortal,
} from '../../apoio/portal-pg';

const EMAIL_SA = 'sa-t0101-ficha@exemplo.invalid';
const EMAIL_SA_TROCA = 'sa-t0101-ficha-troca@exemplo.invalid';
const CNPJ_B = '12345678000195';
const EMAIL_MASC = 'co****@exemplo.invalid';
const TELEFONE_MASC = '(92) ****-4567';

/** Ficha da empresa A: razão social de MEI com o CPF, um CNAE secundário repetido e um igual ao principal. */
const brutaA = (): Record<string, unknown> =>
  brutaBrasilApi({
    razao_social: `FICHA FICTICIA T0101 ${CPF_FMT}`,
    nome_fantasia: 'FICHA T0101',
    cnaes_secundarios: [{ codigo: 4637199 }, { codigo: 4930202 }, { codigo: 4637199 }, { codigo: 4639701 }],
  });

type ModoFonte = 'ok' | 'fora' | 'nao_encontrado';

/**
 * Fonte HTTP dublê (nunca a rede) atrás da porta REAL dos cadastros (`criarConsultaCnpjParaCore`: validação, cache de 24 h
 * do tenant, IBGE oficial e o mapeamento `sugestaoCnpj`). `fora` lança (fonte indisponível) e `nao_encontrado` responde vazio.
 */
function fonteDeTeste(estado: { modo: ModoFonte; chamadas: string[] }): FonteExterna<Record<string, unknown>> {
  return {
    id: 'brasilapi',
    async consultar(chave) {
      estado.chamadas.push(chave);
      if (estado.modo === 'fora') throw new Error('fonte fora do ar (dublê)');
      return estado.modo === 'nao_encontrado' ? null : brutaA();
    },
  };
}

interface Auditoria {
  tenant_id: string;
  superadmin_id: string;
  entidade: string;
  entidade_id: string;
  request_id: string;
  antes: unknown;
  depois: { campos?: string[]; fonte?: string; campo?: string };
}
type Erro = { codigo: string; mensagem: string };

async function criarEmpresa(p: ReturnType<typeof atalhosPortal>, token: string, slug: string): Promise<string> {
  const r = await p.pedir('POST', '/v1/plataforma/empresas', { token, corpo: { slug, nome: `Empresa Fictícia ${slug}` }, chave: randomUUID() });
  expect(r.statusCode, r.body).toBe(201);
  return r.json<{ id: string }>().id;
}

const URL_RECEITA = (id: string) => `/v1/plataforma/empresas/${id}/receita`;
const URL_REVELAR = (id: string, campo: string) => `/v1/plataforma/empresas/${id}/contato/${campo}`;

describe.skipIf(!PG_DISPONIVEL)('ficha da Receita no /config (T-0101 etapa 2, um banco efêmero)', () => {
  let b: BancoEfemero;
  let superadmin = '';
  /** As dependências de produção da API, sem nada trocado. */
  const montarProducao = (): DependenciasApp => {
    const producao = montarDependenciasProducao({
      banco: b.banco('macuxierp_app'),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
    });
    return { ...producao, auth: { ...producao.auth, argon2: ARGON2_RAPIDO } };
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await semearMunicipioManaus(b);
    superadmin = await inserirSuperadmin(b, EMAIL_SA);
    await inserirSuperadmin(b, EMAIL_SA_TROCA, { deveTrocar: true });
  }, 180_000);
  afterAll(async () => {
    await b?.remover();
  });

  describe('porta de consulta ligada: atualizar, revelar, auditoria, RLS e log (R-1 a R-6)', () => {
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  const logs: string[] = [];
  const fonte: { modo: ModoFonte; chamadas: string[] } = { modo: 'ok', chamadas: [] };
  let token = '';
  let A = '';
  let B = '';
  let SEM = '';

  const auditorias = async (acao: string, tenant?: string) =>
    (
      await b.admin.query<Auditoria>(
        `SELECT tenant_id, superadmin_id, entidade, entidade_id, request_id, antes, depois FROM plataforma.auditoria
          WHERE acao = $1 AND ($2::uuid IS NULL OR tenant_id = $2::uuid) ORDER BY ocorrido_em`,
        [acao, tenant ?? null],
      )
    ).rows;
  const linhaEmpresa = async (tenant: string) =>
    (await b.admin.query('SELECT * FROM core.empresa WHERE tenant_id = $1 AND deleted_at IS NULL', [tenant])).rows[0] as Record<string, unknown> | undefined;
  const atualizar = (id: string, o: { requestId?: string; token?: string; csrf?: false } = {}): Promise<RespostaPortal> =>
    p.pedir('POST', URL_RECEITA(id), {
      ...(o.token === '' ? {} : { token: o.token ?? token }),
      ...(o.csrf === false ? { csrf: false } : {}),
      cabecalhos: { 'x-request-id': o.requestId ?? randomUUID() },
    });
  const semCache = (r: RespostaPortal) => {
    for (const [k, v] of Object.entries(CABECALHOS_SENHA_PROVISORIA)) expect(r.headers[k], k).toBe(v);
  };
  const semContatoInteiro = (texto: string) => {
    for (const x of [EMAIL, 'contato.ficha', TELEFONE, '3222-4567', '32224567', CPF, CPF_FMT]) expect(texto, x).not.toContain(x);
  };

  beforeAll(async () => {
    const producao = montarProducao();
    const plataforma = producao.plataforma!;
    // Só o plugin do core muda: o mesmo de produção (repositório SQL real), com a porta de consulta ligada.
    const ehDoCore = (pl: (typeof plataforma.plugins)[number]) => pl.rotas.some((r) => r.caminho === '/empresas/:id/receita');
    expect(plataforma.plugins.filter(ehDoCore)).toHaveLength(1);
    const manifestos = producao.modulos.map((m) => ({ id: m.manifesto.id, depende: m.manifesto.depende }));
    const core = criarPluginPlataformaCore({
      repo: new RepositorioPlataformaSql(),
      manifestos,
      hashSenha: (s) => gerarHashSenha(s, ARGON2_RAPIDO),
      consultaReceita: criarConsultaCnpjParaCore({ repositorios: repositoriosSql, fontes: { cnpj: [fonteDeTeste(fonte)], cep: [] }, relogio: { agora: () => new Date() } }),
    });
    app = await criarApp({
      ...producao,
      plataforma: { ...plataforma, plugins: plataforma.plugins.map((pl) => (ehDoCore(pl) ? core : pl)) },
      logger: { level: 'info', stream: destinoDeLogs(logs) },
    });
    p = atalhosPortal(app);
    token = await p.sessao(EMAIL_SA);
    A = await criarEmpresa(p, token, 't0101-ficha-a');
    B = await criarEmpresa(p, token, 't0101-ficha-b');
    SEM = await criarEmpresa(p, token, 't0101-ficha-sem');
    await b.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Fictícia A Ltda', $2)", [A, CNPJ_A]);
    await b.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Fictícia B Ltda', $2)", [B, CNPJ_B]);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  it('perfil: sem cookie (401), sem CSRF (403) e superadmin com troca pendente (403) não consultam, não gravam nem auditam', async () => {
    const semCookie = await atualizar(A, { token: '' });
    const semCsrf = await atualizar(A, { csrf: false });
    const troca = await atualizar(A, { token: await p.sessao(EMAIL_SA_TROCA) });
    expect([semCookie.statusCode, semCsrf.statusCode, troca.statusCode]).toEqual([401, 403, 403]);
    expect(troca.json<Erro>().codigo).toBe('TROCAR_SENHA');
    const revSemCookie = await p.pedir('POST', URL_REVELAR(A, 'email'));
    const revSemCsrf = await p.pedir('POST', URL_REVELAR(A, 'email'), { token, csrf: false });
    expect([revSemCookie.statusCode, revSemCsrf.statusCode]).toEqual([401, 403]);
    expect(fonte.chamadas).toEqual([]);
    expect((await linhaEmpresa(A))!.receita_consultada_em).toBeNull();
    expect(await auditorias('plataforma.empresa.atualizar_receita')).toHaveLength(0);
    expect(await auditorias('plataforma.empresa.revelar_contato', A)).toHaveLength(0);
  });

  it('perfil no banco: as funções da ficha não têm EXECUTE no papel do BKO e, no papel do portal, sem sessão = MXS01', async () => {
    const gravar = `SELECT plataforma.empresa_gravar_receita('${A}', '{"fonte":"brasilapi"}'::jsonb, 'req-t0101-bko')`;
    const revelar = `SELECT plataforma.empresa_contato_revelar('${A}', 'email', 'req-t0101-bko')`;
    for (const sql of [gravar, revelar]) {
      expect(await erroComoPapel(b, 'macuxierp_app', { tenant: A }, sql)).toBe('42501');
      expect(await erroComoPapel(b, PAPEL_CONFIG, { sessao: randomUUID() }, sql)).toBe('MXS01');
    }
  });

  it('tenant: empresa inexistente = 404; empresa sem core.empresa (sem filial padrão) = 409 com a mensagem do ADR e nada gravado (R-6)', async () => {
    const inexistente = await atualizar(randomUUID());
    expect(inexistente.statusCode).toBe(404);
    const sem = await atualizar(SEM);
    expect(sem.statusCode).toBe(409);
    expect(sem.json<Erro>()).toMatchObject({ codigo: 'CONFLITO', mensagem: MENSAGEM_SEM_CNPJ });
    const rev = await p.pedir('POST', URL_REVELAR(SEM, 'email'), { token });
    expect(rev.statusCode).toBe(409);
    expect(fonte.chamadas).toEqual([]);
    expect(await linhaEmpresa(SEM)).toBeUndefined();
    expect(await auditorias('plataforma.empresa.atualizar_receita')).toHaveLength(0);
  });

  it('R-1: grava a ficha plana completa com fonte e data, responde só os nomes dos campos e a ficha mascarada (no-store) e audita sem valores', async () => {
    fonte.modo = 'ok';
    const req = randomUUID();
    const antes = new Date();
    const r = await atualizar(A, { requestId: req });
    expect(r.statusCode, r.body).toBe(200);
    semCache(r);
    const res = ResultadoReceitaPlana.parse(r.json());
    expect(res.estado).toBe('ok');
    if (res.estado !== 'ok') return;
    expect(res.campos_alterados).toEqual(
      [
        'bairro', 'cep', 'cnae_principal', 'cnae_secundarios', 'complemento', 'data_abertura', 'email', 'logradouro', 'municipio_ibge',
        'natureza_juridica', 'nome_fantasia', 'numero', 'porte', 'razao_social', 'regime_receita', 'situacao_cadastral',
        'situacao_cadastral_data', 'telefone', 'uf',
      ].sort(),
    );
    expect(FichaReceitaPlanaMascarada.parse(res.ficha)).toMatchObject({
      nome_fantasia: 'FICHA T0101',
      logradouro: 'AVENIDA DAS FICÇÕES',
      numero: '100',
      complemento: 'GALPÃO 2',
      bairro: 'DISTRITO INDUSTRIAL',
      cep: '69075000',
      municipio_ibge: '1302603',
      uf: 'AM',
      email_mascarado: EMAIL_MASC,
      telefone_mascarado: TELEFONE_MASC,
      cnae_principal: '4639701',
      cnae_secundarios: ['4637199', '4930202'],
      regime_receita: 'simples',
      situacao_cadastral: 'ATIVA',
      situacao_cadastral_data: '2015-03-10',
      data_abertura: '2014-07-21',
      natureza_juridica: '2062 - Sociedade Empresária Limitada',
      porte: 'EMPRESA DE PEQUENO PORTE',
      receita_fonte: 'brasilapi',
    });
    semContatoInteiro(r.body);
    expect(fonte.chamadas).toEqual([CNPJ_A]);

    // banco: a ficha plana gravada, o CNPJ intacto, a razão social sem o CPF, e-mail e telefone completos só no banco
    const l = (await linhaEmpresa(A))!;
    expect(l).toMatchObject({
      cnpj: CNPJ_A,
      razao_social: 'FICHA FICTICIA T0101',
      email: EMAIL,
      telefone: TELEFONE,
      cnae_principal: '4639701',
      cnae_secundarios: ['4637199', '4930202'],
      receita_fonte: 'brasilapi',
    });
    expect((l.receita_consultada_em as Date).getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);

    // a porta real gravou o cache da consulta no tenant A, sem e-mail, telefone nem CPF (RN-CAD-05)
    const cache = await b.admin.query('SELECT tenant_id, resposta FROM cadastros.consulta_externa WHERE chave = $1', [CNPJ_A]);
    expect(cache.rows.map((c) => c.tenant_id)).toEqual([A]);
    semContatoInteiro(JSON.stringify(cache.rows));

    // leitura do detalhe: a ficha mascarada vem em `ficha`, sem e-mail nem telefone inteiros
    const det = await p.pedir('GET', `/v1/plataforma/empresas/${A}`, { token });
    expect(det.statusCode).toBe(200);
    expect(det.json<{ ficha: unknown }>().ficha).toEqual(res.ficha);
    semContatoInteiro(det.body);

    // auditoria: no tenant alvo, pelo superadmin, com o request_id, só os nomes dos campos e a fonte
    const aud = await auditorias('plataforma.empresa.atualizar_receita');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ tenant_id: A, superadmin_id: superadmin, entidade: 'empresa', entidade_id: l.id, request_id: req, antes: null });
    expect(aud[0]!.depois).toEqual({ campos: res.campos_alterados, fonte: 'brasilapi' });
    semContatoInteiro(JSON.stringify(aud[0]));
    expect(JSON.stringify(aud[0])).not.toContain('@');
  });

  it('idempotência: o mesmo request_id não regrava nem audita de novo; consulta nova pelo cache do tenant não chama a fonte, grava só a fonte e mantém e-mail e telefone', async () => {
    const [primeira] = await auditorias('plataforma.empresa.atualizar_receita');
    const antes = (await linhaEmpresa(A))!;
    const repetida = await atualizar(A, { requestId: primeira!.request_id });
    expect(repetida.statusCode).toBe(200);
    const res = ResultadoReceitaPlana.parse(repetida.json());
    expect(res).toMatchObject({ estado: 'ok', campos_alterados: primeira!.depois.campos });
    const depois = (await linhaEmpresa(A))!;
    expect(depois.updated_at).toEqual(antes.updated_at);
    expect(depois.receita_consultada_em).toEqual(antes.receita_consultada_em);
    expect(await auditorias('plataforma.empresa.atualizar_receita')).toHaveLength(1);

    // consulta nova dentro das 24 h: a porta real responde pelo cache do tenant, sem e-mail e telefone e sem chamar a fonte
    const nChamadas = fonte.chamadas.length;
    const nova = await atualizar(A);
    expect(fonte.chamadas).toHaveLength(nChamadas);
    expect(nova.statusCode).toBe(200);
    expect(ResultadoReceitaPlana.parse(nova.json())).toMatchObject({ estado: 'ok', campos_alterados: [], ficha: { email_mascarado: EMAIL_MASC, telefone_mascarado: TELEFONE_MASC, receita_fonte: 'cache' } });
    const l = (await linhaEmpresa(A))!;
    expect(l).toMatchObject({ email: EMAIL, telefone: TELEFONE, receita_fonte: 'cache' });
    // pelo cache, a data gravada é a da consulta que encheu o cache (a da fonte), não a do clique
    expect(l.receita_consultada_em).toEqual(antes.receita_consultada_em);
    const aud = await auditorias('plataforma.empresa.atualizar_receita');
    expect(aud).toHaveLength(2);
    expect(aud[1]!.depois).toEqual({ campos: [], fonte: 'cache' });
  });

  it('R-2: falha da fonte (fora, não encontrado) responde o motivo do catálogo, sem o CNPJ, e não muda a ficha nem a data', async () => {
    const antes = (await linhaEmpresa(A))!;
    const nAud = (await auditorias('plataforma.empresa.atualizar_receita')).length;
    // sem o cache do tenant, a porta vai à fonte (dublê)
    await b.admin.query('DELETE FROM cadastros.consulta_externa WHERE tenant_id = $1', [A]);
    const casos: [ModoFonte, string][] = [
      ['fora', 'fonte_indisponivel'],
      ['nao_encontrado', 'cnpj_nao_encontrado'],
    ];
    for (const [modo, motivo] of casos) {
      fonte.modo = modo;
      const r = await atualizar(A);
      expect(r.statusCode, modo).toBe(200);
      semCache(r);
      const res = ResultadoReceitaPlana.parse(r.json());
      expect(res, modo).toMatchObject({ estado: 'erro', motivo, mensagem: mensagemDaFalhaReceita(motivo as never), ficha: { email_mascarado: EMAIL_MASC } });
      expect(r.body, modo).not.toContain(CNPJ_A);
      semContatoInteiro(r.body);
    }
    const depois = (await linhaEmpresa(A))!;
    expect(depois).toEqual(antes);
    expect(await auditorias('plataforma.empresa.atualizar_receita')).toHaveLength(nAud);
  });

  it('R-4: Revelar devolve o valor inteiro (no-store) e audita só o campo, com superadmin e request_id; sem o dado, nada é auditado', async () => {
    const req = randomUUID();
    const email = await p.pedir('POST', URL_REVELAR(A, 'email'), { token, cabecalhos: { 'x-request-id': req } });
    const tel = await p.pedir('POST', URL_REVELAR(A, 'telefone'), { token });
    expect([email.statusCode, tel.statusCode]).toEqual([200, 200]);
    semCache(email);
    semCache(tel);
    expect(ContatoRevelado.parse(email.json())).toEqual({ valor: EMAIL });
    expect(ContatoRevelado.parse(tel.json())).toEqual({ valor: TELEFONE });
    const aud = await auditorias('plataforma.empresa.revelar_contato', A);
    expect(aud).toHaveLength(2);
    expect(aud[0]).toMatchObject({ tenant_id: A, superadmin_id: superadmin, entidade: 'empresa', request_id: req, antes: null, depois: { campo: 'email' } });
    expect(aud[1]!.depois).toEqual({ campo: 'telefone' });
    semContatoInteiro(JSON.stringify(aud));

    // B nunca foi atualizada: sem e-mail na ficha = valor nulo, sem auditoria; campo fora da lista = 400; inexistente = 404
    const vazio = await p.pedir('POST', URL_REVELAR(B, 'email'), { token });
    expect(vazio.statusCode).toBe(200);
    expect(ContatoRevelado.parse(vazio.json())).toEqual({ valor: null });
    const fora = await p.pedir('POST', URL_REVELAR(A, 'cpf'), { token });
    expect(fora.statusCode).toBe(400);
    expect((await p.pedir('POST', URL_REVELAR(randomUUID(), 'email'), { token })).statusCode).toBe(404);
    expect(await auditorias('plataforma.empresa.revelar_contato', A)).toHaveLength(2);
    expect(await auditorias('plataforma.empresa.revelar_contato', B)).toHaveLength(0);
  });

  it('RLS entre tenants: no papel do BKO, o tenant B não lê a ficha, o e-mail nem a auditoria do A; o detalhe do B no portal não traz nada do A', async () => {
    const deB = await comoPapel(b, 'macuxierp_app', { tenant: B }, (c) => c.query('SELECT tenant_id, email, telefone FROM core.empresa'));
    expect(deB.rows.map((r) => r.tenant_id)).toEqual([B]);
    expect(JSON.stringify(deB.rows)).not.toContain(EMAIL);
    const deA = await comoPapel(b, 'macuxierp_app', { tenant: A }, (c) => c.query('SELECT tenant_id, email FROM core.empresa'));
    expect(deA.rows).toEqual([{ tenant_id: A, email: EMAIL }]);
    const audB = await comoPapel(b, 'macuxierp_app', { tenant: B }, (c) =>
      c.query("SELECT 1 FROM plataforma.auditoria WHERE acao LIKE 'plataforma.empresa.%' AND tenant_id = $1", [A]),
    ).catch((e: { code?: string }) => ({ rows: [], code: e.code }));
    expect(audB.rows).toHaveLength(0);
    const det = await p.pedir('GET', `/v1/plataforma/empresas/${B}`, { token });
    expect(det.statusCode).toBe(200);
    expect(det.json<{ ficha: { email_mascarado: unknown; receita_fonte: unknown } }>().ficha).toMatchObject({ email_mascarado: null, receita_fonte: null });
    semContatoInteiro(det.body);
    expect(det.body).not.toContain(EMAIL_MASC);
  });

  it('R-5 (regra 8): o log da API durante atualizar, falhas e revelar não traz e-mail, telefone, CPF nem a máscara do contato', async () => {
    const tudo = logs.join('\n');
    expect(tudo).toContain('/receita');
    expect(tudo).toContain('/contato/');
    semContatoInteiro(tudo);
    for (const x of [EMAIL_MASC, TELEFONE_MASC, 'FICHA FICTICIA']) expect(tudo, x).not.toContain(x);
    // a sessão do portal não vai ao log
    expect(tudo).not.toContain(sha256(token));
  });
});
});
