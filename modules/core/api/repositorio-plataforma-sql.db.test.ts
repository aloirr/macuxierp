/**
 * Adaptador SQL do portal /config contra o PostgreSQL real com a 0033 (T-0050, ADR 0012): cada teste abre uma transação
 * como a apps/api faz no `comPlataforma` (SET LOCAL ROLE macuxierp_config + a sessão do superadmin) e chama o plugin.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { randomUUID } from 'node:crypto';
import { cnpjValido, ErroApi, MENSAGEM_CODIGO_RESERVADO, type Transacao } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CnpjAlterado,
  EVENTO_CNPJ_ALTERADO,
  ListaUsuariosConfig,
  MENSAGEM_ULTIMO_ADMIN,
  MENSAGENS_BLOQUEIO_CNPJ,
  ROTAS_FICHA,
  UsuarioConfig,
  UsuarioConfigComSenha,
  type EdicaoFicha,
  type FichaReceitaPlana,
} from '../contracts';
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

  describe('ficha da Receita (migração 0063)', () => {
    const CNPJ_FICHA = '11222333000181';
    const FICHA: FichaReceitaPlana = {
      razao_social: 'EMPRESA FICTICIA LTDA', nome_fantasia: 'FICTICIA', logradouro: 'RUA A', numero: '10', complemento: null, bairro: 'CENTRO',
      cep: '69000000', municipio_ibge: '1302603', uf: 'AM', email: 'contato.ficticio@empresa.teste', telefone: '9232221234',
      cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'ATIVA', situacao_cadastral_data: '2020-01-02',
      data_abertura: '2015-03-10', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'DEMAIS', cnae_secundarios: ['4712100'],
      fonte: 'brasilapi', consultado_em: '2026-11-24T12:00:00.000Z',
    };
    const repo = new RepositorioPlataformaSql();
    /**
     * Porta que, como a do cadastros (RF-CAD-02), lê e grava o cache `cadastros.consulta_externa` do tenant: exige o papel
     * `macuxierp_app` e a RLS do tenant (o `macuxierp_config` não tem privilégio nessa tabela).
     */
    const consulta = {
      consultar: async (tx: Transacao) => {
        await tx.consultar(
          // hora-fixa-ok: o instante do cache só precisa existir; nunca é comparado
          `INSERT INTO cadastros.consulta_externa (tenant_id, tipo, chave, resposta, fonte, consultado_em, expira_em, external_id)
           VALUES (plataforma.tenant_atual(), 'cnpj', $1, '{}'::jsonb, 'brasilapi', now(), now() + interval '24 hours', $2)
           ON CONFLICT (tenant_id, tipo, chave) DO UPDATE SET consultado_em = EXCLUDED.consultado_em, deleted_at = NULL`,
          [CNPJ_FICHA, randomUUID()],
        );
        return { ok: true as const, fonte: 'brasilapi', consultado_em: '2026-11-24T12:00:00.000Z', sugestao: { cnpj: CNPJ_FICHA, razao_social: 'EMPRESA FICTICIA LTDA', nome_fantasia: 'FICTICIA', situacao_cadastral: 'ATIVA', cnae_fiscal: '4711302', endereco: { uf: 'AM' }, email: 'contato.ficticio@empresa.teste', telefone: '9232221234', opcao_simples: true, opcao_mei: false } };
      },
    };
    /** Porta do faturamento sem NF-e de produção (o MXC05 com a nota real fica no db.test da 0077). */
    const pluginFicha = criarPluginPlataformaCore({
      repo, manifestos: MANIFESTOS_TESTE, hashSenha: async () => HASH, consultaReceita: consulta,
      consultaNfeProducao: { temNfeAutorizadaEmProducao: async () => false },
    });

    async function tenantComEmpresa(cnpj = CNPJ_FICHA): Promise<string> {
      const id = await criarTenant(b.admin, `ficha-core-${randomUUID().slice(0, 8)}`, ['core']);
      await b.admin.query(`INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Antiga', $2)`, [id, cnpj]);
      return id;
    }
    /** Rota comum: uma transação de plataforma. Rota por etapa: uma transação de cada vez, a do tenant no papel app com a RLS. */
    const rota = (id: string, caminho: string, params: Record<string, string>, confirmar = false, extra: { metodo?: string; corpo?: unknown; request_id?: string } = {}) => {
      const r = pluginFicha.rotas.find((x) => x.metodo === (extra.metodo ?? 'POST') && x.caminho === caminho);
      if (!r) throw new Error(`rota ${caminho}`);
      // hora-fixa-ok: o instante do contexto só alimenta a rota
      const base = { sessao: { superadmin_id: SA, sessao_id: sessao }, request_id: extra.request_id ?? randomUUID(), agora: new Date() };
      const entrada = { params: { id, ...params }, corpo: r.corpo ? r.corpo.parse(extra.corpo) : undefined } as never;
      if (r.transacoes === 'por_etapa') {
        const app = (bancoApp ??= b.banco('macuxierp_app'));
        return r.executar({ ...base, comPlataforma: (fn: (tx: Transacao) => Promise<unknown>) => comPlataforma(fn, true), comTenant: (t: string, fn: (tx: Transacao) => Promise<unknown>) => app.comTenant(t, fn) } as never, entrada);
      }
      return comPlataforma((tx) => r.executar({ ...base, tx, auditar: async () => {} }, entrada), confirmar);
    };
    let bancoApp: ReturnType<BancoEfemero['banco']> | undefined;

    it('RF-CAD-02: o papel de plataforma não lê o cache de consultas do cadastros (por isso a consulta roda no tenant)', async () => {
      const e = await comPlataforma((tx) => tx.consultar('SELECT 1 FROM cadastros.consulta_externa')).catch((x: unknown) => x);
      expect(e).toMatchObject({ code: '42501' });
    });

    it('RF-CAD-02: atualiza pela Receita, devolve a ficha mascarada e audita só os nomes dos campos', async () => {
      const id = await tenantComEmpresa();
      const r = await rota(id, '/empresas/:id/receita', {}, true);
      expect(r.corpo).toMatchObject({ estado: 'ok', ficha: { email_mascarado: 'co****@empresa.teste', telefone_mascarado: '(92) ****-1234', regime_receita: 'simples' } });
      expect(JSON.stringify(r.corpo)).not.toContain('contato.ficticio');
      // A consulta rodou no papel app e na RLS do tenant: o cache do tenant foi gravado (no papel config daria 42501).
      const cache = await b.admin.query('SELECT count(*)::int n FROM cadastros.consulta_externa WHERE tenant_id = $1', [id]);
      expect(cache.rows[0].n).toBe(1);
      const t = await b.admin.query(`SELECT coalesce(string_agg(coalesce(antes::text,'') || coalesce(depois::text,''), ''), '') t FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'plataforma.empresa.atualizar_receita'`, [id]);
      expect(t.rows[0].t).not.toContain('contato.ficticio');
      expect(t.rows[0].t).not.toContain('EMPRESA FICTICIA');
    });

    it('RF-CAD-02: Revelar devolve o contato completo, audita só o campo; sem core.empresa é 409', async () => {
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

    describe('RN-CORE-16: Ficha editável e troca de CNPJ (0077)', () => {
      const semPrefixo = (r: { caminho: string }) => r.caminho.replace('/v1/plataforma', '');
      /** CNPJ fictício válido e único (8 dígitos sorteados + 0001 + o DV que o SDK aceita), para os casos não colidirem. */
      const cnpjFicticio = (): string => {
        const base = `${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('')}0001`;
        for (let d = 0; d < 100; d++) {
          const c = base + String(d).padStart(2, '0');
          if (cnpjValido(c)) return c;
        }
        throw new Error('sem DV');
      };
      const eventosDe = async (id: string) =>
        (await b.admin.query('SELECT id, payload FROM plataforma.evento WHERE tenant_id = $1 AND nome = $2', [id, EVENTO_CNPJ_ALTERADO])).rows as { id: string; payload: { payload: unknown } }[];
      const auditoriaDe = async (id: string, acao: string): Promise<string> =>
        (await b.admin.query(`SELECT coalesce(string_agg(coalesce(antes::text, '') || coalesce(depois::text, ''), ''), '') t FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = $2`, [id, acao])).rows[0].t;
      const cnpjDe = async (id: string): Promise<string> => (await b.admin.query('SELECT cnpj FROM core.empresa WHERE tenant_id = $1', [id])).rows[0].cnpj;
      const trocar = (id: string, cnpj_novo: string, request_id?: string) =>
        rota(id, semPrefixo(ROTAS_FICHA.trocarCnpj), {}, true, { corpo: { cnpj_novo, confirmacao: true }, request_id }) as Promise<{ corpo: unknown }>;

      it('Salvar grava a ficha com a fonte manual e audita só nomes de campo; repetir o mesmo conteúdo é sem_mudanca', async () => {
        const id = await tenantComEmpresa(cnpjFicticio());
        const edicao: EdicaoFicha = { ...FICHA, origem: 'manual', razao_social: 'EMPRESA FICTICIA FICHA LTDA', ie: 'ISENTO' };
        const salvar = () => rota(id, semPrefixo(ROTAS_FICHA.salvar), {}, true, { metodo: 'PUT', corpo: edicao }) as Promise<{ corpo: { estado: string; campos_alterados?: string[]; ficha: Record<string, unknown> } }>;
        const r = await salvar();
        expect(r.corpo.estado).toBe('ok');
        expect(r.corpo.campos_alterados).toEqual(expect.arrayContaining(['razao_social', 'ie', 'email']));
        expect(r.corpo.ficha).toMatchObject({ ie: 'ISENTO', receita_fonte: 'manual', municipio_nome: 'Manaus' });
        expect(JSON.stringify(r.corpo)).not.toContain('contato.ficticio');
        const a = await auditoriaDe(id, 'plataforma.empresa.salvar_ficha');
        expect(a).toContain('razao_social');
        expect(a).not.toContain('contato.ficticio');
        expect(a).not.toContain('EMPRESA FICTICIA FICHA');
        expect((await salvar()).corpo.estado).toBe('sem_mudanca');
        const renomear = rota(id, semPrefixo(ROTAS_FICHA.salvar), {}, true, { metodo: 'PUT', corpo: { ...edicao, razao_social: 'EMPRESA RENOMEADA LTDA' } }) as Promise<{ corpo: { estado: string; campos_alterados?: string[] } }>;
        expect((await renomear).corpo).toMatchObject({ estado: 'ok', campos_alterados: ['razao_social'] });
        expect((await b.admin.query('SELECT razao_social FROM core.empresa WHERE tenant_id = $1', [id])).rows[0].razao_social).toBe('EMPRESA RENOMEADA LTDA');
      });

      it('a troca grava o CNPJ, publica um core.empresa.cnpj_alterado@1 válido e audita sem nenhum CNPJ', async () => {
        const atual = cnpjFicticio();
        const novo = cnpjFicticio();
        const id = await tenantComEmpresa(atual);
        const req = randomUUID();
        expect((await trocar(id, novo, req)).corpo).toEqual({ estado: 'ok', cnpj: novo });
        expect(await cnpjDe(id)).toBe(novo);
        const ev = await eventosDe(id);
        expect(ev).toHaveLength(1);
        expect(CnpjAlterado.parse(ev[0]!.payload.payload)).toMatchObject({ tenant_id: id, cnpj_novo: novo, request_id: req });
        expect(JSON.stringify(ev)).not.toContain(atual);
        const a = await auditoriaDe(id, 'plataforma.empresa.trocar_cnpj');
        expect(a).toContain(ev[0]!.id);
        expect(a).not.toContain(novo);
        expect(a).not.toContain(atual);
      });

      it('CNPJ em uso por outra empresa: o domínio bloqueia antes da função (o próprio CNPJ não conta) e não há evento', async () => {
        const doOutro = cnpjFicticio();
        const atual = cnpjFicticio();
        await tenantComEmpresa(doOutro);
        const id = await tenantComEmpresa(atual);
        expect(await comPlataforma((tx) => repo.cnpjEmUso(tx, { id, cnpj: doOutro }))).toBe(true);
        expect(await comPlataforma((tx) => repo.cnpjEmUso(tx, { id, cnpj: atual }))).toBe(false);
        expect((await trocar(id, doOutro)).corpo).toEqual({ estado: 'bloqueado', motivo: 'cnpj_em_uso', mensagem: MENSAGENS_BLOQUEIO_CNPJ.cnpj_em_uso });
        expect(await cnpjDe(id)).toBe(atual);
        expect(await eventosDe(id)).toEqual([]);
      });

      it('a função do banco também recusa o CNPJ em uso (23505 cnpj_em_uso); empresa excluída não conta', async () => {
        const doOutro = cnpjFicticio();
        const outra = await tenantComEmpresa(doOutro);
        const id = await tenantComEmpresa(cnpjFicticio());
        // Direto no repositório (sem a revalidação do domínio): a defesa em profundidade do banco.
        expect(await comPlataforma((tx) => repo.trocarCnpj(tx, { id, cnpj: doOutro, request_id: randomUUID() }), true)).toEqual({ bloqueado: 'cnpj_em_uso' });
        expect(await eventosDe(id)).toEqual([]);
        // hora-fixa-ok: o deleted_at só precisa estar preenchido; nunca é comparado
        await b.admin.query('UPDATE core.empresa SET deleted_at = now() WHERE tenant_id = $1', [outra]);
        expect(await comPlataforma((tx) => repo.cnpjEmUso(tx, { id, cnpj: doOutro }))).toBe(false);
        expect(await comPlataforma((tx) => repo.trocarCnpj(tx, { id, cnpj: doOutro, request_id: randomUUID() }), true)).toMatchObject({ cnpj: doOutro });
      });
    });

    it('T-0106 (0066): a leitura da empresa e a gravação devolvem a descrição do CNAE e o nome do município; o papel config executa as funções', async () => {
      const id = await tenantComEmpresa();
      const g = await comPlataforma((tx) => repo.gravarReceita(tx, { id, ficha: FICHA, request_id: randomUUID() }), true);
      expect(g.ficha).toMatchObject({ municipio_nome: 'Manaus', cnae_principal: '4711302', cnae_secundarios: ['4712100'] });
      expect(g.ficha?.cnae_principal_descricao).toEqual(expect.stringMatching(/\S/));
      const l = await comPlataforma(async (tx) => {
        const lida = await repo.lerEmpresaComFicha(tx, id);
        return { crua: lida?.ficha, descrita: lida?.ficha ? await repo.descreverFicha(tx, lida.ficha) : null };
      });
      expect(l.crua?.municipio_nome).toBeUndefined(); // RD-2153: ler para decidir não descreve
      expect(l.descrita?.cnae_secundarios_descritos).toEqual([{ codigo: '4712100', descricao: expect.stringMatching(/\S/) }]);
      const det = await chamar('GET', '/empresas/:id', { params: { id } });
      expect(det.corpo).toMatchObject({ ficha: { municipio_nome: 'Manaus', municipio_ibge: '1302603', cnae_principal: '4711302' } });
      // CNAE e município fora das tabelas: descrição e nome nulos, sem erro.
      const desc = await comPlataforma((tx) => tx.consultar<{ c: unknown; m: unknown }>(`SELECT plataforma.cnae_descricoes(ARRAY['0000000','4711302','4711-3/02']) c, plataforma.municipio_nomes(ARRAY['9999999']) m`));
      expect(desc[0]!.m).toEqual([]);
      expect((desc[0]!.c as unknown[]).length).toBe(1);
      // Só o papel config executa (RN: 42501 para os demais).
      const app = await b.admin.connect();
      try {
        await app.query('BEGIN');
        await app.query('SET LOCAL ROLE macuxierp_app');
        const e = await app.query(`SELECT plataforma.cnae_descricoes(ARRAY['4711302'])`).catch((x: unknown) => x);
        expect(e).toMatchObject({ code: '42501' });
      } finally {
        await app.query('ROLLBACK');
        app.release();
      }
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

  it('v0.3.28 (0078): Usuários na Config — criar, listar mascarado, travar o último admin, inativar, reativar e excluir', async () => {
    const id = await criarTenant(b.admin, `portal-usu-${randomUUID().slice(0, 8)}`, ['core']);
    const P = (usuario?: string): Record<string, string> => (usuario ? { id, usuario } : { id });
    const adm = await chamar('POST', '/empresas/:id/usuarios', { params: P(), corpo: { nome: 'Ana Admin', email: 'ana@exemplo.com.br', perfil: 'administrador' } }, true);
    expect(adm.status).toBe(201);
    const { usuario: a, senha_provisoria } = UsuarioConfigComSenha.parse(adm.corpo);
    expect(senha_provisoria.length).toBeGreaterThan(8);
    expect([a.email_mascarado, a.ultimo_admin_ativo, a.acoes]).toEqual(['an****@exemplo.com.br', true, ['editar', 'redefinir_senha', 'inativar']]);
    // RN-CORE-01: a API recusa antes do banco; e o banco recusa sozinho (MXU01 → 422) quando a API é contornada.
    const e1 = await chamar('POST', '/empresas/:id/usuarios/:usuario/excluir', { params: P(a.id) }).catch((x: unknown) => x);
    expect([(e1 as ErroApi).status, (e1 as ErroApi).message]).toEqual([422, MENSAGEM_ULTIMO_ADMIN]);
    const e2 = await comPlataforma((tx) => new RepositorioPlataformaSql().mudarSituacaoUsuario(tx, { id, usuario: a.id, acao: 'inativar', request_id: randomUUID() })).catch((x: unknown) => x);
    expect((e2 as ErroApi).status).toBe(422);
    // RN-CORE-17: e-mail em uso = 409; inativar é reversível; excluir libera o e-mail.
    const fat = UsuarioConfigComSenha.parse((await chamar('POST', '/empresas/:id/usuarios', { params: P(), corpo: { nome: 'Bia Fat', email: 'bia@exemplo.com.br', perfil: 'faturista' } }, true)).corpo).usuario;
    const rep = await chamar('POST', '/empresas/:id/usuarios', { params: P(), corpo: { nome: 'Outra', email: 'BIA@exemplo.com.br', perfil: 'fiscal' } }).catch((x: unknown) => x);
    expect((rep as ErroApi).status).toBe(409);
    const ina = UsuarioConfig.parse((await chamar('POST', '/empresas/:id/usuarios/:usuario/inativar', { params: P(fat.id) }, true)).corpo);
    expect([ina.situacao, ina.acoes]).toEqual(['inativo', ['editar', 'reativar', 'excluir']]);
    const lista = ListaUsuariosConfig.parse((await chamar('GET', '/empresas/:id/usuarios', { params: P() })).corpo);
    expect(lista.itens.map((u) => [u.nome, u.situacao])).toEqual([['Ana Admin', 'ativo'], ['Bia Fat', 'inativo']]);
    expect(JSON.stringify(lista)).not.toContain('bia@');
    expect(UsuarioConfig.parse((await chamar('POST', '/empresas/:id/usuarios/:usuario/reativar', { params: P(fat.id) }, true)).corpo).situacao).toBe('ativo');
    const editado = UsuarioConfig.parse((await chamar('PATCH', '/empresas/:id/usuarios/:usuario', { params: P(fat.id), corpo: { perfil: 'administrador' } }, true)).corpo);
    expect(editado.perfil).toBe('administrador');
    // Com dois administradores, o Excluir volta ao menu e sai (deleted_at): some da lista e o e-mail pode voltar.
    expect((await chamar('POST', '/empresas/:id/usuarios/:usuario/excluir', { params: P(fat.id) }, true)).corpo).toEqual({ id: fat.id, situacao: 'excluido' });
    const depois = ListaUsuariosConfig.parse((await chamar('GET', '/empresas/:id/usuarios', { params: P() })).corpo);
    expect(depois.itens.map((u) => u.id)).toEqual([a.id]);
    expect((await chamar('POST', '/empresas/:id/usuarios', { params: P(), corpo: { nome: 'Bia de Volta', email: 'bia@exemplo.com.br', perfil: 'fiscal' } })).status).toBe(201);
    // Redefinir senha: provisória só na resposta, troca obrigatória no próximo acesso.
    const r = UsuarioConfigComSenha.parse((await chamar('POST', '/empresas/:id/usuarios/:usuario/senha', { params: P(a.id) })).corpo);
    expect(r.usuario.deve_trocar_senha).toBe(true);
    // Usuário de outro tenant = 404.
    const outro = await criarTenant(b.admin, `portal-usu-${randomUUID().slice(0, 8)}`, ['core']);
    const nf = await chamar('POST', '/empresas/:id/usuarios/:usuario/senha', { params: { id: outro, usuario: a.id } }).catch((x: unknown) => x);
    expect((nf as ErroApi).status).toBe(404);
  });
});
