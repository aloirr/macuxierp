/**
 * Adaptador SQL do portal /config contra o PostgreSQL real com a 0033 (T-0050, ADR 0012): cada teste abre uma transação
 * como a apps/api faz no `comPlataforma` (SET LOCAL ROLE macuxierp_config + a sessão do superadmin) e chama o plugin.
 * Sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`). Local: `bash db/scripts/pg-local.sh`.
 */
import { randomUUID } from 'node:crypto';
import { ErroApi, type Transacao } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
