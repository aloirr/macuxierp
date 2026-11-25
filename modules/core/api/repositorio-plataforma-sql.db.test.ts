/**
 * Adaptador SQL do portal /config contra o PostgreSQL real com a 0033 (T-0050, ADR 0012): cada teste abre uma transação
 * como a apps/api faz no `comPlataforma` (SET LOCAL ROLE macuxierp_config + a sessão do superadmin) e chama o plugin.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { randomUUID } from 'node:crypto';
import { ErroApi, MENSAGEM_CODIGO_RESERVADO, type Transacao } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FichaReceita } from '../contracts';
import { MANIFESTOS_TESTE } from './manifestos-teste';
import { criarPluginPlataformaCore } from './plataforma';
import { RepositorioPlataformaSql } from './repositorio-plataforma-sql';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-0000000000c1';

describe.skipIf(!PG_DISPONIVEL)('RepositorioPlataformaSql com a 0033 (T-0050)', () => {
  let b: BancoEfemero;
  let sessao: string;
  const plugin = criarPluginPlataformaCore({
    repo: new RepositorioPlataformaSql(),
    manifestos: MANIFESTOS_TESTE,
    hashSenha: async () => HASH,
  });

  /** Uma transação de plataforma, desfeita no fim (o banco fica igual entre os testes, salvo `confirmar`). */
  async function comPlataforma<R>(fn: (tx: Transacao) => Promise<R>, confirmar = false): Promise<R> {
    const c = await b.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE macuxierp_config');
      await c.query("SELECT set_config('macuxierp.sessao_superadmin', $1, true)", [sessao]);
      const tx: Transacao = { consultar: async (sql, p = []) => (await c.query(sql, p as unknown[])).rows };
      const r = await fn(tx);
      await c.query(confirmar ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  const chamar = (metodo: string, caminho: string, e: { corpo?: unknown; params?: Record<string, string>; consulta?: unknown }, confirmar = false) =>
    comPlataforma(async (tx) => {
      const r = plugin.rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
      if (!r) throw new Error(`rota ${metodo} ${caminho}`);
      // hora-fixa-ok: o instante do contexto só alimenta a rota; o teste não o compara com instantes fixos
      const contexto = { sessao: { superadmin_id: SA, sessao_id: sessao }, tx, request_id: randomUUID(), agora: new Date(), auditar: async () => {} };
      return r.executar(contexto, {
        corpo: r.corpo ? r.corpo.parse(e.corpo) : undefined,
        consulta: r.consulta ? r.consulta.parse(e.consulta ?? {}) : undefined,
        params: e.params ?? {},
      } as never);
    }, confirmar);

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await b.admin.query(`DO $$ BEGIN
      IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN GRANT macuxierp_config TO CURRENT_USER; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    await b.admin.query(
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
       VALUES ($1, 'sa-core@exemplo.com.br', 'Superadmin de teste', $2, false, true)`,
      [SA, HASH],
    );
    sessao = randomUUID();
    await b.admin.query(
      // hora-fixa-ok: sessão de teste válida por 8h a partir do relógio do banco; nunca comparada ao instante fixo da validade
      `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ($1::uuid, $2::uuid, encode(sha256(convert_to($1::text, 'UTF8')), 'hex'), now() + interval '8 hours', now())`,
      [sessao, SA],
    );
  }, 120_000);
  afterAll(async () => b?.remover());

  it('cria a empresa com só o core e audita com o superadmin_id, sem o nome', async () => {
    const r = await chamar('POST', '/empresas', { corpo: { slug: 'portal-core-a', nome: 'Empresa Portal A' } }, true);
    expect(r).toMatchObject({ status: 201, corpo: { slug: 'portal-core-a', situacao: 'ativo', modulos: [{ modulo: 'core', ativo: true }], primeiro_admin: null } });
    const id = (r.corpo as { id: string }).id;
    const { rows } = await b.admin.query('SELECT superadmin_id, usuario_id, depois::text d FROM plataforma.auditoria WHERE tenant_id = $1', [id]);
    expect(rows).toEqual([expect.objectContaining({ superadmin_id: SA, usuario_id: null })]);
    expect(rows[0].d).not.toContain('Empresa Portal A');
  });

  it('slug repetido responde 409', async () => {
    const e = await chamar('POST', '/empresas', { corpo: { slug: 'portal-core-a', nome: 'Outra' } }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroApi);
    expect((e as ErroApi).status).toBe(409);
  });

  it('RN-CORE-11: o código reservado macuxi (0049) vira a mensagem fixa no campo codigo', async (ctx) => {
    const { rows } = await b.admin.query("SELECT 1 FROM pg_constraint WHERE conname = 'tenant_slug_macuxi_reservado'");
    if (rows.length === 0) return ctx.skip(); // a 0049 ainda não está no banco de teste (PR #485)
    // O contrato (Zod) já barra o slug na entrada; aqui vai direto ao repositório, a defesa em profundidade do banco (23514 + DETAIL).
    const repo = new RepositorioPlataformaSql();
    for (const slug of ['macuxi', 'MACUXI', ' Macuxi ']) {
      const e = await comPlataforma((tx) => repo.criarEmpresa(tx, { slug, uf: null, nome: 'Empresa Reservada', fuso: 'America/Manaus', request_id: randomUUID() })).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroApi);
      expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-11', message: MENSAGEM_CODIGO_RESERVADO, campos: { codigo: MENSAGEM_CODIGO_RESERVADO } });
    }
    const livre = await comPlataforma((tx) => repo.criarEmpresa(tx, { slug: 'macuxi2', uf: null, nome: 'Empresa Livre', fuso: 'America/Manaus', request_id: randomUUID() }));
    expect(livre).toMatchObject({ slug: 'macuxi2' });
  });

  it('RN-CORE-11: cria a empresa pelo código do FDV (0037)', async () => {
    const r = await chamar('POST', '/empresas', { corpo: { codigo: 'am2808', nome: 'Empresa AM' } }, true);
    expect(r).toMatchObject({ status: 201, corpo: { slug: 'am2808', codigo: 'AM2808' } });
    const e = await chamar('POST', '/empresas', { corpo: { codigo: 'am2808', nome: 'Empresa AM' } }).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 409 });
    expect((e as Error).message).toContain('Já existe empresa com este código');
    const z = await chamar('POST', '/empresas', { corpo: { codigo: 'rr0001', uf: 'AM', nome: 'X y' } }).catch((x: unknown) => x);
    expect(z).toBeInstanceOf(Error);
  });

  it('RN-CORE-02: liga os módulos com as dependências e recusa o faturamento sem o fiscal', async () => {
    const id = await criarTenant(b.admin, `portal-core-${randomUUID().slice(0, 8)}`, ['core', 'cadastros', 'pedido']);
    const e = await chamar('PUT', '/empresas/:id/modulos', { params: { id }, corpo: { modulos: [{ modulo: 'faturamento', ativo: true }] } }).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
    const r = await chamar('PUT', '/empresas/:id/modulos', {
      params: { id },
      corpo: { modulos: [{ modulo: 'fiscal', ativo: true }, { modulo: 'faturamento', ativo: true, valido_ate: '2027-12-31T03:59:59.000Z' }] },
    });
    const modulos = (r.corpo as { modulos: { modulo: string; ativo: boolean; valido_ate: string | null }[] }).modulos;
    expect(modulos).toContainEqual({ modulo: 'faturamento', ativo: true, valido_ate: '2027-12-31T03:59:59.000Z' });
    expect(modulos).toContainEqual({ modulo: 'fiscal', ativo: true, valido_ate: null });
  });

  it('1º admin: senha só na resposta, hash no banco, reenvio 409 e redefinição', async () => {
    const id = await criarTenant(b.admin, `portal-core-${randomUUID().slice(0, 8)}`, ['core']);
    const r = await chamar('POST', '/empresas/:id/primeiro-admin', { params: { id }, corpo: { email: 'admin@exemplo.com.br' } }, true);
    expect(r.status).toBe(201);
    const { usuario_id, senha_provisoria } = r.corpo as { usuario_id: string; senha_provisoria: string };
    const { rows } = await b.admin.query('SELECT perfil, senha_hash FROM plataforma.usuario WHERE id = $1', [usuario_id]);
    expect(rows).toEqual([{ perfil: 'administrador', senha_hash: HASH }]);
    expect(JSON.stringify(rows)).not.toContain(senha_provisoria);
    const e = await chamar('POST', '/empresas/:id/primeiro-admin', { params: { id }, corpo: { email: 'outro@exemplo.com.br' } }).catch((x: unknown) => x);
    expect((e as ErroApi).status).toBe(409);
    const s = await chamar('POST', '/empresas/:id/primeiro-admin/senha', { params: { id } });
    expect(s.corpo).toMatchObject({ usuario_id });
    const m = await chamar('GET', '/empresas/:id', { params: { id } });
    expect((m.corpo as { primeiro_admin: { email_mascarado: string } }).primeiro_admin.email_mascarado).toBe('ad****@exemplo.com.br');
    const rev = await chamar('POST', '/empresas/:id/primeiro-admin/email', { params: { id } }, true);
    expect(rev.corpo).toEqual({ email: 'admin@exemplo.com.br' });
    const n = await b.admin.query(`SELECT count(*)::int n FROM plataforma.auditoria WHERE acao = 'plataforma.admin.revelar_email' AND tenant_id = $1`, [id]);
    expect(n.rows[0].n).toBe(1);
    const t = await b.admin.query(`SELECT coalesce(string_agg(coalesce(antes::text,'') || coalesce(depois::text,''), ''), '') t FROM plataforma.auditoria WHERE tenant_id = $1`, [id]);
    expect(t.rows[0].t).not.toContain('admin@exemplo.com.br');
  });

  describe('ficha da Receita (migração 0065)', () => {
    const CNPJ_FICHA = '11222333000181';
    const FICHA: FichaReceita = {
      razao_social: 'EMPRESA FICTICIA LTDA', nome_fantasia: 'FICTICIA', logradouro: 'RUA A', numero: '10', complemento: null, bairro: 'CENTRO',
      cep: '69000000', municipio_ibge: '1302603', uf: 'AM', email: 'contato.ficticio@empresa.teste', telefone: '9232221234',
      cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'ATIVA', situacao_cadastral_data: '2020-01-02',
      data_abertura: '2015-03-10', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'DEMAIS', cnae_secundarios: ['4712100'],
      fonte: 'brasilapi', consultado_em: '2026-11-24T12:00:00.000Z',
    };
    const repo = new RepositorioPlataformaSql();
    const consulta = { consultar: async () => ({ ok: true as const, fonte: 'brasilapi', consultado_em: '2026-11-24T12:00:00.000Z', sugestao: { cnpj: CNPJ_FICHA, razao_social: 'EMPRESA FICTICIA LTDA', nome_fantasia: 'FICTICIA', situacao_cadastral: 'ATIVA', cnae_fiscal: '4711302', endereco: { uf: 'AM' }, email: 'contato.ficticio@empresa.teste', telefone: '9232221234', opcao_simples: true, opcao_mei: false } }) };
    const pluginFicha = criarPluginPlataformaCore({ repo, manifestos: MANIFESTOS_TESTE, hashSenha: async () => HASH, consultaReceita: consulta });

    /** Sem a 0065 no banco de teste (PR #636 ainda fora do main) estes testes pulam. */
    async function temFuncao0065(): Promise<boolean> {
      const { rows } = await b.admin.query("SELECT 1 FROM pg_proc WHERE proname = 'empresa_gravar_receita'");
      return rows.length > 0;
    }
    async function tenantComEmpresa(): Promise<string> {
      const id = await criarTenant(b.admin, `ficha-core-${randomUUID().slice(0, 8)}`, ['core']);
      await b.admin.query(`INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Antiga', $2)`, [id, CNPJ_FICHA]);
      return id;
    }
    const rota = (id: string, caminho: string, params: Record<string, string>, confirmar = false) =>
      comPlataforma(async (tx) => {
        const r = pluginFicha.rotas.find((x) => x.metodo === 'POST' && x.caminho === caminho);
        if (!r) throw new Error(`rota ${caminho}`);
        // hora-fixa-ok: o instante do contexto só alimenta a rota
        const c = { sessao: { superadmin_id: SA, sessao_id: sessao }, tx, request_id: randomUUID(), agora: new Date(), auditar: async () => {} };
        return r.executar(c, { params: { id, ...params } } as never);
      }, confirmar);

    it('RF-CAD-02: atualiza pela Receita, devolve a ficha mascarada e audita só os nomes dos campos', async (ctx) => {
      if (!(await temFuncao0065())) return ctx.skip();
      const id = await tenantComEmpresa();
      const r = await rota(id, '/empresas/:id/receita', {}, true);
      expect(r.corpo).toMatchObject({ estado: 'ok', ficha: { email_mascarado: 'co****@empresa.teste', telefone_mascarado: '(92) ****-1234', regime_receita: 'simples' } });
      expect(JSON.stringify(r.corpo)).not.toContain('contato.ficticio');
      const t = await b.admin.query(`SELECT coalesce(string_agg(coalesce(antes::text,'') || coalesce(depois::text,''), ''), '') t FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'plataforma.empresa.atualizar_receita'`, [id]);
      expect(t.rows[0].t).not.toContain('contato.ficticio');
      expect(t.rows[0].t).not.toContain('EMPRESA FICTICIA');
    });

    it('RF-CAD-02: Revelar devolve o contato completo, audita só o campo; sem core.empresa é 409', async (ctx) => {
      if (!(await temFuncao0065())) return ctx.skip();
      const id = await tenantComEmpresa();
      await comPlataforma((tx) => repo.gravarReceita(tx, { id, ficha: FICHA, request_id: randomUUID() }), true);
      const rev = await rota(id, '/empresas/:id/contato/:campo', { campo: 'email' }, true);
      expect(rev.corpo).toEqual({ valor: 'contato.ficticio@empresa.teste' });
      const a = await b.admin.query(`SELECT depois::text d FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'plataforma.empresa.revelar_contato'`, [id]);
      expect(a.rows).toHaveLength(1);
      expect(a.rows[0].d).not.toContain('contato.ficticio');
      const sem = await criarTenant(b.admin, `ficha-core-${randomUUID().slice(0, 8)}`, ['core']);
      const e = await rota(sem, '/empresas/:id/receita', {}).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 409 });
    });
  });

  it('suspender revoga as sessões do tenant e lista/lê a empresa', async () => {
    const id = await criarTenant(b.admin, `portal-core-${randomUUID().slice(0, 8)}`, ['core']);
    const r = await chamar('PUT', '/empresas/:id/situacao', { params: { id }, corpo: { situacao: 'suspenso', motivo: 'teste de suspensão' } }, true);
    expect(r.corpo).toMatchObject({ id, situacao: 'suspenso' });
    expect(await chamar('GET', '/empresas/:id', { params: { id } })).toMatchObject({ corpo: { id, situacao: 'suspenso' } });
    const lista = await chamar('GET', '/empresas', { consulta: { busca: 'portal-core' } });
    expect((lista.corpo as { itens: { id: string }[] }).itens.map((x) => x.id)).toContain(id);
    const nf = await chamar('GET', '/empresas/:id', { params: { id: randomUUID() } }).catch((x: unknown) => x);
    expect((nf as ErroApi).status).toBe(404);
  });
});
