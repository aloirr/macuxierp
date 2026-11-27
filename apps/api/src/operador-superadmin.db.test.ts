/**
 * Superadmin de plataforma pelo operador (T-0050, ADR 0012 §5): o scripts/deploy/producao/superadmin.mjs DE VERDADE (o
 * mesmo que o operador.sh manda ao contêiner `psql`) contra o PostgreSQL migrado (0033), com um `psql` real e as PG* do
 * admin local. A senha provisória confere com o `conferirSenha` da API sobre o hash que a função de login do portal
 * (`plataforma.superadmin_para_login`) devolve; a sessão do portal é aberta e conferida pelas funções da 0033. A
 * redefinição da senha (T-0077, `--acao redefinir-senha`) confere a senha nova pelo mesmo caminho do login. O
 * turbo.json põe scripts/deploy/producao/** e scripts/plataforma/** nos inputs desta tarefa (ADR 0014, R2). Dados
 * fictícios (superadmin@exemplo.invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALFABETO_SENHA_TEMPORARIA } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALFABETO_API, envPsqlAdmin, padraoDoFonte, senhaProvisoria, trechoDoFonte } from './apoio-operador-teste';
import { ARGON2_PADRAO, conferirSenha } from './auth/senha';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRODUCAO = resolve(RAIZ, 'scripts', 'deploy', 'producao');
const SUPERADMIN_MJS = resolve(PRODUCAO, 'superadmin.mjs');
const FONTE_SA = readFileSync(SUPERADMIN_MJS, 'utf8');
const FONTE_EMPRESA = readFileSync(resolve(PRODUCAO, 'empresa.mjs'), 'utf8');
const FONTE_COMUM = readFileSync(resolve(RAIZ, 'scripts', 'plataforma', 'comum.mjs'), 'utf8');
const EMAIL = 'superadmin@exemplo.invalid';
const NOME = 'Pessoa Superadmin Fictícia';

describe('superadmin.mjs: cópias presas às fontes (o contêiner não tem node_modules nem os outros arquivos)', () => {
  it('PADRAO_OPERADOR e PADRAO_EMAIL iguais aos do empresa.mjs e do comum.mjs', () => {
    expect(padraoDoFonte(FONTE_SA, 'PADRAO_OPERADOR')).toBe(padraoDoFonte(FONTE_COMUM, 'PADRAO_OPERADOR'));
    expect(padraoDoFonte(FONTE_SA, 'PADRAO_EMAIL')).toBe(padraoDoFonte(FONTE_EMPRESA, 'PADRAO_EMAIL'));
  });
  it('ARGON2, hashSenha e errosSeguros idênticos aos do empresa.mjs', () => {
    for (const [inicio, fim] of [
      ['const ARGON2 =', '\n'],
      ['async function hashSenha(', '\n}\n'],
      ['function errosSeguros(', '\n}\n'],
    ] as const) {
      expect(trechoDoFonte(FONTE_SA, inicio, fim)).toBe(trechoDoFonte(FONTE_EMPRESA, inicio, fim));
    }
  });
  it('44 B: o alfabeto é o da senha temporária do SDK (48 símbolos)', () => expect(ALFABETO_API).toBe(ALFABETO_SENHA_TEMPORARIA));
  it('RD-1329: o filtro das sessões abertas é uma constante só, usada na contagem e na revogação', () => {
    expect(FONTE_SA.split('revogada_em IS NULL AND deleted_at IS NULL')).toHaveLength(2);
    expect(FONTE_SA.match(/FROM plataforma\.sessao_superadmin WHERE \$\{SESSOES_ABERTAS\};/g)).toHaveLength(2);
    expect(FONTE_SA.match(/UPDATE plataforma\.sessao_superadmin SET revogada_em = now\(\) WHERE \$\{SESSOES_ABERTAS\};/g)).toHaveLength(2);
  });
});

describe.skipIf(!PG_DISPONIVEL)('superadmin.mjs (operador.sh criar-superadmin e superadmin) no PostgreSQL migrado', () => {
  let b: BancoEfemero;
  const senha = senhaProvisoria();
  const senhaRedefinida = senhaProvisoria();

  beforeAll(async () => {
    b = await criarBancoEfemero();
  });
  afterAll(async () => {
    await b?.remover();
  });

  /** Como no contêiner: PG* do admin, e-mail, nome e senha só no ambiente; o argv leva só ação, operador e --confirmar. */
  function sa(acao: string, o: { confirmar?: boolean; senha?: string; email?: string; nome?: string; extra?: string[] } = {}) {
    const r = spawnSync(process.execPath, [SUPERADMIN_MJS, '--acao', acao, '--operador', 'alexandre', ...(o.confirmar ? ['--confirmar'] : []), ...(o.extra ?? [])], {
      env: {
        ...envPsqlAdmin(b.nome),
        MACUXIERP_SUPERADMIN_EMAIL: o.email ?? EMAIL.toUpperCase(),
        ...(acao === 'criar' ? { MACUXIERP_SUPERADMIN_NOME: o.nome ?? NOME } : {}),
        ...(o.senha ? { MACUXIERP_SENHA_INICIAL: o.senha } : {}),
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const saida = `${r.stdout}${r.stderr}`;
    // nunca e-mail (em qualquer caixa), nome, senha nem hash na saída do contêiner
    for (const proibido of [EMAIL, NOME, senha, senhaRedefinida, '$argon2id$', o.email || EMAIL]) expect(saida.toLowerCase()).not.toContain(proibido.toLowerCase());
    return { status: r.status, saida, estado: r.stdout.trim().split('\n').at(-1) };
  }

  const um = async <T>(sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as T[];
  type Linha = { id: string; email: string; nome: string; senha_hash: string; deve_trocar_senha: boolean; ativo: boolean; falhas_login: number; bloqueado_ate: Date | null; updated_at: Date; tenant_id: string };
  const linhas = () => um<Linha>('SELECT * FROM plataforma.superadmin WHERE email = $1', [EMAIL]);
  const auditoria = () =>
    um<{ tenant_id: string; usuario_id: string | null; superadmin_id: string | null; acao: string; entidade_id: string; antes: unknown; depois: Record<string, unknown> }>(
      "SELECT tenant_id, usuario_id, superadmin_id, acao, entidade_id, antes, depois FROM plataforma.auditoria WHERE entidade = 'superadmin' AND depois ? 'operador' ORDER BY ocorrido_em, created_at",
    );
  const referencia = async () => (await um<{ id: string }>('SELECT plataforma.tenant_referencia() AS id'))[0]!.id;
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');
  const sessaoValida = async (token: string) => (await um('SELECT * FROM plataforma.superadmin_sessao_por_token($1)', [sha(token)])).length === 1;

  it('criar sem --confirmar: simulação READ ONLY, nada gravado, sem senha', async () => {
    const r = sa('criar');
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: simulacao');
    expect(r.saida).toContain('superadmin: seria criado');
    expect(await linhas()).toHaveLength(0);
  });

  it.each([
    ['senha sem --confirmar', { senha }],
    ['--confirmar sem senha', { confirmar: true }],
    ['senha curta', { confirmar: true, senha: 'curta' }],
    ['e-mail fora do formato', { confirmar: true, senha, email: 'sem-arroba' }],
    ['nome com 81 caracteres', { confirmar: true, senha, nome: 'Á'.repeat(81) }],
    ['nome com quebra de linha', { confirmar: true, senha, nome: 'Pessoa\nFictícia' }],
    ['e-mail no argv', { confirmar: true, senha, extra: ['--email', 'outro@exemplo.invalid'] }],
  ])('criar com %s: saída 2, nada gravado', async (_n, o) => {
    const r = sa('criar', o);
    expect(r.status).toBe(2);
    expect(r.saida).toMatch(/\[superadmin\] /);
    expect(await um('SELECT 1 FROM plataforma.superadmin')).toHaveLength(0);
  });

  it('ação desconhecida e senha em ação que não é criar nem redefinir-senha: saída 2', () => {
    expect(sa('apagar').status).toBe(2);
    expect(sa('desativar', { confirmar: true, senha }).status).toBe(2);
    expect(sa('destravar', { confirmar: true, senha }).status).toBe(2);
  });

  it('criar com --confirmar: grava pelas colunas da 0033, deve_trocar_senha, auditado no tenant de referência; a senha confere', async () => {
    const r = sa('criar', { confirmar: true, senha });
    expect(r.saida).toContain('APLICADO');
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: superadmin-criado');
    const [l] = await linhas();
    expect(l).toMatchObject({ email: EMAIL, nome: NOME, deve_trocar_senha: true, ativo: true, falhas_login: 0, bloqueado_ate: null, tenant_id: await referencia() });
    expect(r.saida).toContain(`superadmin: criado (deve trocar a senha no 1º acesso) (id ${l!.id})`);
    const { memoria, passes, paralelismo } = ARGON2_PADRAO;
    expect(l!.senha_hash).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${memoria},t=${passes},p=${paralelismo}\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$`));

    // o caminho do login do portal: a função da 0033 acha pelo e-mail (normalizado) e a API confere o argon2
    const [login] = await um<{ id: string; senha_hash: string; deve_trocar_senha: boolean }>('SELECT * FROM plataforma.superadmin_para_login($1)', [' SuperAdmin@Exemplo.invalid ']);
    expect(login).toMatchObject({ id: l!.id, deve_trocar_senha: true });
    expect(await conferirSenha(senha, login!.senha_hash)).toBe(true);
    expect(await conferirSenha(`${senha}x`, login!.senha_hash)).toBe(false);

    const aud = await auditoria();
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ tenant_id: await referencia(), usuario_id: null, superadmin_id: null, acao: 'plataforma.superadmin.criar', entidade_id: l!.id, antes: null });
    expect(aud[0]!.depois).toEqual({ ativo: true, deve_trocar_senha: true, operador: 'alexandre', motivo: 'operador.sh' });
  });

  it('2ª execução: não duplica, não troca a senha nem o updated_at, não audita e informa "já existia"', async () => {
    const antes = await linhas();
    const totalAud = (await auditoria()).length;
    const r = sa('criar', { confirmar: true, senha: senhaProvisoria(), nome: 'Outro Nome Fictício' });
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: superadmin-existia');
    expect(r.saida).toContain(`superadmin: já existia (senha NÃO alterada) (id ${antes[0]!.id})`);
    expect(await linhas()).toEqual(antes);
    expect(await auditoria()).toHaveLength(totalAud);
    expect(sa('criar').saida).toContain('superadmin: já existia');
  });

  it('desativar: simulação não mexe; com --confirmar revoga as sessões abertas, audita só ids e números; repetir não muda nada', async () => {
    const [l] = await linhas();
    const token = randomBytes(32).toString('base64url');
    await um("SELECT plataforma.superadmin_abrir_sessao($1, $2, now() + interval '1 hour')", [l!.id, sha(token)]);
    expect(await sessaoValida(token)).toBe(true);

    const s = sa('desativar');
    expect(s.status).toBe(0);
    expect(s.estado).toBe('estado: simulacao');
    expect(s.saida).toContain('superadmin: seria desativado; 1 sessão aberta seria revogada');
    expect((await linhas())[0]!.ativo).toBe(true);
    expect(await sessaoValida(token)).toBe(true);

    const r = sa('desativar', { confirmar: true });
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: alterado');
    expect(r.saida).toContain(`superadmin: desativado; 1 sessão aberta revogada (id ${l!.id})`);
    expect((await linhas())[0]!.ativo).toBe(false);
    expect(await um('SELECT 1 FROM plataforma.sessao_superadmin WHERE superadmin_id = $1 AND revogada_em IS NULL', [l!.id])).toHaveLength(0);
    expect(await sessaoValida(token)).toBe(false);
    const ultima = (await auditoria()).at(-1)!;
    expect(ultima).toMatchObject({ acao: 'plataforma.superadmin.desativar', entidade_id: l!.id, superadmin_id: null, antes: { ativo: true } });
    expect(ultima.depois).toEqual({ ativo: false, sessoes_revogadas: 1, operador: 'alexandre', motivo: 'operador.sh' });

    const total = (await auditoria()).length;
    const de_novo = sa('desativar', { confirmar: true });
    expect(de_novo.estado).toBe('estado: sem-mudanca');
    expect(de_novo.saida).toContain('superadmin: já estava desativado');
    expect(await auditoria()).toHaveLength(total);
    // inativo não abre sessão nova
    await expect(um("SELECT plataforma.superadmin_abrir_sessao($1, $2, now() + interval '1 hour')", [l!.id, sha('outro')])).rejects.toThrow();
  });

  it('reativar: volta a ativo (sem mexer na senha), auditado; repetir não muda nada', async () => {
    const [antes] = await linhas();
    const r = sa('reativar', { confirmar: true });
    expect(r.estado).toBe('estado: alterado');
    const [l] = await linhas();
    expect(l).toMatchObject({ ativo: true, senha_hash: antes!.senha_hash });
    expect((await auditoria()).at(-1)).toMatchObject({ acao: 'plataforma.superadmin.reativar', antes: { ativo: false }, depois: { ativo: true, operador: 'alexandre' } });
    const total = (await auditoria()).length;
    expect(sa('reativar', { confirmar: true }).estado).toBe('estado: sem-mudanca');
    expect(await auditoria()).toHaveLength(total);
  });

  it('destravar: zera falhas e bloqueado_ate, auditado; repetir não muda nada', async () => {
    await um("UPDATE plataforma.superadmin SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes' WHERE email = $1", [EMAIL]);
    const s = sa('destravar');
    expect(s.saida).toContain('superadmin: seria destravado (5 falhas, travado)');
    expect((await linhas())[0]!.falhas_login).toBe(5);

    const r = sa('destravar', { confirmar: true });
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: alterado');
    expect(await linhas()).toMatchObject([{ falhas_login: 0, bloqueado_ate: null, ativo: true }]);
    const ultima = (await auditoria()).at(-1)!;
    expect(ultima).toMatchObject({ acao: 'plataforma.superadmin.destravar', antes: { falhas: 5, travado: true } });
    expect(ultima.depois).toEqual({ falhas: 0, travado: false, operador: 'alexandre', motivo: 'operador.sh' });
    const total = (await auditoria()).length;
    expect(sa('destravar', { confirmar: true }).estado).toBe('estado: sem-mudanca');
    expect(await auditoria()).toHaveLength(total);
  });

  /** Sessão do portal aberta pela função da 0033 (que zera falhas e trava ao abrir); devolve o token. */
  const abrirSessao = async (id: string) => {
    const token = randomBytes(32).toString('base64url');
    await um("SELECT plataforma.superadmin_abrir_sessao($1, $2, now() + interval '1 hour')", [id, sha(token)]);
    return token;
  };

  it('redefinir-senha sem --confirmar: simulação READ ONLY; senha sem --confirmar, --confirmar sem senha e senha fraca saem 2; nada gravado', async () => {
    const [l] = await linhas();
    const token = await abrirSessao(l!.id);
    await um("UPDATE plataforma.superadmin SET falhas_login = 3, bloqueado_ate = now() + interval '15 minutes', deve_trocar_senha = false WHERE email = $1", [EMAIL]);
    const antes = await linhas();
    const totalAud = (await auditoria()).length;

    const s = sa('redefinir-senha');
    expect(s.status).toBe(0);
    expect(s.estado).toBe('estado: simulacao');
    expect(s.saida).toContain(`superadmin: teria a senha redefinida (provisória, troca no 1º acesso; 3 falhas, travado); 1 sessão aberta seria revogada (id ${l!.id})`);
    for (const o of [{ senha: senhaRedefinida }, { confirmar: true }, { confirmar: true, senha: 'Ab1!' }, { confirmar: true, senha: 'a'.repeat(16) }]) {
      const r = sa('redefinir-senha', o);
      expect(r.status).toBe(2);
      expect(r.saida).toContain('[superadmin] MACUXIERP_SENHA_INICIAL');
    }
    expect(await linhas()).toEqual(antes);
    expect(await sessaoValida(token)).toBe(true);
    expect(await auditoria()).toHaveLength(totalAud);
  });

  it('redefinir-senha com --confirmar: hash argon2id novo que confere, deve_trocar_senha, falhas e trava zeradas, sessões revogadas, auditado sem dado pessoal', async () => {
    const [antes] = await linhas();
    // a 2ª sessão abre com a conta destravada; depois volta a trava, para conferir que a redefinição a zera
    await um('UPDATE plataforma.superadmin SET falhas_login = 0, bloqueado_ate = NULL WHERE email = $1', [EMAIL]);
    const token = await abrirSessao(antes!.id);
    await um("UPDATE plataforma.superadmin SET falhas_login = 3, bloqueado_ate = now() + interval '15 minutes' WHERE email = $1", [EMAIL]);

    const r = sa('redefinir-senha', { confirmar: true, senha: senhaRedefinida });
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: alterado');
    expect(r.saida).toContain('APLICADO');
    expect(r.saida).toContain(`superadmin: senha redefinida (provisória, troca no 1º acesso; 0 falhas, sem trava); 2 sessões abertas revogadas (id ${antes!.id})`);

    const [l] = await linhas();
    expect(l).toMatchObject({ id: antes!.id, email: EMAIL, nome: NOME, ativo: true, deve_trocar_senha: true, falhas_login: 0, bloqueado_ate: null });
    expect(l!.senha_hash).not.toBe(antes!.senha_hash);
    const { memoria, passes, paralelismo } = ARGON2_PADRAO;
    expect(l!.senha_hash).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${memoria},t=${passes},p=${paralelismo}\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$`));
    // o caminho do login do portal: a senha nova confere, a antiga não
    const [login] = await um<{ id: string; senha_hash: string; deve_trocar_senha: boolean }>('SELECT * FROM plataforma.superadmin_para_login($1)', [EMAIL]);
    expect(login).toMatchObject({ id: l!.id, deve_trocar_senha: true });
    expect(await conferirSenha(senhaRedefinida, login!.senha_hash)).toBe(true);
    expect(await conferirSenha(senha, login!.senha_hash)).toBe(false);

    expect(await um('SELECT 1 FROM plataforma.sessao_superadmin WHERE superadmin_id = $1 AND revogada_em IS NULL', [l!.id])).toHaveLength(0);
    expect(await sessaoValida(token)).toBe(false);

    const ultima = (await auditoria()).at(-1)!;
    expect(ultima).toMatchObject({ tenant_id: await referencia(), usuario_id: null, superadmin_id: null, acao: 'plataforma.superadmin.redefinir_senha', entidade_id: l!.id });
    expect(ultima.antes).toEqual({ deve_trocar_senha: false, falhas: 3, travado: true });
    expect(ultima.depois).toEqual({ deve_trocar_senha: true, falhas: 0, travado: false, sessoes_revogadas: 2, operador: 'alexandre', motivo: 'operador.sh' });
  });

  it('redefinir-senha repetida: cada execução grava uma senha nova e audita de novo (0 sessões abertas)', async () => {
    const [antes] = await linhas();
    const total = (await auditoria()).length;
    const outra = senhaProvisoria();
    const r = sa('redefinir-senha', { confirmar: true, senha: outra });
    expect(r.estado).toBe('estado: alterado');
    expect(r.saida).not.toContain(outra);
    expect(r.saida).toContain('0 sessões abertas revogadas');
    const [l] = await linhas();
    expect(l!.senha_hash).not.toBe(antes!.senha_hash);
    expect(await conferirSenha(outra, l!.senha_hash)).toBe(true);
    const aud = await auditoria();
    expect(aud).toHaveLength(total + 1);
    expect(aud.at(-1)!.depois).toMatchObject({ sessoes_revogadas: 0, deve_trocar_senha: true });
  });

  it('redefinir-senha de superadmin desativado: sai 1 pedindo o --reativar, sem gravar, na simulação e com --confirmar', async () => {
    await um('UPDATE plataforma.superadmin SET ativo = false WHERE email = $1', [EMAIL]);
    const antes = await linhas();
    const total = (await auditoria()).length;
    for (const o of [{}, { confirmar: true, senha: senhaProvisoria() }]) {
      const r = sa('redefinir-senha', o);
      expect(r.status).toBe(1);
      expect(r.saida).toContain('superadmin desativado');
      expect(r.saida).toContain('--reativar');
    }
    expect(await linhas()).toEqual(antes);
    expect(await auditoria()).toHaveLength(total);
    await um('UPDATE plataforma.superadmin SET ativo = true WHERE email = $1', [EMAIL]);
  });

  it('e-mail sem superadmin: desativar e redefinir-senha saem 1 sem gravar e sem ecoar o e-mail', async () => {
    const total = (await auditoria()).length;
    for (const [acao, o] of [
      ['desativar', { confirmar: true }],
      ['redefinir-senha', {}],
      ['redefinir-senha', { confirmar: true, senha: senhaProvisoria() }],
    ] as const) {
      const r = sa(acao, { ...o, email: 'ninguem@exemplo.invalid' });
      expect(r.status).toBe(1);
      expect(r.saida).toContain('superadmin não encontrado');
      expect(r.saida).not.toContain('ninguem');
    }
    expect(await auditoria()).toHaveLength(total);
  });

  it('auditoria inteira: nada de e-mail, nome, senha nem hash', async () => {
    const texto = JSON.stringify(await auditoria()).toLowerCase();
    for (const proibido of [EMAIL, NOME.toLowerCase(), senha.toLowerCase(), senhaRedefinida.toLowerCase(), 'argon2', 'fictício', '@']) expect(texto).not.toContain(proibido);
  });

  it('listar (T-0103): e-mail mascarado pela 0035, nenhum superadmin alterado, auditado só com operador e contagem; o excluído fica de fora', async () => {
    await b.admin.query(
      `INSERT INTO plataforma.superadmin (tenant_id, email, nome, senha_hash, ativo, deleted_at)
       VALUES (plataforma.tenant_referencia(), 'excluido@exemplo.invalid', 'Excluído Fictício', '$argon2id$v=19$m=1,t=1,p=1$a$b', true, now())`,
    );
    const total = (await auditoria()).length;
    const antes = await linhas();
    // o formato da linha e o "estado: lista" ficam no scripts/deploy/superadmin-listar.test.mjs; aqui, o banco de verdade
    const r = sa('listar', { email: '' });
    expect(r.status).toBe(0);
    expect(r.saida).toContain('1 superadmin(s)');
    expect(r.saida).toContain(`id: ${antes[0]!.id} · e-mail (mascarado): su****@exemplo.invalid`);
    expect(r.saida.toLowerCase()).not.toContain('excluido');
    const depois = await auditoria();
    expect(depois).toHaveLength(total + 1);
    expect(depois.at(-1)).toMatchObject({
      tenant_id: await referencia(),
      usuario_id: null,
      superadmin_id: null,
      acao: 'plataforma.superadmin.listar',
      entidade_id: null,
      antes: null,
      depois: { quantidade: 1, operador: 'alexandre', motivo: 'operador.sh' },
    });
    expect(JSON.stringify(depois.at(-1))).not.toContain('@');
    expect(await linhas()).toEqual(antes);
  });
});
