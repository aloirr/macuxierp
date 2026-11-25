/**
 * T-0101, etapa 2 (R-1 a R-5 do plano da v0.3.13 na rota): "Atualizar pela Receita" e "Revelar" da ficha da empresa pelo
 * portal `/config`, na API REAL (`criarApp` + `montarDependenciasProducao`: cookie, CSRF, papel `macuxierp_config`, RLS e as
 * funções da 0063/0065). Só o plugin de plataforma do core é trocado, para receber a porta `consultaReceita` dublada (a
 * montagem de produção ainda não a liga: R-20261125-050423-testes); a porta lê uma tabela do cadastros na transação que
 * recebe, como a consulta CNPJ real faz com o cache do tenant (por etapa, #666). Dados fictícios (CNPJ de exemplo,
 * exemplo.invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transacao } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { ResultadoReceitaPlana } from '../../../modules/core/contracts/index';
import { criarPluginPlataformaCore, RepositorioPlataformaSql } from '../../../modules/core/api/index';
import type { ResultadoConsultaReceita, SugestaoReceita } from '../../../modules/core/domain/index';
import { appPgDeTeste, ARGON2_RAPIDO, JWT_SEGREDO_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { criarApp } from '../../../apps/api/src/app';
import { gerarHashSenha } from '../../../apps/api/src/auth/senha';
import { montarDependenciasProducao } from '../../../apps/api/src/modulos';
import { atalhosPortal, inserirSuperadmin, type AppPortal } from '../../apoio/portal-pg';

const CNPJ = '11222333000181';
const EMAIL = 'contato.ficha.t0101@exemplo.invalid';
const TELEFONE = '9232224567';
const AGORA = '2026-11-25T09:00:00.000Z';
const sugestao = (o: Partial<SugestaoReceita> = {}): SugestaoReceita => ({
  cnpj: CNPJ,
  razao_social: 'FICHA FICTICIA LTDA',
  nome_fantasia: 'FICHA',
  situacao_cadastral: 'ATIVA',
  cnae_fiscal: '4639701',
  endereco: { logradouro: 'AVENIDA DAS FICCOES', numero: '100', complemento: null, bairro: 'DISTRITO', cep: '69075000', municipio: 'MANAUS', municipio_ibge: '1302603', uf: 'AM' } as SugestaoReceita['endereco'],
  cnae_secundarios: ['4637199'],
  porte: 'EMPRESA DE PEQUENO PORTE',
  natureza_juridica: 'Sociedade Empresária Limitada',
  email: EMAIL,
  telefone: TELEFONE,
  opcao_simples: true,
  opcao_mei: false,
  data_abertura: '2014-07-21',
  ...o,
});

describe.skipIf(!PG_DISPONIVEL)('ficha da Receita pelo portal /config na API real (T-0101)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  let token: string;
  /** Resposta da porta dublada no próximo pedido; `null` = porta ausente (o plugin sem `consultaReceita`). */
  let proxima: ResultadoConsultaReceita = { ok: true, sugestao: sugestao(), fonte: 'brasilapi', consultado_em: AGORA };
  const tenantsVistos: string[] = [];
  const admin = async (sql: string, v: unknown[] = []) => (await b.admin.query(sql, v)).rows as Record<string, unknown>[];

  const empresa = async (cnpj = CNPJ) => {
    const id = await criarTenant(b.admin, `ficha-${randomUUID().slice(0, 8)}`, ['core', 'cadastros']);
    await admin('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [id, 'Empresa Antiga Ficticia', cnpj]);
    return id;
  };
  const atualizar = (id: string) => p.pedir('POST', `/v1/plataforma/empresas/${id}/receita`, { token });
  const revelar = (id: string, campo: string) => p.pedir('POST', `/v1/plataforma/empresas/${id}/contato/${campo}`, { token });
  const auditoria = async (id: string, acao: string) =>
    admin(`SELECT coalesce(antes::text, '') || coalesce(depois::text, '') AS t FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = $2`, [id, acao]);
  const fichaNoBanco = async (id: string) =>
    (await admin('SELECT razao_social, email, telefone, data_abertura::text AS data_abertura, porte, receita_fonte FROM core.empresa WHERE tenant_id = $1', [id]))[0]!;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const producao = montarDependenciasProducao({
      banco: b.banco('macuxierp_app'),
      chaveA1: Buffer.alloc(32, 1),
      config: { versao: 'teste', jwtSegredo: JWT_SEGREDO_DE_TESTE, cookieSeguro: true, segredoBff: null },
    });
    const plataforma = producao.plataforma!;
    const manifestos = producao.modulos.map((m) => ({ id: m.manifesto.id, depende: m.manifesto.depende }));
    const consultaReceita = {
      async consultar(tx: Transacao, tenant: string): Promise<ResultadoConsultaReceita> {
        // Como a consulta CNPJ real (cache do tenant): lê uma tabela do cadastros na transação que recebe.
        await tx.consultar('SELECT count(*) FROM cadastros.filial');
        tenantsVistos.push(tenant);
        return proxima;
      },
    };
    const core = criarPluginPlataformaCore({ repo: new RepositorioPlataformaSql(), manifestos, hashSenha: (s) => gerarHashSenha(s), consultaReceita });
    const plugins = plataforma.plugins.map((pl) => (pl.rotas.some((r) => r.caminho === '/empresas/:id/receita') ? core : pl));
    app = await criarApp({ ...producao, auth: { ...producao.auth, argon2: ARGON2_RAPIDO }, plataforma: { ...plataforma, plugins }, logger: false });
    p = atalhosPortal(app);
    await inserirSuperadmin(b, 'sa-t0101-ficha@exemplo.invalid');
    token = await p.sessao('sa-t0101-ficha@exemplo.invalid');
  }, 120_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('R-1: atualiza a ficha completa no banco, devolve só a ficha mascarada e os nomes dos campos, e audita sem valores; a consulta roda no tenant', async () => {
    const id = await empresa();
    proxima = { ok: true, sugestao: sugestao(), fonte: 'brasilapi', consultado_em: AGORA };
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(String(r.headers['cache-control'])).toContain('no-store');
    const corpo = ResultadoReceitaPlana.parse(r.json());
    expect(corpo.estado).toBe('ok');
    if (corpo.estado !== 'ok') return;
    expect(corpo.campos_alterados).toEqual(expect.arrayContaining(['data_abertura', 'porte', 'natureza_juridica']));
    for (const c of corpo.campos_alterados) expect(c).toMatch(/^[a-z_]+$/);
    expect(corpo.ficha).toMatchObject({ email_mascarado: expect.stringContaining('****'), telefone_mascarado: expect.stringContaining('****'), porte: 'EMPRESA DE PEQUENO PORTE' });
    expect(r.body).not.toContain(EMAIL);
    expect(r.body).not.toContain(TELEFONE);
    expect(await fichaNoBanco(id)).toMatchObject({ razao_social: 'FICHA FICTICIA LTDA', email: EMAIL, telefone: TELEFONE, data_abertura: '2014-07-21', receita_fonte: 'brasilapi' });
    const aud = await auditoria(id, 'plataforma.empresa.atualizar_receita');
    expect(aud).toHaveLength(1);
    for (const v of [EMAIL, TELEFONE, 'FICHA FICTICIA']) expect(aud[0]!.t).not.toContain(v);
    expect(tenantsVistos.at(-1)).toBe(id);
  });

  it('R-2: CNPJ inválido na fonte devolve estado erro "cnpj_invalido" com a mensagem, e nada muda no banco nem na auditoria', async () => {
    const id = await empresa();
    proxima = { ok: false, motivo: 'cnpj_invalido' };
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'erro', motivo: 'cnpj_invalido', mensagem: expect.stringMatching(/CNPJ desta empresa é inválido/) });
    expect(await fichaNoBanco(id)).toMatchObject({ razao_social: 'Empresa Antiga Ficticia', email: null, receita_fonte: null });
    expect(await auditoria(id, 'plataforma.empresa.atualizar_receita')).toHaveLength(0);
  });

  it('R-2: campo acima do limite (razão social com 151 letras) é 422 RN-CORE-14 sem o valor na resposta; nada gravado (nunca cortado nem NULL em silêncio)', async () => {
    const id = await empresa();
    const longa = 'R'.repeat(151);
    proxima = { ok: true, sugestao: sugestao({ razao_social: longa }), fonte: 'brasilapi', consultado_em: AGORA };
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'RN-CORE-14' });
    expect(r.body).not.toContain(longa);
    expect(await fichaNoBanco(id)).toMatchObject({ razao_social: 'Empresa Antiga Ficticia', email: null, data_abertura: null, receita_fonte: null });
    expect(await auditoria(id, 'plataforma.empresa.atualizar_receita')).toHaveLength(0);
  });

  it('R-2: Receita fora do ar devolve estado erro "fonte_indisponivel" e a ficha anterior fica; a ficha gravada antes não é apagada', async () => {
    const id = await empresa();
    proxima = { ok: true, sugestao: sugestao(), fonte: 'brasilapi', consultado_em: AGORA };
    expect((await atualizar(id)).statusCode).toBe(200);
    proxima = { ok: false, motivo: 'fonte_indisponivel' };
    const r = await atualizar(id);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'erro', motivo: 'fonte_indisponivel', ficha: { porte: 'EMPRESA DE PEQUENO PORTE' } });
    expect(await fichaNoBanco(id)).toMatchObject({ email: EMAIL, data_abertura: '2014-07-21' });
    expect(await auditoria(id, 'plataforma.empresa.atualizar_receita')).toHaveLength(1);
  });

  it('R-4: Revelar devolve o contato completo com no-store e audita só o nome do campo; campo fora da lista é 400; sem o dado, vazio e sem auditoria', async () => {
    const id = await empresa();
    proxima = { ok: true, sugestao: sugestao(), fonte: 'brasilapi', consultado_em: AGORA };
    expect((await atualizar(id)).statusCode).toBe(200);
    const e = await revelar(id, 'email');
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json()).toEqual({ valor: EMAIL });
    expect(String(e.headers['cache-control'])).toContain('no-store');
    expect((await revelar(id, 'telefone')).json()).toEqual({ valor: TELEFONE });
    const aud = await auditoria(id, 'plataforma.empresa.revelar_contato');
    expect(aud).toHaveLength(2);
    for (const a of aud) {
      expect(a.t).not.toContain(EMAIL);
      expect(a.t).not.toContain(TELEFONE);
    }
    expect((await revelar(id, 'cpf')).statusCode).toBe(400);
    const sem = await empresa();
    proxima = { ok: true, sugestao: sugestao({ email: null, telefone: null }), fonte: 'brasilapi', consultado_em: AGORA };
    expect((await atualizar(sem)).statusCode).toBe(200);
    expect((await revelar(sem, 'email')).json()).toEqual({ valor: null });
    expect(await auditoria(sem, 'plataforma.empresa.revelar_contato')).toHaveLength(0);
  });

  it('R-5: sem sessão do portal é 401 e nada é consultado; empresa inexistente é 404', async () => {
    const id = await empresa();
    const antes = tenantsVistos.length;
    expect((await p.pedir('POST', `/v1/plataforma/empresas/${id}/receita`)).statusCode).toBe(401);
    expect((await p.pedir('POST', `/v1/plataforma/empresas/${id}/contato/email`)).statusCode).toBe(401);
    expect((await atualizar(randomUUID())).statusCode).toBe(404);
    expect(tenantsVistos.length).toBe(antes);
  });

  it('R-2: sem a porta de consulta ligada, "Atualizar pela Receita" é 503 e a ficha não muda', async () => {
    const id = await empresa();
    // A montagem de produção, sem troca de plugin: hoje ela não liga a porta (R-20261125-050423-testes).
    const { app: semPorta } = await appPgDeTeste({ b, modulos: 'producao' });
    try {
      const q = atalhosPortal(semPorta);
      const r = await q.pedir('POST', `/v1/plataforma/empresas/${id}/receita`, { token });
      expect(r.statusCode, r.body).toBe(503);
      expect(await fichaNoBanco(id)).toMatchObject({ razao_social: 'Empresa Antiga Ficticia', receita_fonte: null });
    } finally {
      await semPorta.close();
    }
  });
});
