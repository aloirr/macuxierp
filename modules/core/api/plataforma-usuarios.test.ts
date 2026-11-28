import { CABECALHOS_SENHA_PROVISORIA, ErroApi, type RotaPlataforma, type Transacao } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ListaFiliaisConfig, MENSAGEM_ULTIMO_ADMIN, ROTAS_USUARIOS_CONFIG, UsuarioConfig, UsuarioConfigComSenha } from '../contracts';
import { MANIFESTOS_TESTE } from './manifestos-teste';
import { criarPluginPlataformaCore, semPrefixoPortal, type ItemUsuarioBanco, type RepositorioPlataforma } from './plataforma';

const EMPRESA = '00000000-0000-4000-8000-0000000000e1';
const ADM = '00000000-0000-4000-8000-0000000000a1';
const FAT = '00000000-0000-4000-8000-0000000000a2';
const INATIVO = '00000000-0000-4000-8000-0000000000a3';
const FILIAL = '00000000-0000-4000-8000-0000000000f1';
const FILIAL2 = '00000000-0000-4000-8000-0000000000f2';
const FORA = '00000000-0000-4000-8000-0000000000ff';

const item = (p: Partial<ItemUsuarioBanco> & Pick<ItemUsuarioBanco, 'id'>): ItemUsuarioBanco => ({
  nome: 'Pessoa Teste', email_mascarado: 'pe****@exemplo.test', perfil: 'faturista', filial_ids: [], situacao: 'ativo',
  ultimo_acesso_em: null, deve_trocar_senha: false, ultimo_admin_ativo: false, ...p,
});

/** O banco da 0078 em memória: guarda as chamadas; a trava MXU01 do banco não é simulada (a da API vem antes). */
function montar(linhas: ItemUsuarioBanco[] = [
  item({ id: ADM, perfil: 'administrador', ultimo_admin_ativo: true }),
  item({ id: FAT }),
  item({ id: INATIVO, situacao: 'inativo' }),
]) {
  const chamadas: string[] = [];
  const hashes: string[] = [];
  const repo = {
    async listarUsuarios(_tx: Transacao, id: string) { chamadas.push(`listar:${id}`); return linhas; },
    async listarFiliais(_tx: Transacao, id: string) {
      chamadas.push(`filiais:${id}`);
      return [{ id: FILIAL, nome: 'Matriz', padrao: true }, { id: FILIAL2, nome: 'Loja Centro', padrao: false }];
    },
    async criarUsuario(_tx: Transacao, p: { email: string; nome: string; perfil: string; senha_hash: string; request_id: string }) {
      chamadas.push(`criar:${p.perfil}:${p.request_id}`);
      hashes.push(p.senha_hash);
      return item({ id: FORA, nome: p.nome, perfil: p.perfil as ItemUsuarioBanco['perfil'], deve_trocar_senha: true });
    },
    async editarUsuario(_tx: Transacao, p: { usuario: string; patch: Record<string, unknown> }) {
      chamadas.push(`editar:${p.usuario}:${Object.keys(p.patch).join(',')}`);
      return { ...linhas.find((l) => l.id === p.usuario)!, ...p.patch } as ItemUsuarioBanco;
    },
    async redefinirSenhaUsuario(_tx: Transacao, p: { usuario: string; senha_hash: string }) {
      chamadas.push(`senha:${p.usuario}`);
      hashes.push(p.senha_hash);
      return item({ id: p.usuario, deve_trocar_senha: true });
    },
    async mudarSituacaoUsuario(_tx: Transacao, p: { usuario: string; acao: string }) {
      chamadas.push(`${p.acao}:${p.usuario}`);
      if (p.acao === 'excluir') return { id: p.usuario, situacao: 'excluido' as const };
      return item({ id: p.usuario, situacao: p.acao === 'inativar' ? 'inativo' : 'ativo' });
    },
  } as unknown as RepositorioPlataforma;
  const plugin = criarPluginPlataformaCore({
    repo,
    manifestos: MANIFESTOS_TESTE,
    hashSenha: async (s) => `$argon2id$teste$${s.length}`,
    aleatorios: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256),
  });
  const auditadas: unknown[] = [];
  const contexto = {
    sessao: { superadmin_id: '00000000-0000-4000-8000-00000000005a', sessao_id: '00000000-0000-4000-8000-00000000005e' },
    tx: { id: 'plataforma' } as unknown as Transacao,
    request_id: 'req-1',
    agora: new Date('2026-11-27T23:00:00Z'),
    auditar: async (d: unknown) => { auditadas.push(d); },
  };
  const chamar = async (r: { metodo: string; caminho: string }, params: Record<string, string>, corpo?: unknown) => {
    const rota = plugin.rotas.find((x) => x.metodo === r.metodo && x.caminho === semPrefixoPortal(r)) as RotaPlataforma;
    return rota.executar(contexto as never, { corpo: rota.corpo ? rota.corpo.parse(corpo) : undefined, params } as never);
  };
  const erro = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { if (e instanceof ErroApi) return e; throw e; }
    throw new Error('esperava ErroApi');
  };
  return { plugin, chamar, erro, chamadas, hashes, auditadas };
}

const SEM_CACHE = { 'cache-control': 'no-store', pragma: 'no-cache' };

describe('v0.3.28: Usuários da empresa na Config (0078, RN-CORE-01, RN-CORE-17)', () => {
  it('cada rota declara a própria ação de plataforma; criar e redefinir senha exigem Idempotency-Key', () => {
    const { plugin } = montar();
    const por = (r: { metodo: string; caminho: string }) => plugin.rotas.find((x) => x.metodo === r.metodo && x.caminho === semPrefixoPortal(r));
    const R = ROTAS_USUARIOS_CONFIG;
    expect([R.listar, R.criar, R.editar, R.redefinirSenha, R.inativar, R.reativar, R.excluir].map((r) => por(r)?.acao)).toEqual([
      'plataforma.usuario.ver', 'plataforma.usuario.criar', 'plataforma.usuario.editar', 'plataforma.usuario.redefinir_senha',
      'plataforma.usuario.inativar', 'plataforma.usuario.reativar', 'plataforma.usuario.excluir',
    ]);
    expect(por(R.criar)?.idempotencia).toBe('obrigatoria');
    expect(por(R.redefinirSenha)?.idempotencia).toBe('obrigatoria');
  });

  it('T-0130: GET filiais exige plataforma.usuario.ver, devolve { itens } no ListaFiliaisConfig e é no-store', async () => {
    const t = montar();
    const rota = t.plugin.rotas.find((x) => x.metodo === 'GET' && x.caminho === semPrefixoPortal(ROTAS_USUARIOS_CONFIG.filiais));
    expect(rota?.acao).toBe('plataforma.usuario.ver');
    const r = await t.chamar(ROTAS_USUARIOS_CONFIG.filiais, { id: EMPRESA });
    expect(r.cabecalhos).toMatchObject(SEM_CACHE);
    expect(ListaFiliaisConfig.parse(r.corpo).itens.map((f) => [f.nome, f.padrao])).toEqual([['Matriz', true], ['Loja Centro', false]]);
    expect(t.chamadas).toEqual([`filiais:${EMPRESA}`]);
    expect(t.auditadas).toEqual([]);
  });

  it('lista com o e-mail mascarado do banco e as ações do domain; o último admin fica sem Excluir (52 A); no-store', async () => {
    const t = montar();
    const r = await t.chamar(ROTAS_USUARIOS_CONFIG.listar, { id: EMPRESA });
    expect(r.cabecalhos).toMatchObject(SEM_CACHE);
    const itens = (r.corpo as { itens: unknown[] }).itens.map((i) => UsuarioConfig.parse(i));
    expect(itens.map((i) => [i.id, i.acoes])).toEqual([
      [ADM, ['editar', 'redefinir_senha', 'inativar']],
      [FAT, ['editar', 'redefinir_senha', 'inativar', 'excluir']],
      [INATIVO, ['editar', 'reativar', 'excluir']],
    ]);
    expect(itens[0]).toMatchObject({ email_mascarado: 'pe****@exemplo.test', ultimo_admin_ativo: true });
    expect(JSON.stringify(r.corpo)).not.toContain('"email"');
  });

  // no-store: a apps/api conclui a Idempotency-Key sem guardar o corpo e a repetição dá 409 (a senha nunca é repetida nem gravada).
  it('senha provisória: criar (201) e redefinir são no-store; o banco recebe só o hash; nada vai para auditar', async () => {
    const t = montar();
    const c = await t.chamar(ROTAS_USUARIOS_CONFIG.criar, { id: EMPRESA }, { nome: 'Nova Pessoa', email: 'Nova@Exemplo.test', perfil: 'fiscal' });
    expect(c.status).toBe(201);
    expect(UsuarioConfigComSenha.parse(c.corpo).usuario.acoes).toContain('excluir');
    const r = await t.chamar(ROTAS_USUARIOS_CONFIG.redefinirSenha, { id: EMPRESA, usuario: FAT });
    for (const x of [c, r]) {
      expect(x.cabecalhos).toEqual({ ...CABECALHOS_SENHA_PROVISORIA });
      const { senha_provisoria } = UsuarioConfigComSenha.parse(x.corpo);
      expect(t.hashes.some((h) => h.includes(senha_provisoria))).toBe(false);
    }
    expect(t.hashes).toHaveLength(2);
    expect(t.chamadas).toEqual(['criar:fiscal:req-1', `senha:${FAT}`]);
    expect(t.auditadas).toEqual([]);
  });

  it('RN-CORE-01: a API recusa (422) inativar, excluir ou rebaixar o último administrador ativo antes do banco', async () => {
    const t = montar();
    for (const r of [ROTAS_USUARIOS_CONFIG.inativar, ROTAS_USUARIOS_CONFIG.excluir]) {
      const e = await t.erro(t.chamar(r, { id: EMPRESA, usuario: ADM }));
      expect([e.status, e.message]).toEqual([422, MENSAGEM_ULTIMO_ADMIN]);
    }
    const e = await t.erro(t.chamar(ROTAS_USUARIOS_CONFIG.editar, { id: EMPRESA, usuario: ADM }, { perfil: 'gerente' }));
    expect(e.status).toBe(422);
    expect(t.chamadas.filter((c) => !c.startsWith('listar'))).toEqual([]);
    // Editar só o nome do último admin passa.
    await t.chamar(ROTAS_USUARIOS_CONFIG.editar, { id: EMPRESA, usuario: ADM }, { nome: 'Ana Nova' });
    expect(t.chamadas.at(-1)).toBe(`editar:${ADM}:nome`);
  });

  it('RN-CORE-17: inativar é reversível (devolve a linha inativa com Reativar); excluir devolve só {id, situacao: excluido}', async () => {
    const t = montar();
    const ina = UsuarioConfig.parse((await t.chamar(ROTAS_USUARIOS_CONFIG.inativar, { id: EMPRESA, usuario: FAT })).corpo);
    expect([ina.situacao, ina.acoes]).toEqual(['inativo', ['editar', 'reativar', 'excluir']]);
    const rea = UsuarioConfig.parse((await t.chamar(ROTAS_USUARIOS_CONFIG.reativar, { id: EMPRESA, usuario: INATIVO })).corpo);
    expect(rea.situacao).toBe('ativo');
    const exc = await t.chamar(ROTAS_USUARIOS_CONFIG.excluir, { id: EMPRESA, usuario: FAT });
    expect(exc.corpo).toEqual({ id: FAT, situacao: 'excluido' });
    expect(t.chamadas.filter((c) => !c.startsWith('listar'))).toEqual([`inativar:${FAT}`, `reativar:${INATIVO}`, `excluir:${FAT}`]);
  });

  it('usuário fora da empresa = 404; parâmetro fora do formato = 400; nenhuma rota chama auditar (o banco audita)', async () => {
    const t = montar();
    expect((await t.erro(t.chamar(ROTAS_USUARIOS_CONFIG.excluir, { id: EMPRESA, usuario: FORA }))).status).toBe(404);
    expect((await t.erro(t.chamar(ROTAS_USUARIOS_CONFIG.inativar, { id: EMPRESA, usuario: 'x' }))).status).toBe(400);
    await t.chamar(ROTAS_USUARIOS_CONFIG.redefinirSenha, { id: EMPRESA, usuario: FAT });
    expect(t.auditadas).toEqual([]);
  });

  it('editar recusa corpo vazio ou campo fora da lista (Zod)', () => {
    const t = montar();
    const rota = t.plugin.rotas.find((x) => x.caminho === '/empresas/:id/usuarios/:usuario' && x.metodo === 'PATCH')!;
    expect(rota.corpo!.safeParse({}).success).toBe(false);
    expect(rota.corpo!.safeParse({ email: 'x@y.test' }).success).toBe(false);
  });
});
