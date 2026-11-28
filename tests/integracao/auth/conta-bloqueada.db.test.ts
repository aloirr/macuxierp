/**
 * T-0111 (RN-CORE-15, RN-CORE-13) ponta a ponta na API de produção (`appPgDeTeste`, módulos de produção) sobre o PostgreSQL
 * efêmero, com o e-mail em memória (a única dublê: o SMTP) e o log do pino capturado:
 * - B-1: depois de `maxFalhas` (5) senhas erradas, o login responde 423 `ContaBloqueadaResposta`, inclusive com a senha certa;
 *   e-mail que não existe recebe o MESMO status e o MESMO corpo (trava por e-mail desde a ADR 0021 §4, R-20261126-175321);
 * - B-2: o limite por IP é outro sinal: 429 `MUITAS_TENTATIVAS`, nunca 423, e vale para qualquer e-mail;
 * - B-3: o "Esqueci a senha" da conta bloqueada manda a temporária num e-mail multipart (text/plain e text/html) com o
 *   e-mail digitado e sem o código da empresa (ADR 0021, T-0133); o log desse envio não leva a senha nem o e-mail;
 * - B-4: entrar com a temporária desbloqueia (`desbloqueou: true`, `bloqueado_ate` nulo, falhas zeradas) e pede a troca.
 * NÃO se repete: a regra pura (modules/core/domain/conta-bloqueada.test.ts), o texto e o HTML do e-mail (platform-sdk
 * esqueci-senha.test.ts), o log do esqueci da conta não travada
 * (esqueci-log.db.test.ts) e a trava do superadmin (login-trava.db.test.ts).
 * Dados fictícios (domínios .invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContaBloqueadaResposta } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { RepositorioCoreSql } from '../../../modules/core/api/index';
import { appPgDeTeste, destinoDeLogs, EnvioEmailMemoria, inserirAdministradorDeTeste, SENHA_DE_TESTE } from '../../../apps/api/src/apoio-teste';
import { type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';

const SLUG = 'tq0111';
const DOMINIO = 'loja-t0111.invalid';
const EMAIL_BLOQ = `iracema.bloqueio@${DOMINIO}`;
const EMAIL_NINGUEM = `ninguem.t0111@${DOMINIO}`;
let seq = 0;
/** Um e-mail inexistente por tentativa: a trava da memória (5 por e-mail) não entra no teste do limite por IP. */
const ninguemNovo = () => `ninguem.ip.${seq++}@${DOMINIO}`;
const EMAIL_IP = `potira.ip@${DOMINIO}`;
const SENHA_ERRADA = 'senha-errada-t0111!';
const MAX_FALHAS = 5;

describe.skipIf(!PG_DISPONIVEL)('T-0111: conta bloqueada (423), limite por IP (429) e desbloqueio pela senha temporária', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  const logs: string[] = [];
  const envio = new EnvioEmailMemoria();
  let ip = 1;
  const novoIp = () => `10.111.0.${ip++}`;
  let usuarioBloq = '';
  let temporaria = '';

  const entrar = (email: string, senha: string, remoteAddress = novoIp()): Promise<RespostaPortal> =>
    app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress, payload: { email, senha } });
  const esqueci = (email: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/esqueci', headers: { 'cf-connecting-ip': novoIp() }, payload: { email } });
  const estado = async (id: string) =>
    (await b.admin.query<{ falhas_login: number; bloqueado: boolean }>('SELECT falhas_login, bloqueado_ate IS NOT NULL AND bloqueado_ate > now() AS bloqueado FROM plataforma.usuario WHERE id = $1', [id])).rows[0]!;
  const errarAteBloquear = async (email: string) => {
    for (let i = 0; i < MAX_FALHAS; i++) await entrar(email, SENHA_ERRADA);
  };
  const bloqueio423 = (r: RespostaPortal) => {
    expect(r.statusCode, r.body).toBe(423);
    expect(ContaBloqueadaResposta.parse(r.json())).toEqual(r.json());
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const t = await criarTenant(b.admin, SLUG, ['cadastros']);
    usuarioBloq = randomUUID();
    await inserirAdministradorDeTeste(b.admin, t, { id: usuarioBloq, email: EMAIL_BLOQ, nome: 'Iracema Ficticia', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, t, { id: randomUUID(), email: EMAIL_IP, nome: 'Potira Ficticia', filialIds: [] });
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', esqueci: { envio, repoCore: new RepositorioCoreSql() }, logger: { level: 'info', stream: destinoDeLogs(logs) } }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('B-1: 5 senhas erradas bloqueiam; a senha certa também recebe 423; o e-mail inexistente recebe o mesmo status e corpo', async () => {
    await errarAteBloquear(EMAIL_BLOQ);
    expect(await estado(usuarioBloq)).toMatchObject({ bloqueado: true });
    const certa = await entrar(EMAIL_BLOQ, SENHA_DE_TESTE);
    bloqueio423(certa);
    await errarAteBloquear(EMAIL_NINGUEM);
    const ninguem = await entrar(EMAIL_NINGUEM, SENHA_ERRADA);
    bloqueio423(ninguem);
    expect(ninguem.json()).toEqual(certa.json());
  });

  it('B-2: o limite por IP responde 429 MUITAS_TENTATIVAS (nunca 423), para conta que existe ou não', async () => {
    // Só a falha (401/423) conta no limite por IP. A conta que existe erra 4 e acerta 1 (zera a trava do banco, não a do
    // IP); a que não existe muda de e-mail a cada tentativa (trava da memória fora do caminho). Com 10 falhas, a próxima é 429.
    const casos = [
      { nome: 'existe', tentativas: () => [SENHA_ERRADA, SENHA_ERRADA, SENHA_ERRADA, SENHA_ERRADA, SENHA_DE_TESTE, SENHA_ERRADA, SENHA_ERRADA, SENHA_ERRADA, SENHA_ERRADA, SENHA_DE_TESTE, SENHA_ERRADA, SENHA_ERRADA], email: () => EMAIL_IP },
      { nome: 'não existe', tentativas: () => Array<string>(10).fill(SENHA_ERRADA), email: ninguemNovo },
    ];
    for (const c of casos) {
      const mesmoIp = novoIp();
      for (const senha of c.tentativas()) expect((await entrar(c.email(), senha, mesmoIp)).statusCode, c.nome).toBe(senha === SENHA_DE_TESTE ? 200 : 401);
      const barrada = await entrar(c.email(), SENHA_DE_TESTE, mesmoIp);
      expect(barrada.statusCode, `${c.nome}: ${barrada.body}`).toBe(429);
      expect(barrada.json()).toMatchObject({ codigo: 'MUITAS_TENTATIVAS' });
    }
  });

  it('B-3: o esqueci da conta bloqueada manda o e-mail multipart com o e-mail, sem o código da empresa, e o aviso de desbloqueio; o log não leva senha nem e-mail', async () => {
    const inicio = logs.length;
    expect((await esqueci(EMAIL_BLOQ)).statusCode).toBe(202);
    await envio.esperar();
    const m = envio.enviados.at(-1) as (typeof envio.enviados)[number] & { html?: string };
    expect(m.para).toBe(EMAIL_BLOQ);
    // multipart: as duas partes com o e-mail que a API recebeu e sem o código da empresa (ADR 0021; o texto é do SDK e do design)
    for (const parte of [m.texto, m.html ?? '']) {
      expect(parte).toContain(EMAIL_BLOQ);
      expect(parte).not.toContain(SLUG.toUpperCase());
    }
    temporaria = /Senha temporária:\s*(\S+)/.exec(m.texto)?.[1] ?? '';
    expect(temporaria).not.toBe('');
    const novos = logs.slice(inicio).join('\n');
    for (const proibido of [temporaria, EMAIL_BLOQ, EMAIL_BLOQ.split('@')[0]!, DOMINIO]) expect(novos).not.toContain(proibido);
  });

  it('B-4: entrar com a temporária desbloqueia (desbloqueou: true, falhas zeradas) e pede a troca de senha', async () => {
    const r = await entrar(EMAIL_BLOQ, temporaria);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ desbloqueou: true });
    expect(await estado(usuarioBloq)).toEqual({ falhas_login: 0, bloqueado: false });
    const eu = await app.inject({ method: 'GET', url: '/v1/auth/eu', headers: { authorization: `Bearer ${r.json<{ token_acesso: string }>().token_acesso}` } });
    expect(eu.json()).toMatchObject({ usuario: { deve_trocar_senha: true } });
  });
});
