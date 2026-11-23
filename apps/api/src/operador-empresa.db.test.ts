/**
 * Primeiro acesso em produção (T-0024): o scripts/deploy/producao/empresa.mjs DE VERDADE (o mesmo que o operador.sh manda
 * ao contêiner `psql`) contra o PostgreSQL migrado, com um `psql` real e as variáveis PG* do admin local, e depois o
 * login pela rota real da API (`conferirSenha` de auth/senha.ts) com a senha provisória. O turbo.json põe
 * scripts/deploy/producao/** e scripts/plataforma/** nos inputs desta tarefa (ADR 0014, R2). Dados fictícios (admin@exemplo.invalid).
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULOS } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPgDeTeste } from './apoio-teste';
import { ARGON2_PADRAO, conferirSenha } from './auth/senha';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EMPRESA_MJS = resolve(RAIZ, 'scripts', 'deploy', 'producao', 'empresa.mjs');
const FONTE_EMPRESA = readFileSync(EMPRESA_MJS, 'utf8');
/** O turbo.json põe scripts/plataforma/** nos inputs do api#test (ADR 0014, R2). */
const FONTE_COMUM = readFileSync(resolve(RAIZ, 'scripts', 'plataforma', 'comum.mjs'), 'utf8');
const EMAIL = 'admin@exemplo.invalid';
const ADMIN_NOME = 'Pessoa Fictícia';
const EMPRESA_NOME = 'Empresa Fictícia Ltda';
/** Nome legal de MEI (pode ser dado pessoal): acento e pontuação (ponto, vírgula, hífen, barra). Fictício. */
const NOME_MEI = 'José Ávila Comércio, Ind. e Serv. - ME/EPP.';

/** Lê a lista literal `const <nome> = [...]` do texto do empresa.mjs (molde do listaDoSdk de scripts/plataforma/licenca.test.mjs). */
function listaDoEmpresa(nome: string): string[] {
  const m = new RegExp(`const ${nome}\\s*=\\s*\\[([^\\]]*)\\]`).exec(FONTE_EMPRESA);
  if (!m) throw new Error(`${nome} não encontrado em empresa.mjs`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}
/** `.source` da regex literal `const <nome> = /.../;` de um fonte .mjs. */
function padrao(fonte: string, nome: string): string {
  const m = new RegExp(`const ${nome}\\s*=\\s*/(.+?)/[a-z]*;`).exec(fonte);
  if (!m) throw new Error(`${nome} não encontrado`);
  return new RegExp(m[1]!).source;
}
const LIGADAS = listaDoEmpresa('MODULOS_LIGAR').sort();
/** Alfabeto da senha provisória da API lido do fonte (as 4 constantes de modules/core/domain/usuarios.ts): a regra de
 *  fronteiras (app-importa-interno-de-modulo) não deixa apps/ importar `@macuxierp/core/domain`. */
const FONTE_USUARIOS = readFileSync(resolve(RAIZ, 'modules', 'core', 'domain', 'usuarios.ts'), 'utf8');
const ALFABETO = ['MAIUSCULAS', 'MINUSCULAS', 'DIGITOS', 'SIMBOLOS']
  .map((nome) => {
    const m = new RegExp(`const ${nome} = '([^']+)';`).exec(FONTE_USUARIOS);
    if (!m) throw new Error(`${nome} não encontrado em usuarios.ts`);
    return m[1]!;
  })
  .join('');
if (ALFABETO.length !== 64) throw new Error('alfabeto da API deixou de ter 64 símbolos: revise senhaProvisoria()');

/** 16 caracteres do alfabeto da API (64 símbolos: 1 byte = 1 caractere sem viés), com maiúscula, minúscula e dígito. */
function senhaProvisoria(): string {
  for (;;) {
    const s = [...randomBytes(16)].map((b) => ALFABETO[b % 64]).join('');
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) return s;
  }
}

describe('empresa.mjs: listas e padrões presos às fontes', () => {
  it('MODULOS_LIGAR ∪ MODULOS_INFORMAR = MODULOS do platform-sdk', () => {
    expect([...listaDoEmpresa('MODULOS_LIGAR'), ...listaDoEmpresa('MODULOS_INFORMAR')].sort()).toEqual([...MODULOS].sort());
  });
  it('PADRAO_SLUG e PADRAO_OPERADOR iguais aos de scripts/plataforma/comum.mjs', () => {
    for (const nome of ['PADRAO_SLUG', 'PADRAO_OPERADOR']) expect(padrao(FONTE_EMPRESA, nome)).toBe(padrao(FONTE_COMUM, nome));
  });
});

describe.skipIf(!PG_DISPONIVEL)('empresa.mjs (operador.sh criar-empresa) no PostgreSQL migrado', () => {
  let b: BancoEfemero;
  let app: FastifyInstance;
  const senha = senhaProvisoria();
  const env = process.env;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    ({ app } = await appPgDeTeste({ b }));
  });
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  /** Como no contêiner: PG* do admin, nome da empresa, e-mail, nome e senha só no ambiente; o argv leva só slug e operador. */
  function empresa(args: string[], o: { senha?: string; email?: string; slug?: string; nome?: string } = {}) {
    const nome = o.nome ?? EMPRESA_NOME;
    const r = spawnSync(process.execPath, [EMPRESA_MJS, '--slug', o.slug ?? 'thathyany', '--operador', 'alexandre', ...args], {
      env: {
        PATH: env.PATH,
        PGHOST: env.MACUXI_PG_HOST ?? '127.0.0.1',
        PGPORT: env.MACUXI_PG_PORTA ?? '5432',
        PGUSER: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
        PGDATABASE: b.nome,
        PGCONNECT_TIMEOUT: '5',
        ...(env.MACUXI_PG_ADMIN_SENHA === undefined ? {} : { PGPASSWORD: env.MACUXI_PG_ADMIN_SENHA }),
        ...(env.MACUXI_PSQL ? { MACUXIERP_PSQL: env.MACUXI_PSQL } : {}),
        MACUXIERP_EMPRESA_NOME: nome,
        MACUXIERP_ADMIN_EMAIL: o.email ?? EMAIL,
        MACUXIERP_ADMIN_NOME: ADMIN_NOME,
        ...(o.senha ? { MACUXIERP_SENHA_INICIAL: o.senha } : {}),
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const saida = `${r.stdout}${r.stderr}`;
    // nunca nome da empresa, e-mail, nome da pessoa, senha nem hash na saída do contêiner
    for (const proibido of [nome, EMAIL, ADMIN_NOME, senha, '$argon2id$']) expect(saida).not.toContain(proibido);
    return { status: r.status, saida, estado: r.stdout.trim().split('\n').at(-1) };
  }

  const um = async <T>(sql: string, p: unknown[] = []) => (await b.admin.query(sql, p)).rows as T[];
  const tenantId = async (slug = 'thathyany') => (await um<{ id: string }>('SELECT id FROM plataforma.tenant WHERE slug = $1', [slug]))[0]?.id;
  const licencas = async (t: string) =>
    um<{ modulo: string; ativo: boolean }>('SELECT modulo, ativo FROM plataforma.tenant_modulo WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY modulo', [t]);
  const auditoria = async (t: string) => um<{ acao: string; usuario_id: string | null; depois: Record<string, unknown> }>('SELECT acao, usuario_id, depois FROM plataforma.auditoria WHERE tenant_id = $1 ORDER BY acao, entidade_id', [t]);
  const entrar = (s: string) => app.inject({ method: 'POST', url: '/v1/auth/login', payload: { empresa: 'thathyany', email: 'ADMIN@exemplo.invalid', senha: s } });

  it('sem --confirmar: simulação READ ONLY, nada gravado', () => {
    const r = empresa([]);
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: simulacao');
    expect(r.saida).toContain('empresa thathyany: seria criada');
    expect(r.saida).toContain('administrador: seria criado');
    for (const m of LIGADAS) expect(r.saida).toContain(`licença ${m}: seria ligada`);
    return expect(tenantId()).resolves.toBeUndefined();
  });

  it('senha sem --confirmar é recusada (saída 2)', () => {
    expect(empresa([], { senha }).status).toBe(2);
  });

  it('com --confirmar: cria empresa, administrador e as quatro licenças, auditado; o login real entra com a senha', async () => {
    const r = empresa(['--confirmar'], { senha });
    expect(r.saida).toContain('APLICADO');
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: usuario-criado');
    const t = (await tenantId())!;
    expect(r.saida).toContain(`empresa thathyany: criada (id ${t})`);

    expect(await licencas(t)).toEqual(LIGADAS.map((modulo) => ({ modulo, ativo: true })));
    expect(r.saida).toContain('licença faturamento: sem licença (não mexida)');
    expect(r.saida).toContain('licença fiscal: sem licença (não mexida)');

    const [u] = await um<{ email: string; nome: string; perfil: string; ativo: boolean; senha_hash: string }>(
      'SELECT email, nome, perfil, ativo, senha_hash FROM plataforma.usuario WHERE tenant_id = $1',
      [t],
    );
    expect(u).toMatchObject({ email: EMAIL, nome: ADMIN_NOME, perfil: 'administrador', ativo: true });
    // mesmo formato e parâmetros da API (ARGON2_PADRAO: 19 MiB, t=2, p=1) e a verificação real confere
    const { memoria, passes, paralelismo } = ARGON2_PADRAO;
    expect(u!.senha_hash).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${memoria},t=${passes},p=${paralelismo}\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$`));
    expect(await conferirSenha(senha, u!.senha_hash)).toBe(true);
    expect(await conferirSenha(`${senha}x`, u!.senha_hash)).toBe(false);

    const login = await entrar(senha);
    expect(login.statusCode).toBe(200);
    const token = login.json<{ token_acesso: string }>().token_acesso;
    const eu = await app.inject({ url: '/v1/auth/eu', headers: { authorization: `Bearer ${token}` } });
    expect(eu.json<{ usuario: { perfil: string; nome: string } }>().usuario).toMatchObject({ perfil: 'administrador', nome: ADMIN_NOME });

    const aud = await auditoria(t);
    expect(aud.map((a) => a.acao)).toEqual(['plataforma.empresa.criar', ...Array(4).fill('plataforma.licenca.alterar'), 'plataforma.usuario.criar']);
    for (const a of aud) {
      expect(a.usuario_id).toBeNull();
      expect(a.depois).toMatchObject({ operador: 'alexandre', motivo: 'primeiro acesso' });
      expect(JSON.stringify(a.depois)).not.toContain(EMAIL);
      expect(JSON.stringify(a.depois)).not.toContain(EMPRESA_NOME);
      expect(JSON.stringify(a.depois)).not.toContain('argon2');
    }
  });

  it('2ª execução: não duplica, não troca o senha_hash e informa "já existia"', async () => {
    const t = (await tenantId())!;
    const [antes] = await um<{ senha_hash: string; updated_at: Date }>('SELECT senha_hash, updated_at FROM plataforma.usuario WHERE tenant_id = $1', [t]);
    const totalAud = (await auditoria(t)).length;

    const r = empresa(['--confirmar'], { senha: senhaProvisoria() });
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: usuario-existia');
    expect(r.saida).toContain(`empresa thathyany: já existia (id ${t})`);
    expect(r.saida).toContain('administrador: já existia (senha NÃO alterada)');
    for (const m of LIGADAS) expect(r.saida).toContain(`licença ${m}: já ativa`);

    expect(await um('SELECT 1 FROM plataforma.tenant WHERE slug = $1', ['thathyany'])).toHaveLength(1);
    const usuarios = await um<{ senha_hash: string; updated_at: Date }>('SELECT senha_hash, updated_at FROM plataforma.usuario WHERE tenant_id = $1', [t]);
    expect(usuarios).toEqual([antes]);
    expect(await licencas(t)).toEqual(LIGADAS.map((modulo) => ({ modulo, ativo: true })));
    expect(await auditoria(t)).toHaveLength(totalAud);
    expect((await entrar(senha)).statusCode).toBe(200);
  });

  it('licença desligada é religada (auditada); faturamento desligado continua desligado', async () => {
    const t = (await tenantId())!;
    await b.admin.query("UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = $1 AND modulo = 'pedido'", [t]);
    await b.admin.query("INSERT INTO plataforma.tenant_modulo (tenant_id, modulo, ativo) VALUES ($1, 'faturamento', false)", [t]);

    const r = empresa(['--confirmar'], { senha: senhaProvisoria() });
    expect(r.status).toBe(0);
    expect(r.saida).toContain('licença pedido: ligada');
    expect(r.saida).toContain('licença faturamento: desligada (não mexida)');
    expect(await licencas(t)).toEqual([
      { modulo: 'cadastros', ativo: true },
      { modulo: 'core', ativo: true },
      { modulo: 'faturamento', ativo: false },
      { modulo: 'integracao-fdv', ativo: true },
      { modulo: 'pedido', ativo: true },
    ]);
    const [ultima] = await um<{ antes: unknown; depois: unknown }>(
      "SELECT antes, depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'plataforma.licenca.alterar' ORDER BY ocorrido_em DESC, created_at DESC LIMIT 1",
      [t],
    );
    expect(ultima).toMatchObject({ antes: { ativo: false }, depois: { ativo: true, modulo: 'pedido', operador: 'alexandre' } });
  });

  it('empresa suspensa: recusa sem gravar nada (saída 1)', async () => {
    const r1 = empresa(['--confirmar'], { senha: senhaProvisoria(), slug: 'outra-loja' });
    expect(r1.status).toBe(0);
    const t = (await tenantId('outra-loja'))!;
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [t]);
    const total = (await auditoria(t)).length;
    const r = empresa(['--confirmar'], { senha: senhaProvisoria(), slug: 'outra-loja', email: 'outro@exemplo.invalid' });
    expect(r.status).toBe(1);
    expect(r.saida).toContain('não está ativa');
    expect(r.saida).not.toContain('outro@exemplo.invalid');
    expect(await um('SELECT 1 FROM plataforma.usuario WHERE tenant_id = $1', [t])).toHaveLength(1);
    expect(await auditoria(t)).toHaveLength(total);
  });

  it('nome legal de MEI (acento e pontuação): gravado em plataforma.tenant.nome; fora da saída e da auditoria', async () => {
    const r = empresa(['--confirmar'], { senha: senhaProvisoria(), slug: 'jose-avila', nome: NOME_MEI });
    expect(r.status).toBe(0);
    expect(r.estado).toBe('estado: usuario-criado');
    expect(r.saida).not.toMatch(/José|Ávila|ME\/EPP/); // nem pedaço do nome
    const t = (await tenantId('jose-avila'))!;
    expect(await um('SELECT nome FROM plataforma.tenant WHERE id = $1', [t])).toEqual([{ nome: NOME_MEI }]);
    const aud = await um<{ acao: string; antes: unknown; depois: unknown }>('SELECT acao, antes, depois FROM plataforma.auditoria WHERE tenant_id = $1', [t]);
    expect(aud).toHaveLength(6);
    for (const a of aud) expect(JSON.stringify(a)).not.toMatch(/José|Ávila|ME\/EPP/);
    const criar = aud.find((a) => a.acao === 'plataforma.empresa.criar')!;
    expect(Object.keys(criar.depois as object).sort()).toEqual(['motivo', 'operador', 'situacao', 'slug']);
    expect(criar.depois).toMatchObject({ slug: 'jose-avila', situacao: 'ativo' });
  });

  it('--nome no argv é recusado (o nome só vai pelo ambiente)', async () => {
    const r = empresa(['--nome', 'Outra Fictícia'], { slug: 'argv-loja' });
    expect(r.status).toBe(2);
    expect(r.saida).toContain('opção desconhecida: --nome');
    expect(await tenantId('argv-loja')).toBeUndefined();
  });

  it.each([
    ['e-mail fora do formato', { email: 'sem-arroba' }],
    ['senha curta', { senha: 'curta' }],
    ['nome da empresa com 121 caracteres', { nome: 'Á'.repeat(121) }],
    ['nome da empresa com quebra de linha', { nome: 'Empresa\nFictícia' }],
  ])('%s: saída 2, nada gravado', async (_n, o) => {
    const r = empresa(['--confirmar'], { slug: 'nova-loja', senha: senhaProvisoria(), ...o });
    expect(r.status).toBe(2);
    expect(await tenantId('nova-loja')).toBeUndefined();
  });
});
