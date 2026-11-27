/**
 * T-0050 (E6.4): `operador.sh criar-superadmin` e `operador.sh superadmin --desativar|--reativar|--destravar` (ADR 0012
 * §5) de ponta a ponta: o operador.sh DE VERDADE, com um `docker` falso no PATH que roda o superadmin.mjs (lido do stdin,
 * como no contêiner `psql`) no Node da sessão contra o PostgreSQL efêmero, repassando só as variáveis pedidas com -e/--env
 * e as PG* do admin (o que o compose faria). Um `psql` de passagem guarda o SQL, o argv e o ambiente que o banco recebeu
 * (o teste confere só que não levam e-mail nem senha, sem fixar o argv nem os textos da saída). Depois, a API real do
 * portal (`appPgDeTeste`) com a senha que o operador.sh imprimiu.
 *
 * O que já está coberto e NÃO se repete aqui: o superadmin.mjs sozinho no PG (apps/api/src/operador-superadmin.db.test.ts:
 * validação de argumentos, colunas, auditoria de cada ação) e o operador.sh com um docker que só registra
 * (packages/config/deploy-operador.test.ts). Aqui entram a costura entre os dois e o login real do portal:
 * - sem --confirmar: a transação é `BEGIN READ ONLY`, nada é gravado nem auditado e nenhuma senha é impressa;
 * - com --confirmar: a senha impressa entra no portal, com `deve_trocar_senha` (só eu/senha/sair até trocar);
 * - repetir não duplica nem troca a senha (senha_hash igual) nem imprime senha nova;
 * - desativar derruba a sessão aberta e o login; reativar devolve o login; destravar zera falhas e trava da §6;
 * - auditoria no tenant de referência e nada de e-mail na auditoria, na saída do operador.sh nem no log pino da API.
 * Precisa do Node >= 24.7 (crypto.argon2, como a imagem da API). Dados fictícios (exemplo.invalid).
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TAMANHO_SENHA_TEMPORARIA } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, destinoDeLogs } from '../../../apps/api/src/apoio-teste';
import { envPsqlAdmin } from '../../../apps/api/src/apoio-operador-teste';
import { ARGON2_PADRAO, conferirSenha } from '../../../apps/api/src/auth/senha';
import { criarPsqlPassagem, rodarOperador, type VmOperador } from '../../apoio/operador-falso';
import { atalhosPortal, type AppPortal } from '../../apoio/portal-pg';
import { esperarContaBloqueada, esperarRecusaUnica } from '../../apoio/portal-pg-expect';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OPERADOR_SH = resolve(RAIZ, 'scripts', 'deploy', 'producao', 'operador.sh');
const EMAIL = 'sa-e6-operador@exemplo.invalid';
const NOME = 'Pessoa Superadmin Operador E6';
const SENHA_NOVA = 'senha-nova-do-superadmin-e6';
const SENHA_ERRADA = 'senha-errada-e6-operador';
const TEM_ARGON2_NATIVO = Number(process.versions.node.split('.')[0]) * 100 + Number(process.versions.node.split('.')[1]) >= 2407;

interface Linha {
  id: string;
  senha_hash: string;
  deve_trocar_senha: boolean;
  ativo: boolean;
  falhas_login: number;
  bloqueado_ate: Date | null;
  tenant_id: string;
}

describe.skipIf(!PG_DISPONIVEL)('operador.sh criar-superadmin e superadmin, ponta a ponta com a API do portal (T-0050 E6.4, ADR 0012 §5)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  const logs: string[] = [];
  const saidas: string[] = [];
  let senhaImpressa = '';
  let sessaoAberta = '';

  // VM falsa (tests/apoio/operador-falso.ts) e psql de passagem (guarda SQL, argv e ambiente).
  let pasta = '';
  let vm: VmOperador;

  beforeAll(async () => {
    if (!TEM_ARGON2_NATIVO) throw new Error(`Node ${process.versions.node} sem crypto.argon2: rode com o Node >= 24.7 (engines da raiz)`);
    pasta = mkdtempSync(join(tmpdir(), 'macuxierp-e6-operador-'));
    vm = criarPsqlPassagem(pasta, { separador: '-- fim --' });

    b = await criarBancoEfemero();
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', logger: { level: 'info', stream: destinoDeLogs(logs) } }));
    p = atalhosPortal(app);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  /** Roda o operador.sh como na VM; devolve status, saída e o SQL que chegou ao banco nesta chamada. */
  function operador(args: string[]) {
    const r = rodarOperador(vm, OPERADOR_SH, args, envPsqlAdmin(b.nome));
    saidas.push(r.saida);
    // regra 8: o e-mail (em qualquer caixa) e o nome nunca saem no terminal do operador
    expect(r.saida.toLowerCase()).not.toContain(EMAIL.toLowerCase());
    expect(r.saida).not.toContain(NOME);
    return r;
  }
  const criar = (confirmar: boolean) =>
    operador(['criar-superadmin', '--email', EMAIL, '--nome', NOME, '--operador', 'alexandre', ...(confirmar ? ['--confirmar'] : [])]);
  const acao = (a: 'desativar' | 'reativar' | 'destravar', confirmar = true) =>
    operador(['superadmin', '--email', EMAIL, `--${a}`, '--operador', 'alexandre', ...(confirmar ? ['--confirmar'] : [])]);

  const um = async <T>(sql: string, v: unknown[] = []) => (await b.admin.query(sql, v)).rows as T[];
  const linhas = () => um<Linha>('SELECT id, senha_hash, deve_trocar_senha, ativo, falhas_login, bloqueado_ate, tenant_id FROM plataforma.superadmin WHERE email = $1', [EMAIL]);
  type Auditoria = { tenant_id: string; acao: string; antes: unknown; depois: unknown };
  /** Só a do operador (o `depois` traz o operador); as falhas de login da API (`plataforma.superadmin.falha`) ficam fora. */
  const auditoria = () =>
    um<Auditoria>("SELECT tenant_id, acao, antes, depois FROM plataforma.auditoria WHERE entidade = 'superadmin' AND depois ? 'operador' ORDER BY ocorrido_em, created_at");
  const auditoriaToda = () => um<Auditoria>("SELECT tenant_id, acao, antes, depois FROM plataforma.auditoria WHERE entidade = 'superadmin'");
  const referencia = async () => (await um<{ id: string }>('SELECT plataforma.tenant_referencia() AS id'))[0]!.id;
  /** A senha impressa: o token da saída que confere com o hash gravado (sem depender do texto em volta); '' se nenhum. */
  const senhaNaSaida = async (saida: string, hash: string) => {
    for (const t of new Set(saida.split(/\s+/).filter((x) => x.length === TAMANHO_SENHA_TEMPORARIA))) if (await conferirSenha(t, hash)) return t;
    return '';
  };
  /**
   * Regra 8: o argv do psql não leva e-mail nem senha; o ambiente não leva a senha (só o hash). O e-mail vai ao psql pelo
   * ambiente de propósito (`\getenv` do superadmin.mjs, nunca colado no SQL nem no argv).
   */
  const psqlSemSegredo = ({ argv, ambiente }: { argv: string; ambiente: string }, senha = '') => {
    expect(ambiente, 'o psql de passagem não foi chamado').not.toBe('');
    expect(argv).not.toBe('');
    expect(argv.toLowerCase()).not.toContain(EMAIL.toLowerCase());
    expect(argv).not.toContain('@');
    if (senha) for (const x of [argv, ambiente]) expect(x).not.toContain(senha);
  };
  const recusaUnica = async (senha: string) => esperarRecusaUnica(await p.entrar(EMAIL, senha));

  /** RN-CORE-15 (T-0111): a conta travada recebe o 423, mesmo com a senha certa. */
  const bloqueada = async (senha: string) => esperarContaBloqueada(await p.entrar(EMAIL, senha));

  it('criar-superadmin sem --confirmar: o banco recebe BEGIN READ ONLY; nada gravado nem auditado; nenhuma senha impressa', async () => {
    const r = criar(false);
    expect(r.status).toBe(0);
    expect(r.sql).toMatch(/^BEGIN READ ONLY;$/m);
    expect(r.sql).not.toMatch(/^BEGIN;$/m);
    psqlSemSegredo(r.psql);
    expect(await linhas()).toHaveLength(0);
    expect(await auditoria()).toHaveLength(0);
  });

  it('criar-superadmin --confirmar: deve_trocar_senha, argon2id, auditado no tenant de referência; a senha impressa entra no portal', async () => {
    const r = criar(true);
    expect(r.status).toBe(0);
    expect(r.sql).toMatch(/^BEGIN;$/m);
    expect(r.sql).not.toMatch(/^BEGIN READ ONLY;$/m);
    const [l, ...resto] = await linhas();
    expect(resto).toHaveLength(0);
    senhaImpressa = await senhaNaSaida(r.saida, l!.senha_hash);
    expect(senhaImpressa, 'operador.sh não imprimiu a senha provisória').not.toBe('');
    // o psql não recebe a senha (o superadmin.mjs a troca pelo hash antes); argv sem e-mail nem senha; ambiente sem senha
    expect(r.sql).not.toContain(senhaImpressa);
    psqlSemSegredo(r.psql, senhaImpressa);
    expect(l).toMatchObject({ deve_trocar_senha: true, ativo: true, falhas_login: 0, bloqueado_ate: null, tenant_id: await referencia() });
    const { memoria, passes, paralelismo } = ARGON2_PADRAO;
    expect(l!.senha_hash).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${memoria},t=${passes},p=${paralelismo}\\$`));
    expect(await conferirSenha(senhaImpressa, l!.senha_hash)).toBe(true);
    const aud = await auditoria();
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ tenant_id: await referencia(), acao: 'plataforma.superadmin.criar' });

    // a API do portal: entra com a senha impressa, mas só eu/senha/sair até trocar (ADR 0012 §5)
    const login = await p.entrar(EMAIL, senhaImpressa);
    expect(login.statusCode).toBe(200);
    const token = p.cookieDe(login);
    const eu = await p.pedir('GET', '/v1/plataforma/auth/eu', { token });
    expect(eu.json<{ deve_trocar_senha: boolean }>().deve_trocar_senha).toBe(true);
    expect((await p.pedir('GET', '/v1/plataforma/empresas', { token })).json<{ codigo: string }>().codigo).toBe('TROCAR_SENHA');
    const troca = await p.pedir('POST', '/v1/plataforma/auth/senha', { token, corpo: { senha_atual: senhaImpressa, senha_nova: SENHA_NOVA } });
    expect(troca.statusCode).toBeLessThan(300);
    expect((await linhas())[0]!.deve_trocar_senha).toBe(false);
    sessaoAberta = p.cookieDe(await p.entrar(EMAIL, SENHA_NOVA));
    expect((await p.pedir('GET', '/v1/plataforma/empresas', { token: sessaoAberta })).statusCode).toBe(200);
  });

  it('repetir criar-superadmin --confirmar: não duplica, não troca a senha (senha_hash igual), não audita e não imprime senha', async () => {
    const antes = await linhas();
    const totalAud = (await auditoria()).length;
    const r = criar(true);
    expect(r.status).toBe(0);
    psqlSemSegredo(r.psql);
    const depois = await linhas();
    expect(depois).toHaveLength(1);
    expect(depois[0]!.senha_hash).toBe(antes[0]!.senha_hash);
    expect(depois).toEqual(antes);
    expect(await senhaNaSaida(r.saida, antes[0]!.senha_hash)).toBe('');
    expect(r.saida).not.toContain(senhaImpressa);
    expect(await auditoria()).toHaveLength(totalAud);
    // a senha trocada no portal segue valendo; a impressa na 1ª vez, não
    expect((await p.entrar(EMAIL, SENHA_NOVA)).statusCode).toBe(200);
    await recusaUnica(senhaImpressa);
  });

  it('superadmin --desativar: a simulação (READ ONLY) não mexe; com --confirmar derruba a sessão aberta e o login', async () => {
    const sim = acao('desativar', false);
    expect(sim.status).toBe(0);
    expect(sim.sql).toMatch(/^BEGIN READ ONLY;$/m);
    expect((await linhas())[0]!.ativo).toBe(true);
    expect((await p.pedir('GET', '/v1/plataforma/auth/eu', { token: sessaoAberta })).statusCode).toBe(200);

    const r = acao('desativar');
    expect(r.status).toBe(0);
    psqlSemSegredo(r.psql);
    expect((await linhas())[0]!.ativo).toBe(false);
    expect((await p.pedir('GET', '/v1/plataforma/auth/eu', { token: sessaoAberta })).statusCode).toBe(401);
    expect((await p.pedir('GET', '/v1/plataforma/empresas', { token: sessaoAberta })).statusCode).toBe(401);
    await recusaUnica(SENHA_NOVA);
    expect((await auditoria()).at(-1)).toMatchObject({ tenant_id: await referencia(), acao: 'plataforma.superadmin.desativar' });
    // repetir: nada a fazer, nada auditado
    const total = (await auditoria()).length;
    const antesRepetir = await linhas();
    expect(acao('desativar').status).toBe(0);
    expect(await linhas()).toEqual(antesRepetir);
    expect(await auditoria()).toHaveLength(total);
  });

  it('superadmin --reativar: o login volta com a mesma senha (o operador nunca gera nem troca senha)', async () => {
    const hash = (await linhas())[0]!.senha_hash;
    const r = acao('reativar');
    expect(r.status).toBe(0);
    psqlSemSegredo(r.psql);
    expect(await senhaNaSaida(r.saida, hash)).toBe('');
    expect((await linhas())[0]).toMatchObject({ ativo: true, senha_hash: hash });
    expect((await p.entrar(EMAIL, SENHA_NOVA)).statusCode).toBe(200);
  });

  it('superadmin --destravar: a conta travada pela §6 (5 falhas) volta a entrar; falhas_login 0 e bloqueado_ate NULL', async () => {
    for (let i = 0; i < 5; i++) await recusaUnica(`${SENHA_ERRADA}-${i}`);
    const travada = (await linhas())[0]!;
    expect(travada.falhas_login).toBe(5);
    expect(travada.bloqueado_ate).not.toBeNull();
    await bloqueada(SENHA_NOVA);

    const sim = acao('destravar', false);
    expect(sim.sql).toMatch(/^BEGIN READ ONLY;$/m);
    expect((await linhas())[0]!.falhas_login).toBe(5);

    const r = acao('destravar');
    expect(r.status).toBe(0);
    psqlSemSegredo(r.psql);
    expect((await linhas())[0]).toMatchObject({ falhas_login: 0, bloqueado_ate: null, ativo: true });
    expect((await p.entrar(EMAIL, SENHA_NOVA)).statusCode).toBe(200);
    expect((await auditoria()).at(-1)).toMatchObject({ acao: 'plataforma.superadmin.destravar' });
  });

  it('regra 8: auditoria toda no tenant de referência e sem e-mail, nome, senha nem hash; nem e-mail nem senha no log pino nem na saída', async () => {
    const aud = await auditoria();
    expect(aud.map((a) => a.acao)).toEqual([
      'plataforma.superadmin.criar',
      'plataforma.superadmin.desativar',
      'plataforma.superadmin.reativar',
      'plataforma.superadmin.destravar',
    ]);
    const ref = await referencia();
    expect(aud.every((a) => a.tenant_id === ref)).toBe(true);
    const hash = (await linhas())[0]!.senha_hash;
    const textoAud = JSON.stringify((await auditoriaToda()).map((a) => [a.antes, a.depois]));
    for (const x of [EMAIL, NOME, senhaImpressa, SENHA_NOVA, hash, '@', '$argon2id$']) expect(textoAud).not.toContain(x);
    const log = logs.join('\n');
    expect(log).toContain('/v1/plataforma/auth/entrar');
    for (const x of [EMAIL, 'sa-e6-operador', senhaImpressa, SENHA_NOVA, SENHA_ERRADA]) expect(log).not.toContain(x);
    // a senha impressa aparece numa saída só: a da criação
    expect(saidas.filter((s) => s.includes(senhaImpressa))).toHaveLength(1);
  });
});
