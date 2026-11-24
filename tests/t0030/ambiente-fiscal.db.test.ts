// T-0030 (RN-CORE-08, ADR 0006): API real no PostgreSQL local (macuxierp_app, RLS valendo). Prova que o tenant nunca põe a
// filial em produção fiscal, que só o script do operador o faz e que a volta para homologação é auditada.
// A RLS direta (política app_so_homologacao_* da 0008) está em db/testes/modulos.db.test.ts.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste, inserirAdministradorDeTeste, inserirFilialDeTeste, SENHA_DE_TESTE } from '../../apps/api/src/apoio-teste';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';

const raiz = join(import.meta.dirname, '..', '..');
const SLUG = 'e2e-t0030';
const RECADO = 'R-20261121-213000-alexandre';
const EVENTO = 'core.ambiente_fiscal.alterado@1';

interface Operacao {
  comando: 'producao' | 'homologacao';
  empresa: string;
  filial: string;
  operador: string;
  confirmar: boolean;
  recado?: string;
  arquivoRecado?: string;
  textoRecado?: string;
}
type Executar = (cliente: unknown, op: Operacao, agora: Date) => Promise<{ muda: boolean; aplicado: boolean }>;

interface Ambiente {
  filial_id: string;
  ambiente: string;
  recado_aprovacao: string | null;
}
/** Item da lista GET /v1/core/auditoria (AuditoriaItemLista: sem antes nem depois, minimização LGPD). */
interface ItemAuditoria {
  usuario_id: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
}
/** Linha de plataforma.auditoria, com antes e depois. */
interface LinhaAuditoria extends ItemAuditoria {
  antes: { ambiente: string; recado_aprovacao: string | null } | null;
  depois: { filial_id: string; ambiente: string; recado_aprovacao: string | null; origem: string } | null;
}

describe.skipIf(!PG_DISPONIVEL)('T-0030: ambiente fiscal pela API no PostgreSQL (RN-CORE-08, ADR 0006)', () => {
  let b: BancoEfemero;
  let app: Awaited<ReturnType<typeof appPgDeTeste>>['app'];
  let tenant: string;
  let token: string;
  let executarOperador: Executar;
  const usuario = randomUUID();
  const filial = randomUUID();

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, SLUG, ['cadastros']);
    await inserirFilialDeTeste(b.admin, tenant, { id: filial, cnpj: '11222333000181', nome: 'Matriz E2E' });
    await inserirAdministradorDeTeste(b.admin, tenant, { id: usuario, email: 'adm@e2e-t0030.teste', nome: 'Administradora E2E', filialIds: [filial] });
    ({ app } = await appPgDeTeste({ b }));
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: SLUG, email: 'adm@e2e-t0030.teste', senha: SENHA_DE_TESTE } });
    expect(login.statusCode).toBe(200);
    token = login.json<{ token_acesso: string }>().token_acesso;
    // Script do operador (.mjs, sem tipos): import dinâmico pelo caminho.
    const script = pathToFileURL(join(raiz, 'scripts', 'plataforma', 'ambiente-fiscal.mjs')).href;
    executarOperador = ((await import(script)) as { executar: Executar }).executar;
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  const autorizacao = () => ({ authorization: `Bearer ${token}` });
  const trocar = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/v1/core/ambientes-fiscais/${filial}`, headers: autorizacao(), payload });
  const ambientes = async (): Promise<Ambiente[]> => {
    const r = await app.inject({ url: `/v1/core/ambientes-fiscais?filial_id=${filial}`, headers: autorizacao() });
    expect(r.statusCode).toBe(200);
    return r.json<{ itens: Ambiente[] }>().itens;
  };
  const auditoria = async (): Promise<ItemAuditoria[]> => {
    const r = await app.inject({ url: '/v1/core/auditoria?entidade=ambiente_fiscal&limite=50', headers: autorizacao() });
    expect(r.statusCode).toBe(200);
    return r.json<{ itens: ItemAuditoria[] }>().itens;
  };
  const auditoriaNoBanco = async (): Promise<LinhaAuditoria[]> =>
    (
      await b.admin.query<LinhaAuditoria>(
        "SELECT usuario_id, acao, entidade, entidade_id, antes, depois FROM plataforma.auditoria WHERE tenant_id = $1 AND entidade = 'ambiente_fiscal' ORDER BY ocorrido_em, created_at",
        [tenant],
      )
    ).rows;
  const eventos = async (): Promise<number> =>
    (await b.admin.query<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.evento WHERE tenant_id = $1 AND nome = $2', [tenant, EVENTO])).rows[0]!.n;
  const linhaNoBanco = async () =>
    (await b.admin.query('SELECT ambiente, recado_aprovacao FROM core.ambiente_fiscal WHERE tenant_id = $1 AND filial_id = $2 AND deleted_at IS NULL', [tenant, filial])).rows;

  /** Como o operador: dono das tabelas (sem FORCE RLS), numa conexão só, porque `executar` abre a transação. */
  async function operador(op: Omit<Operacao, 'empresa' | 'filial' | 'operador' | 'confirmar'>) {
    const cliente = await b.admin.connect();
    try {
      return await executarOperador(cliente, { empresa: SLUG, filial, operador: 'operador-teste', confirmar: true, ...op }, new Date());
    } finally {
      cliente.release();
    }
  }

  const PEDIDO_DE_PRODUCAO = { ambiente: 'producao', recado_aprovacao: RECADO };
  const HOMOLOGACAO = [{ filial_id: filial, ambiente: 'homologacao', recado_aprovacao: null }];

  it('1. o administrador pede produção com recado válido: 422 RN-CORE-08 e continua em homologação, sem auditoria nem evento', async () => {
    expect(await ambientes()).toEqual(HOMOLOGACAO);
    const r = await trocar(PEDIDO_DE_PRODUCAO);
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'RN-CORE-08' });
    expect(await ambientes()).toEqual(HOMOLOGACAO);
    expect(await linhaNoBanco()).toEqual([]);
    expect(await auditoria()).toEqual([]);
    expect(await eventos()).toBe(0);
  });

  it('2. filial posta em produção pelo operador; o administrador não regrava produção e volta para homologação, auditado com origem api', async () => {
    const ida = await operador({
      comando: 'producao',
      recado: RECADO,
      arquivoRecado: `${RECADO}.md`,
      textoRecado: `---\nid: ${RECADO}\nde: alexandre\npara: todos\ntipo: aviso\n---\n\nAprovo produção fiscal ${SLUG}.\n`,
    });
    expect(ida).toMatchObject({ muda: true, aplicado: true });
    const emProducao = [{ filial_id: filial, ambiente: 'producao', recado_aprovacao: RECADO }];
    expect(await ambientes()).toEqual(emProducao);
    const auditoriaDoOperador = await auditoria();
    expect(auditoriaDoOperador).toHaveLength(1);
    expect(auditoriaDoOperador[0]).toMatchObject({ usuario_id: null, acao: 'core.ambiente.trocado' });
    const [doOperador] = await auditoriaNoBanco();
    expect(doOperador).toMatchObject({ usuario_id: null, acao: 'core.ambiente.trocado', depois: { ambiente: 'producao', origem: 'script' } });
    expect(await eventos()).toBe(1);

    // O tenant não regrava produção, nem com recado válido: 422 e a linha fica como está.
    const regrava = await trocar(PEDIDO_DE_PRODUCAO);
    expect(regrava.statusCode).toBe(422);
    expect(regrava.json()).toMatchObject({ codigo: 'RN-CORE-08' });
    expect(await ambientes()).toEqual(emProducao);
    expect(await auditoria()).toHaveLength(1);
    expect(await eventos()).toBe(1);

    // A volta para homologação pela API: sem aprovação, auditada e com evento. O recado_aprovacao do corpo é descartado.
    const volta = await trocar({ ambiente: 'homologacao', recado_aprovacao: RECADO });
    expect(volta.statusCode).toBe(200);
    expect(volta.json()).toEqual({ filial_id: filial, ambiente: 'homologacao', recado_aprovacao: null });
    expect(await ambientes()).toEqual(HOMOLOGACAO);
    const itens = await auditoria();
    expect(itens).toHaveLength(2);
    expect(itens.filter((i) => i.usuario_id === usuario).map((i) => i.acao)).toEqual(['core.ambiente.trocado']);
    const daApi = (await auditoriaNoBanco()).filter((i) => i.depois?.origem === 'api');
    expect(daApi).toEqual([
      expect.objectContaining({
        usuario_id: usuario,
        acao: 'core.ambiente.trocado',
        entidade: 'ambiente_fiscal',
        entidade_id: filial,
        antes: { ambiente: 'producao', recado_aprovacao: RECADO },
        depois: { filial_id: filial, ambiente: 'homologacao', recado_aprovacao: null, origem: 'api' },
      }),
    ]);
    expect(await eventos()).toBe(2);

    // Idempotente: repetir a volta dá 200 sem nova auditoria nem evento.
    const repete = await trocar({ ambiente: 'homologacao' });
    expect(repete.statusCode).toBe(200);
    expect(await auditoria()).toHaveLength(2);
    expect(await eventos()).toBe(2);
  });
});
