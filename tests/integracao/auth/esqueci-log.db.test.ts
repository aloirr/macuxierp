/**
 * T-0102 (plano da v0.3.13, S-1 a S-3): o motivo do não envio do "Esqueci a senha" vai ao log da API, sem dado pessoal,
 * conferido de fora: a API de produção (`appPgDeTeste`, módulos de produção, `RepositorioCoreSql`) sobre o PostgreSQL
 * efêmero, o pino capturado em memória e a porta de e-mail em memória (a única dublê: o SMTP).
 * - S-1: cada caminho grava uma linha `esqueci.sem_envio` com o motivo fixo (empresa inexistente ou suspensa, conta
 *   inexistente ou inativa, e-mail desligado) ou o `email.enviado` do aceite do SMTP; a linha não leva outro campo além
 *   do evento, do motivo (ou do `envio_id` aleatório) e dos campos do pino. O limite por conta sai no log da resposta
 *   (429), sem a conta. Conta travada (bloqueado_ate) não é motivo de não envio: a temporária é o caminho para destravar.
 * - S-2: o log inteiro não contém o e-mail digitado, a parte local, o domínio, o código da empresa nem a temporária.
 * - S-3: todos os motivos respondem o mesmo 202 neutro, com o mesmo corpo (RN-CORE-13).
 * Dados fictícios (domínios .invalid). Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CABECALHO_CSRF_CONFIG } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { RepositorioCoreSql } from '../../../modules/core/api/index';
import { appPgDeTeste, destinoDeLogs, EnvioEmailMemoria, inserirAdministradorDeTeste } from '../../../apps/api/src/apoio-teste';
import { inserirSuperadmin, type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';

/** Códigos de empresa e e-mails da massa: nenhum deles (nem pedaço) pode aparecer no log. */
const ATIVA = 'tq0102';
const SUSPENSA = 'tq0103';
const INEXISTENTE = 'tq0199';
const DOMINIO = 'loja-t0102.invalid';
const EMAIL_ATIVO = `rosa.esqueci@${DOMINIO}`;
const EMAIL_INATIVO = `jurema.inativa@${DOMINIO}`;
const EMAIL_SUSPENSA = `caua.suspensa@${DOMINIO}`;
const EMAIL_NINGUEM = `ninguem.t0102@${DOMINIO}`;
const EMAIL_SA = `sa.t0102@${DOMINIO}`;
const EMAIL_SA_INATIVO = `sa.inativo.t0102@${DOMINIO}`;
const EMAIL_SA_TRAVADO = `sa.travado.t0102@${DOMINIO}`;
const EMAIL_LIMITE = `limite.t0102@${DOMINIO}`;
const PROIBIDOS = [
  DOMINIO,
  'loja-t0102',
  ATIVA,
  SUSPENSA,
  INEXISTENTE,
  ...[EMAIL_ATIVO, EMAIL_INATIVO, EMAIL_SUSPENSA, EMAIL_NINGUEM, EMAIL_SA, EMAIL_SA_INATIVO, EMAIL_SA_TRAVADO, EMAIL_LIMITE].flatMap((e) => [e, e.split('@')[0]!]),
];
/** Campos que o pino põe em toda linha; o resto da linha do esqueci tem de ser só o evento e o motivo (ou o envio_id). */
const CAMPOS_PINO = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'request_id']);

type Linha = Record<string, unknown>;

describe.skipIf(!PG_DISPONIVEL)('T-0102: log do motivo do "Esqueci a senha" na API real (S-1 a S-3)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let semEmail: AppPortal;
  const logs: string[] = [];
  const logsSemEmail: string[] = [];
  const envio = new EnvioEmailMemoria();
  let ip = 1;
  const novoIp = () => `10.102.0.${ip++}`;

  const linhas = (fonte: string[]): Linha[] =>
    fonte
      .flatMap((l) => l.split('\n'))
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Linha);
  /** Roda o pedido e devolve a resposta e as linhas de log que ele gerou (o envio agendado incluído). */
  const comLog = async (fonte: string[], pedido: () => Promise<RespostaPortal>) => {
    const inicio = fonte.length;
    const r = await pedido();
    await envio.esperar();
    return { r, novas: linhas(fonte.slice(inicio)) };
  };
  const esqueci = (a: AppPortal, empresa: string, email: string) =>
    a.inject({ method: 'POST', url: '/v1/auth/esqueci', headers: { 'cf-connecting-ip': novoIp() }, payload: { empresa, email } });
  const esqueciConfig = (a: AppPortal, email: string) =>
    a.inject({ method: 'POST', url: '/v1/plataforma/auth/esqueci', remoteAddress: novoIp(), headers: { [CABECALHO_CSRF_CONFIG]: '1' }, payload: { email } });
  const doEsqueci = (novas: Linha[]) => novas.filter((o) => o.evento === 'esqueci.sem_envio' || o.evento === 'email.enviado' || o.evento === 'email.falha');
  const respostas: RespostaPortal[] = [];

  /** S-1: exatamente uma linha do esqueci, com o evento e o motivo esperados e nenhum outro campo. */
  const umaLinha = (novas: Linha[], evento: string, motivo?: string) => {
    const l = doEsqueci(novas);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ evento, ...(motivo ? { motivo } : {}) });
    const extras = Object.keys(l[0]!).filter((k) => !CAMPOS_PINO.has(k));
    expect(extras.sort()).toEqual(motivo ? ['evento', 'motivo'] : ['envio_id', 'evento']);
  };
  const neutro = (r: RespostaPortal) => {
    expect(r.statusCode).toBe(202);
    respostas.push(r);
  };

  beforeAll(async () => {
    b = await criarBancoEfemero();
    const ativa = await criarTenant(b.admin, ATIVA, ['cadastros']);
    const suspensa = await criarTenant(b.admin, SUSPENSA, ['cadastros']);
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [suspensa]);
    await inserirAdministradorDeTeste(b.admin, ativa, { id: randomUUID(), email: EMAIL_ATIVO, nome: 'Rosa Ficticia', filialIds: [] });
    await inserirAdministradorDeTeste(b.admin, ativa, { id: randomUUID(), email: EMAIL_LIMITE, nome: 'Limite Ficticio', filialIds: [] });
    const inativo = randomUUID();
    await inserirAdministradorDeTeste(b.admin, ativa, { id: inativo, email: EMAIL_INATIVO, nome: 'Jurema Ficticia', filialIds: [] });
    await b.admin.query('UPDATE plataforma.usuario SET ativo = false WHERE id = $1', [inativo]);
    await inserirAdministradorDeTeste(b.admin, suspensa, { id: randomUUID(), email: EMAIL_SUSPENSA, nome: 'Caua Ficticio', filialIds: [] });
    await inserirSuperadmin(b, EMAIL_SA);
    await inserirSuperadmin(b, EMAIL_SA_INATIVO);
    await inserirSuperadmin(b, EMAIL_SA_TRAVADO);
    await b.admin.query('UPDATE plataforma.superadmin SET ativo = false WHERE email = $1', [EMAIL_SA_INATIVO]);
    await b.admin.query("UPDATE plataforma.superadmin SET falhas_login = 5, bloqueado_ate = now() + interval '15 minutes' WHERE email = $1", [EMAIL_SA_TRAVADO]);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', esqueci: { envio, repoCore: new RepositorioCoreSql() }, logger: { level: 'info', stream: destinoDeLogs(logs) } }));
    ({ app: semEmail } = await appPgDeTeste({ b, modulos: 'producao', logger: { level: 'info', stream: destinoDeLogs(logsSemEmail) } }));
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await semEmail?.close();
    await b?.remover();
  });

  it('S-1 tenant: empresa inexistente e suspensa = empresa_inexistente_ou_suspensa; conta inexistente e inativa = conta_inexistente_ou_inativa; nada sai', async () => {
    for (const [empresa, email, motivo] of [
      [INEXISTENTE.toUpperCase(), EMAIL_ATIVO, 'empresa_inexistente_ou_suspensa'],
      [SUSPENSA.toUpperCase(), EMAIL_SUSPENSA, 'empresa_inexistente_ou_suspensa'],
      [ATIVA.toUpperCase(), EMAIL_NINGUEM, 'conta_inexistente_ou_inativa'],
      [ATIVA.toUpperCase(), EMAIL_INATIVO, 'conta_inexistente_ou_inativa'],
    ] as const) {
      const { r, novas } = await comLog(logs, () => esqueci(app, empresa, email));
      neutro(r);
      umaLinha(novas, 'esqueci.sem_envio', motivo);
    }
    expect(envio.enviados).toEqual([]);
  });

  it('S-1 superadmin (MACUXI na tela única e /config): inexistente e inativo = conta_inexistente_ou_inativa; nada sai', async () => {
    for (const pedido of [
      () => esqueci(app, 'MACUXI', EMAIL_NINGUEM),
      () => esqueci(app, 'MACUXI', EMAIL_SA_INATIVO),
      () => esqueciConfig(app, EMAIL_NINGUEM),
      () => esqueciConfig(app, EMAIL_SA_INATIVO),
    ]) {
      const { r, novas } = await comLog(logs, pedido);
      neutro(r);
      umaLinha(novas, 'esqueci.sem_envio', 'conta_inexistente_ou_inativa');
    }
    expect(envio.enviados).toEqual([]);
  });

  it('S-1 aceite do SMTP: conta ativa (tenant, superadmin e superadmin travado) = email.enviado com envio_id, sem sem_envio', async () => {
    const pedidos = [() => esqueci(app, ATIVA.toUpperCase(), EMAIL_ATIVO), () => esqueci(app, 'MACUXI', EMAIL_SA), () => esqueciConfig(app, EMAIL_SA_TRAVADO)];
    for (const pedido of pedidos) {
      const { r, novas } = await comLog(logs, pedido);
      neutro(r);
      umaLinha(novas, 'email.enviado');
      expect(doEsqueci(novas)[0]!.envio_id).toEqual(expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/));
    }
    expect(envio.enviados.map((e) => e.para)).toEqual([EMAIL_ATIVO, EMAIL_SA, EMAIL_SA_TRAVADO]);
  });

  it('S-1 falha do SMTP: email.falha com as tentativas, sem o destinatário', async () => {
    envio.falhar = true;
    try {
      const inicio = logs.length;
      neutro(await esqueci(app, 'MACUXI', EMAIL_SA));
      // 2 tentativas com 2 s entre elas (envio-apos-resposta.ts): espera a linha da falha final.
      await expect.poll(() => doEsqueci(linhas(logs.slice(inicio))).length, { timeout: 6_000, interval: 100 }).toBe(1);
      expect(doEsqueci(linhas(logs.slice(inicio)))[0]).toMatchObject({ evento: 'email.falha', tentativas: 2 });
    } finally {
      envio.falhar = false;
    }
  }, 10_000);

  it('S-1 e-mail desligado: email_desligado nas três entradas (tenant, MACUXI e /config)', async () => {
    for (const pedido of [() => esqueci(semEmail, ATIVA.toUpperCase(), EMAIL_ATIVO), () => esqueci(semEmail, 'MACUXI', EMAIL_SA), () => esqueciConfig(semEmail, EMAIL_SA)]) {
      const { r, novas } = await comLog(logsSemEmail, pedido);
      neutro(r);
      umaLinha(novas, 'esqueci.sem_envio', 'email_desligado');
    }
  });

  it('S-1 limite por conta: o 4º pedido da mesma conta recebe 429 e o log da resposta mostra o 429, sem a conta', async () => {
    for (let i = 0; i < 3; i++) neutro(await esqueci(app, ATIVA.toUpperCase(), EMAIL_LIMITE));
    await envio.esperar();
    const { r, novas } = await comLog(logs, () => esqueci(app, ATIVA.toUpperCase(), EMAIL_LIMITE));
    expect(r.statusCode).toBe(429);
    expect(doEsqueci(novas)).toEqual([]);
    expect(novas.some((o) => (o.res as { statusCode?: number } | undefined)?.statusCode === 429)).toBe(true);
  });

  it('S-2: o log inteiro (com e sem e-mail) não contém e-mail, parte local, domínio, código da empresa nem a temporária', () => {
    const texto = [...logs, ...logsSemEmail].join('\n').toLowerCase();
    expect(texto.length).toBeGreaterThan(0);
    for (const proibido of PROIBIDOS) expect(texto).not.toContain(proibido.toLowerCase());
    expect(texto).not.toMatch(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]/);
    const temporarias = envio.enviados.map((e) => /Senha temporária: (\S+)/.exec(e.texto)?.[1]).filter((t): t is string => !!t);
    expect(temporarias.length).toBeGreaterThan(0);
    for (const t of temporarias) expect(texto).not.toContain(t.toLowerCase());
  });

  it('S-3 (RN-CORE-13): todos os 202 têm o mesmo corpo, seja qual for o motivo', () => {
    expect(respostas.length).toBeGreaterThanOrEqual(15);
    const corpos = new Set(respostas.map((r) => r.body));
    expect(corpos.size).toBe(1);
    expect(Object.keys(respostas[0]!.json<object>())).toEqual(['mensagem']);
  });
});
