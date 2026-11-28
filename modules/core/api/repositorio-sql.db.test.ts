/**
 * Concorrência do adaptador SQL do core contra o PostgreSQL real: transações simultâneas, cada uma numa conexão própria
 * do admin com BEGIN, SET LOCAL ROLE macuxierp_app e app.tenant_id, como a API faz (RLS valendo).
 * Banco efêmero de `@macuxierp/platform-sdk/pg-testes`; sem Postgres o teste pula (falha com `MACUXI_PG_EXIGIR=1`).
 * Local: `bash db/scripts/pg-local.sh`.
 */
import { randomUUID } from 'node:crypto';
import type { Transacao } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MENSAGEM_ULTIMO_ADMIN } from '../contracts';
import { alterarUsuarioComTrava } from './alterar-usuario';
import { RepositorioCoreSql } from './repositorio-sql';

/** O que a sessão usa da conexão do pool do admin (`pg.PoolClient`). */
interface Conexao {
  query(sql: string, parametros?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

/** Uma transação longa aberta: cada `consultar` é uma etapa da mesma transação, no papel da aplicação e no tenant. */
class Sessao implements Transacao {
  private aberta = true;
  private constructor(private readonly c: Conexao) {}

  static async abrir(b: BancoEfemero, tenant: string): Promise<Sessao> {
    const c: Conexao = await b.admin.connect();
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE macuxierp_app');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    return new Sessao(c);
  }

  async consultar<L>(sql: string, p: readonly unknown[] = []): Promise<L[]> {
    return (await this.c.query(sql, p as unknown[])).rows as L[];
  }

  async confirmar(): Promise<void> {
    await this.c.query('COMMIT').finally(() => this.fechar());
  }

  async descartar(): Promise<void> {
    if (!this.aberta) return;
    await this.c.query('ROLLBACK').catch(() => undefined);
    this.fechar();
  }

  private fechar(): void {
    if (!this.aberta) return;
    this.aberta = false;
    this.c.release();
  }
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 'travada' se a promessa não terminar em `ms` (a transação espera a trava do banco). */
const travada = (p: Promise<unknown>, ms = 400) => Promise.race([p.then(() => 'livre' as const), pausa(ms).then(() => 'travada' as const)]);

describe.skipIf(!PG_DISPONIVEL)('concorrência do adaptador SQL do core (PostgreSQL real)', () => {
  let b: BancoEfemero;
  let T: string;
  let T2: string;
  const U1 = randomUUID();
  const U2 = randomUUID();
  const V1 = randomUUID();
  const V2 = randomUUID();
  const repo = new RepositorioCoreSql();
  const abertas: Sessao[] = [];
  const abrir = async (tenant = T) => {
    const s = await Sessao.abrir(b, tenant);
    abertas.push(s);
    return s;
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    T = await criarTenant(b.admin, 'empresa-core');
    T2 = await criarTenant(b.admin, 'outra-empresa');
    await b.admin.query("INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, 'Empresa Piloto LTDA', '11222333000181')", [T]);
    const adm = (id: string, tenant: string, email: string, nome: string) =>
      b.admin.query("INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil) VALUES ($1, $2, $3, $4, '$argon2id$x', 'administrador')", [id, tenant, email, nome]);
    await adm(U1, T, 'um@piloto.test', 'Admin Um');
    await adm(U2, T, 'dois@piloto.test', 'Admin Dois');
    await adm(V1, T2, 'um@outra.test', 'Outro Um');
    await adm(V2, T2, 'dois@outra.test', 'Outro Dois');
  }, 120_000);
  afterAll(async () => {
    await Promise.all(abertas.map((s) => s.descartar().catch(() => undefined)));
    await b?.remover();
  });

  it('RF-CORE-01: duas gravações da empresa com o mesmo token de updated_at: a primeira vence e a segunda recebe null (409)', async () => {
    const leitura = await abrir();
    const lida = await repo.empresa(leitura);
    await leitura.confirmar();
    const token = new Date(lida?.updated_at as unknown as string);
    const dados = { razao_social: 'Primeira LTDA', nome_fantasia: null, ie: null, fuso: 'America/Manaus' };

    const t1 = await abrir();
    const t2 = await abrir();
    await expect(repo.atualizarEmpresa(t1, dados, token, token)).resolves.toMatchObject({ razao_social: 'Primeira LTDA' });
    const segunda = repo.atualizarEmpresa(t2, { ...dados, razao_social: 'Segunda LTDA' }, token, token);
    expect(await travada(segunda)).toBe('travada'); // espera a trava da linha da primeira
    await t1.confirmar();
    await expect(segunda).resolves.toBeNull();
    await t2.confirmar();
    const fim = await abrir();
    expect((await repo.empresa(fim))?.razao_social).toBe('Primeira LTDA');
    await fim.confirmar();
  });

  it('RF-CORE-01: duas gravações do usuário com o mesmo token de updated_at: a primeira vence e a segunda recebe null (409)', async () => {
    const leitura = await abrir(T2);
    const lida = await repo.usuarioPorId(leitura, V1);
    await leitura.confirmar();
    const token = new Date(lida?.updated_at as unknown as string);

    const t1 = await abrir(T2);
    const t2 = await abrir(T2);
    await expect(repo.atualizarUsuario(t1, V1, { nome: 'Primeiro Nome' }, undefined, token)).resolves.toMatchObject({ nome: 'Primeiro Nome' });
    const segunda = repo.atualizarUsuario(t2, V1, { nome: 'Segundo Nome' }, undefined, token);
    expect(await travada(segunda)).toBe('travada'); // espera a trava da linha da primeira
    await t1.confirmar();
    await expect(segunda).resolves.toBeNull();
    await t2.confirmar();
    const fim = await abrir(T2);
    expect((await repo.usuarioPorId(fim, V1))?.nome).toBe('Primeiro Nome');
    await fim.confirmar();
  });

  it('RN-CORE-01: dois administradores inativando um ao outro ao mesmo tempo: o segundo é recusado e sobra um ativo', async () => {
    const t1 = await abrir();
    const t2 = await abrir();
    const agora = new Date('2026-11-21T15:00:00Z');

    await repo.travarAdministradoresAtivos(t1); // t1 segura a trava
    const segundo = alterarUsuarioComTrava(repo, t2, U1, { ativo: false }, agora); // t2 (inativando U1) espera a trava
    expect(await travada(segundo)).toBe('travada');
    expect(await alterarUsuarioComTrava(repo, t1, U2, { ativo: false }, agora)).toMatchObject({ tipo: 'ok' });
    await t1.confirmar();

    expect(await segundo).toEqual({ tipo: 'recusado', mensagem: MENSAGEM_ULTIMO_ADMIN });
    await t2.confirmar();
    const leitura = await abrir();
    expect(await repo.contarAdministradoresAtivos(leitura, randomUUID())).toBe(1);
    expect((await repo.usuarioPorId(leitura, U1))?.ativo).toBe(true);
    await leitura.confirmar();
  });

  it('RN-CORE-01: a trava e a contagem ficam no próprio tenant (o outro tenant não espera nem entra na conta)', async () => {
    const agora = new Date('2026-11-21T15:00:00Z');
    const doOutro = await abrir(T2);
    await repo.travarAdministradoresAtivos(doOutro); // o outro tenant segura a trava dos administradores dele

    const meu = await abrir(T);
    expect(await travada(repo.travarAdministradoresAtivos(meu))).toBe('livre'); // a trava de T2 não bloqueia T
    // T tem 1 administrador ativo (U1); os 2 de T2 não contam: inativar U1 é recusado
    expect(await repo.contarAdministradoresAtivos(meu, U1)).toBe(0);
    expect(await alterarUsuarioComTrava(repo, meu, U1, { ativo: false }, agora)).toMatchObject({ tipo: 'recusado' });
    // e o contrário: T2 tem 2 administradores, então inativar V1 passa, sem olhar os de T
    expect(await alterarUsuarioComTrava(repo, doOutro, V1, { ativo: false }, agora)).toMatchObject({ tipo: 'ok' });
    // o administrador de outro tenant não é visível (RLS)
    expect(await repo.usuarioPorId(meu, V2)).toBeNull();
    await meu.confirmar();
    await doOutro.confirmar();
  });

  it('T-0087 (RLS): usuários, licenças e auditoria de um tenant não aparecem no outro; o filtro por usuário e por período vale só dentro do tenant', async () => {
    await b.admin.query("INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ($1, 'cadastros'), ($2, 'pedido')", [T, T2]);
    const aud = (tenant: string, usuario: string, acao: string, em: string) =>
      b.admin.query("INSERT INTO plataforma.auditoria (tenant_id, usuario_id, acao, entidade, ocorrido_em) VALUES ($1, $2, $3, 'usuario', $4)", [tenant, usuario, acao, em]);
    await aud(T, U1, 'core.usuario.criado', '2026-11-10T12:00:00Z');
    await aud(T, U2, 'core.usuario.alterado', '2026-11-20T12:00:00Z');
    await aud(T2, V1, 'core.usuario.criado', '2026-11-10T12:00:00Z');

    const meu = await abrir(T);
    const usuarios = await repo.listarUsuarios(meu, { limite: 50, inativos: true });
    expect(usuarios.map((u) => u.id).sort()).toEqual([U1, U2].sort());
    expect((await repo.licencas(meu)).map((l) => l.modulo)).toEqual(['cadastros']);
    const todas = await repo.auditoria(meu, { limite: 50 });
    expect(todas).toHaveLength(2);
    expect(todas.some((a) => a.usuario_id === V1)).toBe(false);
    expect((await repo.auditoria(meu, { limite: 50, usuario_id: U2 })).map((a) => a.acao)).toEqual(['core.usuario.alterado']);
    expect(await repo.auditoria(meu, { limite: 50, usuario_id: V1 })).toEqual([]); // usuário de outro tenant: nada, nem por filtro
    expect((await repo.auditoria(meu, { limite: 50, de: new Date('2026-11-15T00:00:00Z') })).map((a) => a.usuario_id)).toEqual([U2]);
    // o cursor pagina por id dentro do tenant
    const p1 = await repo.auditoria(meu, { limite: 1 });
    const p2 = await repo.auditoria(meu, { limite: 5, cursor: p1[0]?.id });
    expect(p2).toHaveLength(1);
    expect(p2[0]?.id).not.toBe(p1[0]?.id);
    await meu.confirmar();

    const outro = await abrir(T2);
    expect((await repo.licencas(outro)).map((l) => l.modulo)).toEqual(['pedido']);
    expect((await repo.auditoria(outro, { limite: 50 })).map((a) => a.usuario_id)).toEqual([V1]);
    await outro.confirmar();
  });

  it('RN-CORE-17 (0078): inativar não grava deleted_at; excluir grava, some das leituras e libera o e-mail no app', async () => {
    const id = randomUUID();
    const novo = { email: 'reuso@piloto.test', nome: 'Pessoa Reuso', senha_hash: '$argon2id$y', perfil: 'faturista', filial_ids: [], ativo: true, external_id: null };
    const t1 = await abrir();
    await repo.criarUsuario(t1, { id, ...novo } as never);
    const agora = new Date('2026-11-27T23:00:00Z');
    await repo.atualizarUsuario(t1, id, { ativo: false }, agora);
    await t1.confirmar();
    const linha = async (x: string) => (await b.admin.query('SELECT ativo, deleted_at FROM plataforma.usuario WHERE id = $1', [x])).rows[0] as { ativo: boolean; deleted_at: Date | null };
    expect(await linha(id)).toEqual({ ativo: false, deleted_at: null });
    const t2 = await abrir();
    expect(await repo.usuarioPorEmail(t2, novo.email)).toMatchObject({ id, ativo: false });
    expect(await repo.excluirUsuario(t2, id, agora)).toMatchObject({ id, ativo: false });
    expect(await repo.excluirUsuario(t2, id, agora)).toBeNull();
    expect(await repo.usuarioPorId(t2, id)).toBeNull();
    expect(await repo.usuarioPorEmail(t2, novo.email)).toBeNull();
    expect((await repo.listarUsuarios(t2, { limite: 50, inativos: true })).map((u) => u.id)).not.toContain(id);
    // O índice parcial da 0078 aceita o mesmo e-mail num usuário novo.
    await repo.criarUsuario(t2, { id: randomUUID(), ...novo } as never);
    await t2.confirmar();
    expect((await linha(id)).deleted_at).not.toBeNull();
  });

  it('RN-CORE-18 (0079): o mesmo e-mail em outra empresa no INSERT do BKO = 409 email_em_uso (não 500)', async () => {
    const novo = { email: 'dupla@piloto.test', nome: 'Pessoa Dupla', senha_hash: '$argon2id$y', perfil: 'faturista', filial_ids: [], ativo: true, external_id: null };
    const t1 = await abrir();
    await repo.criarUsuario(t1, { id: randomUUID(), ...novo } as never);
    await t1.confirmar();
    const t2 = await abrir(T2);
    const e = await repo.criarUsuario(t2, { id: randomUUID(), ...novo } as never).catch((x: unknown) => x);
    expect(e).toMatchObject({ status: 409, codigo: 'CONFLITO', detalhes: { codigo: 'email_em_uso' }, campos: { email: 'Este e-mail já está em uso em outra empresa. Use outro e-mail.' } });
    await t2.descartar();
  });

  it('T-0052: criar usuário e redefinir senha exigem a troca da senha provisória', async () => {
    const id = randomUUID();
    const flag = async () => (await b.admin.query('SELECT deve_trocar_senha FROM plataforma.usuario WHERE id = $1', [id])).rows[0] as { deve_trocar_senha: boolean };
    const t1 = await abrir();
    await repo.criarUsuario(t1, { id, email: 'novo@piloto.test', nome: 'Novo Usuário', senha_hash: '$argon2id$y', perfil: 'administrador', filial_ids: [], ativo: true, external_id: null } as never);
    await t1.confirmar();
    expect(await flag()).toEqual({ deve_trocar_senha: true });
    await b.admin.query('UPDATE plataforma.usuario SET deve_trocar_senha = false WHERE id = $1', [id]);
    const t2 = await abrir();
    await repo.definirSenha(t2, id, '$argon2id$z');
    await t2.confirmar();
    expect(await flag()).toEqual({ deve_trocar_senha: true });
  });

  it('RN-CORE-13: emitir grava hash e validade sem mudar senha_hash; o segundo pedido substitui o anterior', async () => {
    const id = randomUUID();
    const ler = async () => (await b.admin.query('SELECT senha_hash, senha_temporaria_hash h, senha_temporaria_expira_em e FROM plataforma.usuario WHERE id = $1', [id])).rows[0] as { senha_hash: string; h: string | null; e: Date | null };
    await b.admin.query("INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil) VALUES ($1, $2, 'temp@piloto.test', 'Usuário Temp', '$argon2id$atual', 'administrador')", [id, T]);
    const validade1 = new Date('2030-01-01T12:00:00Z');
    const validade2 = new Date('2030-02-01T12:00:00Z');
    const t1 = await abrir();
    await repo.emitirSenhaTemporaria(t1, id, '$argon2id$temp1', validade1);
    await t1.confirmar();
    expect(await ler()).toMatchObject({ senha_hash: '$argon2id$atual', h: '$argon2id$temp1', e: validade1 });
    const t2 = await abrir();
    await repo.emitirSenhaTemporaria(t2, id, '$argon2id$temp2', validade2);
    await t2.confirmar();
    expect(await ler()).toMatchObject({ senha_hash: '$argon2id$atual', h: '$argon2id$temp2', e: validade2 });
  });

  it('RN-CORE-13: cancelarSenhaTemporaria zera as duas colunas só se havia pendente, sem tocar em senha_hash nem deve_trocar_senha; sem pendente ou na repetição devolve false', async () => {
    const id = randomUUID();
    const semPendente = randomUUID();
    await b.admin.query("INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, deve_trocar_senha, senha_temporaria_hash, senha_temporaria_expira_em) VALUES ($1, $2, 'cancela@piloto.test', 'Usuário Cancela', '$argon2id$atual', 'administrador', false, '$argon2id$t', '2030-01-01T12:00:00Z')", [id, T]);
    await b.admin.query("INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil) VALUES ($1, $2, 'sem-pend@piloto.test', 'Usuário Sem', '$argon2id$atual', 'administrador')", [semPendente, T]);
    const ler = async () => (await b.admin.query('SELECT senha_hash, deve_trocar_senha d, senha_temporaria_hash h, senha_temporaria_expira_em e FROM plataforma.usuario WHERE id = $1', [id])).rows[0];
    const t1 = await abrir();
    expect(await repo.cancelarSenhaTemporaria(t1, id)).toBe(true);
    await t1.confirmar();
    expect(await ler()).toEqual({ senha_hash: '$argon2id$atual', d: false, h: null, e: null });
    const t2 = await abrir();
    expect(await repo.cancelarSenhaTemporaria(t2, id)).toBe(false);
    expect(await repo.cancelarSenhaTemporaria(t2, semPendente)).toBe(false);
    await t2.confirmar();
  });

  it('RN-CORE-13: definirSenha zera a senha temporária (as duas colunas)', async () => {
    const id = randomUUID();
    await b.admin.query("INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, senha_temporaria_hash, senha_temporaria_expira_em) VALUES ($1, $2, 'zera@piloto.test', 'Usuário Zera', '$argon2id$atual', 'administrador', '$argon2id$t', '2030-01-01T12:00:00Z')", [id, T]);
    const t = await abrir();
    await repo.definirSenha(t, id, '$argon2id$nova');
    await t.confirmar();
    const { rows } = await b.admin.query('SELECT senha_hash, senha_temporaria_hash h, senha_temporaria_expira_em e FROM plataforma.usuario WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ senha_hash: '$argon2id$nova', h: null, e: null });
  });

  it('RN-CORE-13: o CHECK da 0048 recusa só uma das duas colunas da temporária preenchida (23514)', async () => {
    const t = await abrir();
    await expect(t.consultar("UPDATE plataforma.usuario SET senha_temporaria_hash = '$argon2id$so' WHERE id = $1", [U1])).rejects.toMatchObject({ code: '23514' });
    await t.descartar();
  });
});
