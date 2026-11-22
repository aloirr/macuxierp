// T-0030 (RN-CORE-08, ADR 0006): API real no PostgreSQL local (macuxierp_app, RLS valendo). Prova que o tenant nunca põe a
// filial em produção fiscal, que só o script do operador o faz e que a volta para homologação é auditada.
// A RLS direta (política app_so_homologacao_* da 0008) está em db/testes/modulos.db.test.ts.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../apps/api/src/app';
import { dependenciasCoreDeTeste } from '../../apps/api/src/apoio-teste';
import { RepositorioAuthPg } from '../../apps/api/src/auth/repositorio-pg';
import { CONFIG_AUTH_PADRAO } from '../../apps/api/src/auth/servico';
import { gerarHashSenha } from '../../apps/api/src/auth/senha';
import { montarModulos } from '../../apps/api/src/modulos';
import { RepositorioCoreSql } from '../../modules/core/api';
import { relogioDoSistema } from '../../packages/platform-sdk/src/banco';
import { AuditoriaPg, FilaDeTrabalhosPg, LicencasPg, OutboxPg } from '../../packages/platform-sdk/src/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';

const raiz = join(import.meta.dirname, '..', '..');
const SENHA = 'senha-de-teste-123';
const ARGON2_RAPIDO = { memoria: 64, passes: 1, paralelismo: 1 };
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
interface ItemAuditoria {
  usuario_id: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  antes: { ambiente: string; recado_aprovacao: string | null };
  depois: { filial_id: string; ambiente: string; recado_aprovacao: string | null; origem: string };
}

describe.skipIf(!PG_DISPONIVEL)('T-0030: ambiente fiscal pela API no PostgreSQL (RN-CORE-08, ADR 0006)', () => {
  let b: BancoEfemero;
  let app: Awaited<ReturnType<typeof criarApp>>;
  let tenant: string;
  let token: string;
  let executarOperador: Executar;
  const usuario = randomUUID();
  const filial = randomUUID();

  beforeAll(async () => {
    b = await criarBancoEfemero();
    tenant = await criarTenant(b.admin, SLUG, ['cadastros']);
    await b.admin.query(
      `INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, nome_fantasia, crt, logradouro, numero, bairro,
         municipio_ibge, uf, cep) VALUES ($1, $2, '11222333000181', 'Matriz E2E', 'Matriz E2E', '3', 'Rua A', '1', 'Centro',
         '1302603', 'AM', '69000000')`,
      [filial, tenant],
    );
    await b.admin.query(
      `INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, filial_ids)
       VALUES ($1, $2, 'adm@e2e-t0030.teste', 'Administradora E2E', $3, 'administrador', $4::uuid[])`,
      [usuario, tenant, await gerarHashSenha(SENHA, ARGON2_RAPIDO), [filial]],
    );
    app = await criarApp({
      versao: 'teste',
      auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: 'segredo-de-teste-com-mais-de-32-caracteres', argon2: ARGON2_RAPIDO },
      cookieSeguro: true,
      banco: b.banco('macuxierp_app'),
      repoAuth: new RepositorioAuthPg(),
      licencas: new LicencasPg(),
      outbox: new OutboxPg(),
      auditoria: new AuditoriaPg(),
      trabalhos: new FilaDeTrabalhosPg(),
      relogio: relogioDoSistema,
      modulos: montarModulos({ core: dependenciasCoreDeTeste(new RepositorioCoreSql()) }),
      logger: false,
    });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: SLUG, email: 'adm@e2e-t0030.teste', senha: SENHA } });
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
    expect(auditoriaDoOperador[0]).toMatchObject({ usuario_id: null, acao: 'core.ambiente.trocado', depois: { ambiente: 'producao', origem: 'script' } });
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
    const daApi = itens.filter((i) => i.depois.origem === 'api');
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
