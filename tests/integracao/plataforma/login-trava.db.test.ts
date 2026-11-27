/**
 * T-0050 (E6.2): trava do login do superadmin (ADR 0012 §6), na API real sobre o PostgreSQL efêmero com a 0033.
 * - 5 falhas seguidas travam por 15 min; a conta travada recebe o 423 `ContaBloqueadaResposta` (RN-CORE-15, T-0111),
 *   NÃO 429, com o MESMO corpo do e-mail inexistente travado pela memória (5 falhas; decisão R-20261126-175321);
 * - a contagem de falhas NÃO zera quando a trava vence (comportamento atual, fixado aqui; muda na versão seguinte);
 *   o login certo zera;
 * - log pino sem e-mail, senha, cookie nem token (molde dos testes do RN-CORE-07).
 * O limite por IP (10 tentativas a cada 15 min, IP do cliente atrás do BFF e do túnel, #324) fica no 2º describe, numa
 * API própria com o segredo do BFF e relógio falso; no 1º, cada login sai de um IP próprio e o limite não interfere.
 * O vencimento da trava é simulado pelo admin do banco (bloqueado_ate no passado): a API confere a trava no relógio
 * dela e a 0033 confere de novo no now() do banco (superadmin_abrir_sessao), então um relógio falso na API não basta.
 * Sem Postgres pula; com MACUXI_PG_EXIGIR=1 falha.
 */
import { isIP } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CABECALHO_IP_CLIENTE, CABECALHO_PROVA_BFF, COOKIE_CONFIG, type Relogio } from '../../../packages/platform-sdk/src/index';
import { criarBancoEfemero, PG_DISPONIVEL, type BancoEfemero } from '../../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, destinoDeLogs } from '../../../apps/api/src/apoio-teste';
import { esperarContaBloqueada, esperarRecusaUnica } from '../../apoio/portal-pg-expect';
import { atalhosPortal, CSRF, inserirSuperadmin, SENHA_SA, type AppPortal, type RespostaPortal } from '../../apoio/portal-pg';

const EMAIL_TRAVA = 'sa-e6-trava@exemplo.invalid';
const EMAIL_LOG = 'sa-e6-log@exemplo.invalid';
const EMAIL_INEXISTENTE = 'sa-e6-ninguem@exemplo.invalid';
const EMAIL_INEXISTENTE_TRAVA = 'sa-e6-ninguem-trava@exemplo.invalid';
const SENHA_ERRADA = 'senha-errada-e6-fict';

describe.skipIf(!PG_DISPONIVEL)('portal /config: trava do login do superadmin (T-0050 E6.2, ADR 0012 §6)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  const logs: string[] = [];
  const tokens: string[] = [];

  const estado = async (email: string) =>
    (
      await b.admin.query<{ falhas_login: number; travado: boolean; minutos: number | null }>(
        `SELECT falhas_login, coalesce(bloqueado_ate > now(), false) AS travado,
                (extract(epoch FROM bloqueado_ate - now()) / 60)::float8 AS minutos
         FROM plataforma.superadmin WHERE email = $1`,
        [email],
      )
    ).rows[0]!;
  /** Vence a trava (o tempo passou): bloqueado_ate 1 s no passado, sem tocar na contagem. */
  const vencerTrava = (email: string) => b.admin.query("UPDATE plataforma.superadmin SET bloqueado_ate = now() - interval '1 second' WHERE email = $1", [email]);
  const bloqueada = esperarContaBloqueada;
  const recusaUnica = esperarRecusaUnica;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(b, EMAIL_TRAVA);
    await inserirSuperadmin(b, EMAIL_LOG);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', logger: { level: 'info', stream: destinoDeLogs(logs) } }));
    p = atalhosPortal(app);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('ADR 0012 §6: 4 falhas não travam; a 5ª trava por 15 min', async () => {
    for (let i = 1; i <= 4; i++) {
      recusaUnica(await p.entrar(EMAIL_TRAVA, `${SENHA_ERRADA}-${i}`));
      expect(await estado(EMAIL_TRAVA)).toMatchObject({ falhas_login: i, travado: false });
    }
    recusaUnica(await p.entrar(EMAIL_TRAVA, `${SENHA_ERRADA}-5`));
    const s = await estado(EMAIL_TRAVA);
    expect(s).toMatchObject({ falhas_login: 5, travado: true });
    expect(s.minutos).toBeGreaterThan(14);
    expect(s.minutos).toBeLessThanOrEqual(15);
  });

  it('RN-CORE-15 (T-0111): conta travada com a senha certa recebe 423, nunca 429; o corpo é o do e-mail inexistente travado pela memória', async () => {
    const travada = await p.entrar(EMAIL_TRAVA, SENHA_SA);
    bloqueada(travada);
    const errada = await p.entrar(EMAIL_TRAVA, SENHA_ERRADA);
    bloqueada(errada);
    for (let i = 1; i <= 5; i++) recusaUnica(await p.entrar(EMAIL_INEXISTENTE_TRAVA, `${SENHA_ERRADA}-${i}`));
    const inexistente = await p.entrar(EMAIL_INEXISTENTE_TRAVA, SENHA_SA);
    bloqueada(inexistente);
    expect(travada.json()).toEqual(inexistente.json());
    expect(errada.json()).toEqual(inexistente.json());
    // a tentativa com a conta travada não sobe a contagem (nem a certa, nem a errada) e não estende a trava
    expect(await estado(EMAIL_TRAVA)).toMatchObject({ falhas_login: 5, travado: true });
  });

  it('ADR 0012 §6: e-mail inexistente = mesmo status, mesma mensagem e mesmo corpo da senha errada de conta existente', async () => {
    const existe = await p.entrar(EMAIL_LOG, SENHA_ERRADA);
    const naoExiste = await p.entrar(EMAIL_INEXISTENTE, SENHA_ERRADA);
    recusaUnica(existe);
    recusaUnica(naoExiste);
    expect(naoExiste.json()).toEqual(existe.json());
    expect(Object.keys(naoExiste.json()).sort()).toEqual(Object.keys(existe.json()).sort());
    // a falha da conta existente é contada; a do inexistente não cria linha
    expect((await estado(EMAIL_LOG)).falhas_login).toBe(1);
    expect((await b.admin.query('SELECT 1 FROM plataforma.superadmin WHERE email = $1', [EMAIL_INEXISTENTE])).rowCount).toBe(0);
  });

  it('ADR 0012 §6 (comportamento atual, muda na versão seguinte): a contagem NÃO zera quando a trava vence; uma falha a mais trava de novo', async () => {
    await vencerTrava(EMAIL_TRAVA);
    // Comportamento ATUAL fixado (T-0050): vencida a trava, falhas_login segue em 5 (só o login certo ou a troca de
    // senha zeram). A 1ª falha depois do vencimento já é a 6ª seguida e trava por mais 15 min. A versão seguinte
    // deve zerar a contagem no vencimento: quando mudar, este teste muda junto (com ADR/RN), não é regressão.
    expect(await estado(EMAIL_TRAVA)).toMatchObject({ falhas_login: 5, travado: false });
    recusaUnica(await p.entrar(EMAIL_TRAVA, SENHA_ERRADA));
    const s = await estado(EMAIL_TRAVA);
    expect(s).toMatchObject({ falhas_login: 6, travado: true });
    expect(s.minutos).toBeGreaterThan(14);
    // travada de novo: a senha certa volta a receber o 423
    bloqueada(await p.entrar(EMAIL_TRAVA, SENHA_SA));
  });

  it('ADR 0012 §6: vencida a trava, o login certo entra e zera a contagem e a trava', async () => {
    await vencerTrava(EMAIL_TRAVA);
    const r = await p.entrar(EMAIL_TRAVA, SENHA_SA);
    expect(r.statusCode).toBe(200);
    tokens.push(p.cookieDe(r));
    expect(await estado(EMAIL_TRAVA)).toMatchObject({ falhas_login: 0, travado: false });
    const { rows } = await b.admin.query('SELECT bloqueado_ate FROM plataforma.superadmin WHERE email = $1', [EMAIL_TRAVA]);
    expect(rows[0].bloqueado_ate).toBeNull();
    // contagem zerada: 4 falhas de novo não travam
    for (let i = 0; i < 4; i++) recusaUnica(await p.entrar(EMAIL_TRAVA, SENHA_ERRADA));
    expect(await estado(EMAIL_TRAVA)).toMatchObject({ falhas_login: 4, travado: false });
    const certa = await p.entrar(EMAIL_TRAVA, SENHA_SA);
    expect(certa.statusCode).toBe(200);
    tokens.push(p.cookieDe(certa));
    expect((await estado(EMAIL_TRAVA)).falhas_login).toBe(0);
  });

  it('regra 8 e RN-CORE-07 (molde): o log pino não traz e-mail, senha, cookie, token nem o IP de quem tentou', async () => {
    const ip = '10.66.6.6';
    const r = await p.entrar(EMAIL_LOG, SENHA_SA, { ip });
    expect(r.statusCode).toBe(200);
    tokens.push(p.cookieDe(r));
    await p.entrar(EMAIL_LOG, SENHA_ERRADA, { ip: '10.66.6.7' });
    const tudo = logs.join('\n');
    expect(tudo).toContain('superadmin_id'); // o log existe e identifica o autor só pelo id
    expect(tudo).toContain('/v1/plataforma/auth/entrar');
    const proibidos = [EMAIL_TRAVA, EMAIL_LOG, EMAIL_INEXISTENTE, SENHA_SA, SENHA_ERRADA, COOKIE_CONFIG, ip, ...tokens];
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    for (const x of proibidos) expect(tudo, `log com ${x.slice(0, 6)}…`).not.toContain(x);
    // nem pedaço do e-mail (parte local) nem cabeçalhos de credencial
    for (const x of ['sa-e6-', 'set-cookie', 'authorization']) expect(tudo).not.toContain(x);
  });
});

/**
 * T-0050 (E6, #324): limite de login do portal por IP do cliente (ADR 0012 §6), na API real com `segredoBff` e relógio
 * falso. Comportamento fixado: o limite é conferido ANTES da senha (apps/api/src/plataforma/rotas.ts, `limite.contar`
 * antes de `servico.entrar`), então a 11ª tentativa recebe 429 MUITAS_TENTATIVAS mesmo com a senha certa, e conta toda
 * tentativa (certa ou errada). Ordem do IP (apps/api/src/plataforma/ip-cliente.ts): x-macuxierp-ip-cliente só com a
 * prova x-macuxierp-bff igual ao segredo; senão cf-connecting-ip válido; senão req.ip (aqui, o `remoteAddress`).
 * IPs de teste em 10.70.x/10.71.x/10.72.x, sem colisão com o `novoIp` (10.60.x) do apoio.
 */
const SEGREDO_BFF = 'segredo-bff-de-teste-e6-fict';
const EMAIL_IP = 'sa-e6-limite-ip@exemplo.invalid';
/** Um e-mail inexistente por tentativa: a trava por conta da memória (RN-CORE-15, 5 falhas) não entra no teste do limite por IP. */
let ninguemSeq = 0;
const emailNinguemIp = () => `sa-e6-limite-ninguem-${ninguemSeq++}@exemplo.invalid`;
const SENHA_ERRADA_IP = 'senha-errada-limite-e6-fict';
const MAXIMO = 10; // ADR 0012 §6, literal (não importado da API)
const JANELA_MS = 15 * 60_000;

describe.skipIf(!PG_DISPONIVEL)('portal /config: limite de login por IP do cliente (T-0050 E6, ADR 0012 §6)', () => {
  let b: BancoEfemero;
  let app: AppPortal;
  let p: ReturnType<typeof atalhosPortal>;
  const logs: string[] = [];
  const usados = new Set<string>();
  let agoraMs = Date.now();
  const relogio: Relogio = { agora: () => new Date(agoraMs) };

  /** Login com o `remoteAddress` (req.ip) e os cabeçalhos dados, sempre com o CSRF. */
  const tentar = (o: { remoto: string; cab?: Record<string, string>; email?: string; senha?: string }) => {
    usados.add(o.remoto);
    for (const v of Object.values(o.cab ?? {})) if (isIP(v)) usados.add(v); // só IPs válidos (a prova é conferida à parte)
    return p.entrar(o.email ?? emailNinguemIp(), o.senha ?? SENHA_ERRADA_IP, { ip: o.remoto, cabecalhos: { ...CSRF, ...(o.cab ?? {}) } });
  };
  /** As `MAXIMO` tentativas da janela: todas passam do limite e caem no 401 da senha (e-mail inexistente). */
  const gastar = async (o: { remoto: string; cab?: Record<string, string> } | ((i: number) => { remoto: string; cab?: Record<string, string> })) => {
    for (let i = 0; i < MAXIMO; i++) {
      const r = await tentar(typeof o === 'function' ? o(i) : o);
      expect(r.statusCode, `tentativa ${i + 1}`).toBe(401);
    }
  };
  const barrado = (r: RespostaPortal) => {
    expect(r.statusCode).toBe(429);
    expect(r.json<{ codigo: string }>().codigo).toBe('MUITAS_TENTATIVAS');
    expect(r.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
  };
  const passou = (r: RespostaPortal) => expect(r.statusCode, 'não barrado pelo limite').toBe(401);
  const falhas = async (email: string) => (await b.admin.query<{ falhas_login: number }>('SELECT falhas_login FROM plataforma.superadmin WHERE email = $1', [email])).rows[0]!.falhas_login;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await inserirSuperadmin(b, EMAIL_IP);
    ({ app } = await appPgDeTeste({ b, modulos: 'producao', segredoBff: SEGREDO_BFF, relogio, logger: { level: 'info', stream: destinoDeLogs(logs) } }));
    p = atalhosPortal(app);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await b?.remover();
  });

  it('ADR 0012 §6: 10 tentativas por IP passam; a 11ª dá 429 MUITAS_TENTATIVAS mesmo com a senha certa e não confere a senha', async () => {
    const remoto = '10.70.0.1';
    await gastar({ remoto });
    const r = await tentar({ remoto, email: EMAIL_IP, senha: SENHA_SA });
    barrado(r);
    // barrado antes da senha: a conta não soma falha nem abre sessão
    expect(await falhas(EMAIL_IP)).toBe(0);
    barrado(await tentar({ remoto, email: EMAIL_IP, senha: SENHA_ERRADA_IP }));
    expect(await falhas(EMAIL_IP)).toBe(0);
    // o limite é do IP, não global: outro IP entra com a senha certa
    const outro = await tentar({ remoto: '10.70.0.2', email: EMAIL_IP, senha: SENHA_SA });
    expect(outro.statusCode).toBe(200);
    expect(p.cookieDe(outro)).toBeTruthy();
  });

  it('ADR 0012 §6: o login certo também conta na janela do IP (10 certos e o 11º é barrado)', async () => {
    const remoto = '10.70.0.3';
    for (let i = 0; i < MAXIMO; i++) expect((await tentar({ remoto, email: EMAIL_IP, senha: SENHA_SA })).statusCode).toBe(200);
    barrado(await tentar({ remoto, email: EMAIL_IP, senha: SENHA_SA }));
  });

  it('#324: sem a prova do BFF, x-macuxierp-ip-cliente é ignorado; trocá-lo a cada tentativa não escapa do limite', async () => {
    const remoto = '10.70.1.1';
    await gastar((i) => ({ remoto, cab: { [CABECALHO_IP_CLIENTE]: `10.71.1.${i + 1}` } }));
    barrado(await tentar({ remoto, cab: { [CABECALHO_IP_CLIENTE]: '10.71.1.200' } }));
  });

  it('#324: com a prova errada (ou vazia, ou repetida), x-macuxierp-ip-cliente é ignorado', async () => {
    const remoto = '10.70.1.2';
    const provas = ['segredo-errado', '', `${SEGREDO_BFF}x`, SEGREDO_BFF.slice(0, -1)];
    await gastar((i) => ({ remoto, cab: { [CABECALHO_PROVA_BFF]: provas[i % provas.length]!, [CABECALHO_IP_CLIENTE]: `10.71.2.${i + 1}` } }));
    barrado(await tentar({ remoto, cab: { [CABECALHO_PROVA_BFF]: 'segredo-errado', [CABECALHO_IP_CLIENTE]: '10.71.2.200' } }));
    // prova errada + ip-cliente + cf-connecting-ip: vale o cf (contador novo), não o ip-cliente
    const cf = '10.72.2.1';
    await gastar((i) => ({ remoto, cab: { [CABECALHO_PROVA_BFF]: 'segredo-errado', [CABECALHO_IP_CLIENTE]: `10.71.3.${i + 1}`, 'cf-connecting-ip': cf } }));
    barrado(await tentar({ remoto, cab: { [CABECALHO_PROVA_BFF]: 'segredo-errado', [CABECALHO_IP_CLIENTE]: '10.71.3.200', 'cf-connecting-ip': cf } }));
  });

  it('#324: com a prova certa, cada IP de cliente tem o próprio contador (mesmo BFF, mesmo req.ip e mesmo cf)', async () => {
    const remoto = '10.70.2.1'; // o contêiner do BFF
    const bff = (ip: string, extra: Record<string, string> = {}) => ({ remoto, cab: { [CABECALHO_PROVA_BFF]: SEGREDO_BFF, [CABECALHO_IP_CLIENTE]: ip, ...extra } });
    await gastar(bff('10.71.4.1', { 'cf-connecting-ip': '10.72.4.1' }));
    barrado(await tentar(bff('10.71.4.1', { 'cf-connecting-ip': '10.72.4.1' })));
    passou(await tentar(bff('10.71.4.2', { 'cf-connecting-ip': '10.72.4.1' })));
    // o IP do BFF (req.ip) e o cf não foram contados pelas tentativas acima: sem a prova, o req.ip tem a janela inteira
    await gastar({ remoto });
    barrado(await tentar({ remoto }));
    // prova certa com ip-cliente inválido cai no req.ip (já gasto)
    barrado(await tentar(bff('nao-e-ip')));
  });

  it('#324: sem a prova, cf-connecting-ip separa os contadores; sem nenhum cabeçalho, vale o req.ip', async () => {
    const remoto = '10.70.3.1';
    await gastar({ remoto, cab: { 'cf-connecting-ip': '10.72.5.1' } });
    barrado(await tentar({ remoto, cab: { 'cf-connecting-ip': '10.72.5.1' } }));
    passou(await tentar({ remoto, cab: { 'cf-connecting-ip': '10.72.5.2' } }));
    // o mesmo cf atrás de outro req.ip segue barrado (o contador é do cf)
    barrado(await tentar({ remoto: '10.70.3.9', cab: { 'cf-connecting-ip': '10.72.5.1' } }));
    // sem cabeçalho: o req.ip ainda não foi contado (as tentativas acima contaram no cf)
    await gastar({ remoto });
    barrado(await tentar({ remoto }));
    passou(await tentar({ remoto: '10.70.3.2' }));
    // cf inválido é ignorado: vale o req.ip (gasto)
    barrado(await tentar({ remoto, cab: { 'cf-connecting-ip': 'nao-e-ip' } }));
  });

  it('ADR 0012 §6: a janela vence 15 min depois da 1ª tentativa (relógio da API)', async () => {
    const remoto = '10.70.4.1';
    const inicio = agoraMs;
    await gastar({ remoto });
    agoraMs = inicio + JANELA_MS - 1;
    barrado(await tentar({ remoto }));
    agoraMs = inicio + JANELA_MS;
    passou(await tentar({ remoto })); // 1ª da janela nova
    for (let i = 1; i < MAXIMO; i++) passou(await tentar({ remoto }));
    barrado(await tentar({ remoto }));
  });

  it('regra 8 e ADR 0012 §6: nenhum IP (req.ip, cf, ip-cliente) nem o segredo do BFF vai para o log pino ou para o banco', async () => {
    expect(usados.size).toBeGreaterThan(20);
    const tudo = logs.join('\n');
    expect(tudo).toContain('/v1/plataforma/auth/entrar');
    expect(tudo).toContain('superadmin_id');
    for (const x of [...usados, SEGREDO_BFF, 'segredo-errado']) expect(tudo, `log com ${x}`).not.toContain(x);
    for (const x of ['cf-connecting-ip', CABECALHO_IP_CLIENTE, CABECALHO_PROVA_BFF, 'remoteAddress']) expect(tudo).not.toContain(x);
    // banco: nenhuma linha de nenhuma tabela de schema de aplicação traz os IPs (plataforma.auditoria, sessões etc.)
    const { rows: tabelas } = await b.admin.query<{ s: string; t: string }>(
      `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
    );
    expect(tabelas.map((x) => `${x.s}.${x.t}`)).toEqual(expect.arrayContaining(['plataforma.superadmin', 'plataforma.auditoria']));
    const padroes = [...usados].map((x) => `%${x}%`);
    for (const { s, t } of tabelas) {
      const { rows } = await b.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${s}"."${t}" x WHERE x::text LIKE ANY ($1)`, [padroes]);
      expect(rows[0]!.n, `${s}.${t} com IP`).toBe(0);
    }
  });
});
