/**
 * T-0101: "Atualizar pela Receita" pela MONTAGEM DE PRODUÇÃO do portal `/config` (#665). Os plugins vêm do
 * `pluginsPlataforma` real, e a porta `consultaReceita` é a consulta CNPJ dos cadastros (`criarConsultaCnpjParaCore`)
 * com as fontes HTTP de produção (`fontesHttp`). Só o `fetch` é dublado (a sessão não alcança a BrasilAPI). Prova que a
 * rota responde 200, que a consulta roda no papel e na RLS do tenant (o cache `cadastros.consulta_externa` fica no tenant
 * da empresa), que o CNPJ inválido da empresa volta como `cnpj_invalido` sem chamar a fonte e que o campo acima do limite
 * vindo da fonte real é 422 sem gravar.
 * Rotas, Revelar, auditoria e log ficam no empresa-ficha.db.test.ts. Dados fictícios. Sem Postgres pula; com
 * MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { RepositorioCoreSql } from '../../../modules/core/api/index';
import { fontesHttp } from '../../../modules/cadastros/api/index';
import { ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { criarApp } from '../../../apps/api/src/app';
import { dependenciasCadastros, montarDependenciasProducao, pluginsPlataforma } from '../../../apps/api/src/modulos';
import { atalhosPortal, inserirSuperadmin, type AppPortal } from '../../apoio/portal-pg';

const EMAIL = 'contato.producao.t0101@exemplo.invalid';

/** Resposta da BrasilAPI (formato do `GET /api/cnpj/v1/{cnpj}`) para o CNPJ pedido. */
const brasilApi = (cnpj: string, razao = 'PRODUCAO FICTICIA LTDA') => ({
  cnpj,
  razao_social: razao,
  nome_fantasia: 'PRODUCAO',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '2016-03-10',
  natureza_juridica: '2062 - Sociedade Empresária Limitada',
  porte: 'DEMAIS',
  cnae_fiscal: 4711302,
  cnaes_secundarios: [{ codigo: 4712100, descricao: 'Comércio varejista' }],
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'DAS PROVAS',
  numero: '7',
  complemento: null,
  bairro: 'CENTRO',
  cep: '69005000',
  municipio: 'MANAUS',
  codigo_municipio_ibge: 1302603,
  uf: 'AM',
  email: EMAIL,
  ddd_telefone_1: '9232220000',
  opcao_pelo_simples: false,
  opcao_pelo_mei: false,
});

describe.skipIf(!PG_DISPONIVEL)('"Atualizar pela Receita" na montagem de produção do /config (T-0101, #665)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  let token: string;
  /** Razão social que a fonte dublada devolve no próximo pedido; as URLs pedidas ficam registradas. */
  let razao = 'PRODUCAO FICTICIA LTDA';
  const urls: string[] = [];
  const admin = async (sql: string, v: unknown[] = []) => (await b.admin.query(sql, v)).rows as Record<string, unknown>[];

  const empresa = async (cnpj: string) => {
    const id = await criarTenant(b.admin, `ficha-prod-${randomUUID().slice(0, 8)}`, ['core', 'cadastros']);
    await admin('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [id, 'Empresa Antiga Ficticia', cnpj]);
    return id;
  };
  const atualizar = (id: string) => p.pedir('POST', `/v1/plataforma/empresas/${id}/receita`, { token });

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const producao = montarDependenciasProducao({
      banco: b.banco('macuxierp_app'),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
    });
    // O único dublê: o `fetch` das fontes HTTP de produção (BrasilAPI responde; a reserva não é chamada).
    const buscar = async (url: string) => {
      urls.push(url);
      const cnpj = url.split('/').at(-1)!;
      return { ok: true, status: 200, json: async () => brasilApi(cnpj, razao) };
    };
    const cadastros = dependenciasCadastros(new RepositorioCoreSql(), { fontes: fontesHttp(buscar as never) });
    const plugins = pluginsPlataforma(producao.modulos, { chaveIntegracao: null, cadastros });
    app = await criarApp({ ...producao, auth: { ...producao.auth, argon2: ARGON2_RAPIDO }, plataforma: { ...producao.plataforma!, plugins }, logger: false });
    p = atalhosPortal(app);
    await inserirSuperadmin(b, 'sa-t0101-producao@exemplo.invalid');
    token = await p.sessao('sa-t0101-producao@exemplo.invalid');
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('200: a consulta CNPJ dos cadastros grava a ficha; o cache fica só no tenant da empresa', async () => {
    const cnpj = '11222333000181';
    const id = await empresa(cnpj);
    const outro = await empresa('11444777000161');
    razao = 'PRODUCAO FICTICIA LTDA';
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'ok' });
    expect(urls.at(-1)).toBe(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    expect((await admin('SELECT receita_fonte FROM core.empresa WHERE tenant_id = $1', [id]))[0]).toEqual({ receita_fonte: 'brasilapi' });
    const cache = await admin('SELECT tenant_id FROM cadastros.consulta_externa WHERE tenant_id IN ($1, $2)', [id, outro]);
    expect(cache.length).toBeGreaterThan(0);
    expect(cache.every((l) => l.tenant_id === id)).toBe(true);
  });

  it('cnpj_invalido: empresa com CNPJ de dígito errado recebe estado erro com a mensagem, sem chamar a fonte, sem gravar e sem auditar', async () => {
    const id = await empresa('11222333000199');
    const chamadas = urls.length;
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'erro', motivo: 'cnpj_invalido', mensagem: expect.stringMatching(/CNPJ desta empresa é inválido/) });
    expect(urls.length).toBe(chamadas);
    expect((await admin('SELECT razao_social, receita_fonte FROM core.empresa WHERE tenant_id = $1', [id]))[0]).toMatchObject({ razao_social: 'Empresa Antiga Ficticia', receita_fonte: null });
    expect(await admin("SELECT 1 FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'plataforma.empresa.atualizar_receita'", [id])).toEqual([]);
  });

  it('422 RN-CORE-14: razão social de 151 letras vinda da fonte real não grava nada nem audita, e a resposta não leva o valor', async () => {
    const id = await empresa('11222333000181');
    razao = 'R'.repeat(151);
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'RN-CORE-14' });
    expect(r.body).not.toContain(razao);
    expect((await admin('SELECT razao_social, receita_fonte FROM core.empresa WHERE tenant_id = $1', [id]))[0]).toMatchObject({ razao_social: 'Empresa Antiga Ficticia', receita_fonte: null });
    expect(await admin("SELECT 1 FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'plataforma.empresa.atualizar_receita'", [id])).toEqual([]);
  });
});
