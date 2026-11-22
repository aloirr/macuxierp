/**
 * Acesso ao PostgreSQL pelo psql (o cliente oficial, presente no runner do CI e no db/scripts/pg-local.sh), sem
 * driver novo no lockfile. A senha vai por PGPASSWORD (nunca na linha de comando nem em log).
 */
import { spawn, spawnSync } from 'node:child_process';

export interface Conexao {
  host?: string;
  porta?: string | number;
  usuario?: string;
  senha?: string;
  banco?: string;
}

/** Contexto de quem consulta: papel da aplicação (SET ROLE) e tenant da sessão (app.tenant_id, como a API faz). */
export interface Contexto {
  papel?: string;
  tenant?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

export class ErroPsql extends Error {
  readonly saida: string;
  constructor(mensagem: string, saida: string) {
    super(mensagem);
    this.name = 'ErroPsql';
    this.saida = saida;
  }
}

/** Conexão do admin a partir do ambiente (MACUXI_PG_*, os mesmos do CI e do pg-local.sh), com PG* como reserva. */
export function conexaoDoAmbiente(env: NodeJS.ProcessEnv = process.env, banco?: string): Conexao {
  return {
    host: env.MACUXI_PG_HOST ?? env.PGHOST ?? '127.0.0.1',
    porta: env.MACUXI_PG_PORTA ?? env.PGPORT ?? '5432',
    usuario: env.MACUXI_PG_ADMIN_USUARIO ?? env.PGUSER ?? 'postgres',
    senha: env.MACUXI_PG_ADMIN_SENHA ?? env.PGPASSWORD,
    banco: banco ?? env.MACUXIERP_BANCO ?? env.PGDATABASE ?? 'macuxierp',
  };
}

function ambiente(c: Conexao): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGTZ: 'UTC',
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: 'macuxierp-db',
  };
  if (c.host !== undefined) env.PGHOST = c.host;
  if (c.porta !== undefined) env.PGPORT = String(c.porta);
  if (c.usuario !== undefined) env.PGUSER = c.usuario;
  if (c.senha !== undefined) env.PGPASSWORD = c.senha;
  if (c.banco !== undefined) env.PGDATABASE = c.banco;
  return env;
}

interface OpcoesScript {
  transacao?: boolean;
  variaveis?: Record<string, string>;
}

/** Binário do psql (MACUXI_PSQL permite apontar outro). */
function PSQL(): string {
  return process.env.MACUXI_PSQL ?? 'psql';
}

/** Argumentos do psql para rodar um script do stdin, parando no primeiro erro. */
function argumentos(opcoes: OpcoesScript = {}): string[] {
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  if (opcoes.transacao) args.push('-1');
  for (const [nome, valor] of Object.entries(opcoes.variaveis ?? {})) args.push('-v', `${nome}=${valor}`);
  args.push('-f', '-');
  return args;
}

/** Erro do psql que saiu com status diferente de 0: a mensagem é a linha ERROR/ERRO (ou a saída toda). */
function erroPsql(saida: string): ErroPsql {
  const erro = saida.trim();
  return new ErroPsql(erro.split('\n').find((l) => l.includes('ERROR') || l.includes('ERRO')) ?? erro, erro);
}

/** Roda um script no psql (stdin), parando no primeiro erro. `transacao` = tudo ou nada (-1). Devolve o stdout. */
export function rodarScript(c: Conexao, script: string, opcoes: OpcoesScript = {}): string {
  const r = spawnSync(PSQL(), argumentos(opcoes), {
    input: script,
    env: ambiente(c),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new ErroPsql(`psql não executou: ${r.error.message}`, '');
  if (r.status !== 0) throw erroPsql(r.stderr || r.stdout);
  return r.stdout;
}

/**
 * O mesmo script do rodarScript, mas sem bloquear: para os testes que precisam de duas sessões ao mesmo tempo
 * (concorrência entre transações). Resolve com o stdout; rejeita com ErroPsql.
 */
export function rodarScriptAssincrono(
  c: Conexao,
  script: string,
  opcoes: OpcoesScript = {},
): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const p = spawn(PSQL(), argumentos(opcoes), { env: ambiente(c) });
    let saida = '';
    let erro = '';
    p.stdout.setEncoding('utf8').on('data', (d: string) => (saida += d));
    p.stderr.setEncoding('utf8').on('data', (d: string) => (erro += d));
    p.on('error', (e) => rejeitar(new ErroPsql(`psql não executou: ${e.message}`, '')));
    p.on('close', (status) => {
      if (status === 0) resolver(saida);
      else rejeitar(erroPsql(erro || saida));
    });
    p.stdin.end(script);
  });
}

/** Preâmbulo que põe a sessão no papel e no tenant pedidos (valores conferidos: nada de SQL vindo de fora). */
function preambulo(ctx: Contexto = {}): string {
  const linhas: string[] = [];
  if (ctx.papel !== undefined) {
    if (!IDENTIFICADOR.test(ctx.papel)) throw new Error(`papel inválido: ${ctx.papel}`);
    linhas.push(`SET ROLE ${ctx.papel};`);
  }
  if (ctx.tenant !== undefined && ctx.tenant !== null) {
    if (!UUID.test(ctx.tenant)) throw new Error(`tenant inválido: ${ctx.tenant}`);
    linhas.push(`SET app.tenant_id = '${ctx.tenant}';`);
  }
  return linhas.join('\n');
}

/** Executa comandos (um script) no contexto, numa transação. */
export function executar(c: Conexao, sql: string, ctx: Contexto = {}): void {
  rodarScript(c, `${preambulo(ctx)}\n${sql}\n`, { transacao: true });
}

/** Consulta que devolve linhas como objetos (via json_agg). */
export function consultar<T = Record<string, unknown>>(c: Conexao, sql: string, ctx: Contexto = {}): T[] {
  const saida = rodarScript(
    c,
    `${preambulo(ctx)}\nSELECT coalesce(json_agg(q), '[]'::json) FROM (${sql}) q;\n`,
    {
      transacao: true,
    },
  );
  return JSON.parse(saida.trim()) as T[];
}

/** Valor de texto de SQL (aspas simples escapadas). */
export function literal(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`;
}
