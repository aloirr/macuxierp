/**
 * T-0050 (E6): apoio dos testes do portal `/config` em tests/integracao/plataforma/. A API de produção no PostgreSQL
 * efêmero (`appPgDeTeste`, plugin de plataforma do #315 montado por `montarDependenciasProducao`), superadmins gravados
 * pelo admin do banco de teste e os atalhos de chamada. Dados fictícios (domínio exemplo.invalid).
 */
import { createHash } from 'node:crypto';
import { CABECALHO_CSRF_CONFIG, COOKIE_CONFIG } from '../../packages/platform-sdk/src/index';
import type { BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';
import { ARGON2_RAPIDO, type appPgDeTeste } from '../../apps/api/src/apoio-teste';
import { gerarHashSenha } from '../../apps/api/src/auth/senha';

/** Papel do portal `/config` no banco (ADR 0012 §1). */
export const PAPEL_CONFIG = 'macuxierp_config';
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const CSRF = { [CABECALHO_CSRF_CONFIG]: '1' } as const;
export const SENHA_SA = 'senha-do-superadmin-e6-fict';
/** A API de teste (a raiz não resolve o pacote `fastify`: o tipo vem do `appPgDeTeste`). */
export type AppPortal = Awaited<ReturnType<typeof appPgDeTeste>>['app'];
/** O que os testes usam da resposta do `app.inject`. */
export interface RespostaPortal {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | number | undefined>;
  cookies: { name: string; value: string }[];
  json<T = unknown>(): T;
}
export type MetodoPortal = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Superadmin ativo com a `SENHA_SA` (argon2id rápido de teste), pela conexão do admin. Devolve o id. */
export async function inserirSuperadmin(b: BancoEfemero, email: string, o: { deveTrocar?: boolean } = {}): Promise<string> {
  const { rows } = await b.admin.query<{ id: string }>(
    `INSERT INTO plataforma.superadmin (email, nome, senha_hash, deve_trocar_senha, ativo)
     VALUES ($1, 'Superadmin Fictício E6', $2, $3, true) RETURNING id`,
    [email, await gerarHashSenha(SENHA_SA, ARGON2_RAPIDO), o.deveTrocar ?? false],
  );
  return rows[0]!.id;
}

/** Manaus (1302603, AM) numa tabela oficial de municípios de teste, pela conexão do admin (cidade da filial, IBGE da consulta). */
export async function semearMunicipioManaus(b: BancoEfemero): Promise<void> {
  const { rows } = await b.admin.query<{ id: string }>(
    `INSERT INTO cadastros.tabela_oficial_versao (id, tabela, carga, versao, fonte, url, data_referencia, arquivo, sha256, registros)
     VALUES (gen_random_uuid(), 'municipio', 'municipio-teste', 't-teste', 'IBGE (teste)', 'https://exemplo.invalid', '2026-01-01', 'municipio.csv', repeat('e', 64), 1)
     RETURNING id`,
  );
  await b.admin.query("INSERT INTO cadastros.municipio (codigo, nome, uf, vigencia_inicio, vigencia_fim, versao_id) VALUES ('1302603', 'Manaus', 'AM', '2020-01-01', NULL, $1)", [
    rows[0]!.id,
  ]);
}

/** Cada login sai de um IP próprio: o limite por IP (ADR 0012 §6, testado à parte em login-trava.db.test.ts) não interfere. */
let ipSeq = 0;
export const novoIp = () => `10.60.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

export function atalhosPortal(app: AppPortal) {
  const entrar = (email: string, senha: string, o: { ip?: string; cabecalhos?: Record<string, string> } = {}): Promise<RespostaPortal> =>
    app.inject({ method: 'POST', url: '/v1/plataforma/auth/entrar', remoteAddress: o.ip ?? novoIp(), headers: o.cabecalhos ?? CSRF, payload: { email, senha } });

  const cookieDe = (r: RespostaPortal): string => {
    const c = r.cookies.find((x) => x.name === COOKIE_CONFIG);
    if (!c) throw new Error(`login sem o cookie do portal (status ${r.statusCode})`);
    return c.value;
  };

  const sessao = async (email: string, senha = SENHA_SA): Promise<string> => {
    const r = await entrar(email, senha);
    if (r.statusCode !== 200) throw new Error(`login do superadmin de teste: ${r.statusCode}`);
    return cookieDe(r);
  };

  /** Chamada ao portal com o cookie de sessão (se houver), CSRF por padrão e Idempotency-Key opcional. */
  const pedir = (
    metodo: MetodoPortal,
    url: string,
    o: { token?: string; corpo?: object; chave?: string; csrf?: boolean | string; cabecalhos?: Record<string, string>; cookies?: Record<string, string> } = {},
  ): Promise<RespostaPortal> =>
    app.inject({
      method: metodo,
      url,
      cookies: { ...(o.token ? { [COOKIE_CONFIG]: o.token } : {}), ...(o.cookies ?? {}) },
      headers: {
        ...(o.csrf === false ? {} : { [CABECALHO_CSRF_CONFIG]: typeof o.csrf === 'string' ? o.csrf : '1' }),
        ...(o.chave ? { 'idempotency-key': o.chave } : {}),
        ...(o.cabecalhos ?? {}),
      },
      ...(o.corpo !== undefined ? { payload: o.corpo } : {}),
    });

  return { entrar, cookieDe, sessao, pedir };
}

/** O que os testes usam do cliente do pool do admin (a raiz não tem @types/pg). */
export interface ClientePg {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  release(): void;
}
export interface OpcoesPapel {
  tenant?: string;
  /** Id da sessão do superadmin (o que a API põe em `macuxierp.sessao_superadmin`). */
  sessao?: string;
  confirmar?: boolean;
}

/** Roda `fn` no papel real (SET LOCAL ROLE, como a API), numa transação desfeita salvo `confirmar`, com tenant e sessão
 *  de superadmin opcionais. */
export async function comoPapel<T>(b: BancoEfemero, papel: string, o: OpcoesPapel, fn: (c: ClientePg) => Promise<T>): Promise<T> {
  const c = (await b.admin.connect()) as unknown as ClientePg;
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${papel}`);
    if (o.tenant) await c.query("SELECT set_config('app.tenant_id', $1, true)", [o.tenant]);
    if (o.sessao) await c.query("SELECT set_config('macuxierp.sessao_superadmin', $1, true)", [o.sessao]);
    const r = await fn(c);
    await c.query(o.confirmar ? 'COMMIT' : 'ROLLBACK');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** SQLSTATE do erro de `sql` rodado no papel (via `comoPapel`), ou null se passou. */
export async function erroComoPapel(b: BancoEfemero, papel: string, o: OpcoesPapel, sql: string): Promise<string | null> {
  try {
    await comoPapel(b, papel, o, (c) => c.query(sql));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}
