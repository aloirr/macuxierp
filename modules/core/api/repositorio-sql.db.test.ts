/**
 * Concorrência do adaptador SQL do core contra o PostgreSQL real: duas transações simultâneas, cada uma numa sessão
 * psql própria (BEGIN ... COMMIT em várias chamadas), com SET ROLE macuxierp_app e app.tenant_id como a API faz.
 * Liga com `MACUXI_DB_MIGRACOES=<pasta das migrações>` e o Postgres local: `bash db/scripts/pg-local.sh`. Sem a
 * variável ou sem o psql, pula.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { Transacao } from '@macuxierp/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { avaliarAlteracaoUsuario } from '../domain';
import type { LinhaUsuario } from './portas';
import { RepositorioCoreSql } from './repositorio-sql';

const PASTA = process.env.MACUXI_DB_MIGRACOES;
const env = process.env;
const conexao = (banco: string): NodeJS.ProcessEnv => ({
  ...env, PGHOST: env.MACUXI_PG_HOST ?? '127.0.0.1', PGPORT: env.MACUXI_PG_PORTA ?? '5432', PGUSER: env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
  PGPASSWORD: env.MACUXI_PG_ADMIN_SENHA ?? '', PGDATABASE: banco, PGTZ: 'UTC',
});

function psql(banco: string, script: string, emTransacao = true): string {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...(emTransacao ? ['-1'] : []), '-f', '-'], { input: script, env: conexao(banco), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${r.stderr}${r.stdout}`.split('\n').find((l) => l.includes('ERROR')) ?? 'psql falhou');
  return r.stdout;
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Array.isArray(v)) return v.length ? `ARRAY[${v.map(lit).join(',')}]` : "'{}'";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replaceAll("'", "''")}'`;
};

const FIM = '@@FIM@@';

/** Uma transação aberta (sessão psql viva): cada `consultar` é uma etapa da mesma transação. */
class Sessao implements Transacao {
  readonly proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private espera: (() => void) | null = null;

  constructor(banco: string, tenant: string) {
    this.proc = spawn('sh', ['-c', 'psql -X -q -A -t 2>&1'], { env: conexao(banco) });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => {
      this.buffer += d;
      if (this.buffer.includes(FIM)) this.espera?.();
    });
    this.proc.stdin.write(`BEGIN;\nSET ROLE macuxierp_app;\nSET app.tenant_id = '${tenant}';\n`);
  }

  private async rodar(script: string): Promise<string> {
    const pronto = new Promise<void>((resolve) => {
      this.espera = resolve;
    });
    this.proc.stdin.write(`${script}\n\\echo ${FIM}\n`);
    await pronto;
    const saida = this.buffer.slice(0, this.buffer.indexOf(FIM));
    this.buffer = '';
    if (/ERROR:/.test(saida)) throw new Error(saida.split('\n').find((l) => l.includes('ERROR')));
    return saida;
  }

  async consultar<L>(sql: string, p: readonly unknown[] = []): Promise<L[]> {
    const preenchido = sql.replace(/\$(\d+)/g, (_m, n: string) => lit(p[Number(n) - 1]));
    const devolve = /^\s*(select|with)\b/i.test(preenchido) || /\breturning\b/i.test(preenchido);
    const corpo = devolve ? `WITH q AS (${preenchido}) SELECT coalesce(json_agg(q), '[]'::json) FROM q;` : `${preenchido};`;
    const saida = await this.rodar(corpo);
    return (devolve ? JSON.parse(saida.trim() || '[]') : []) as L[];
  }

  async confirmar(): Promise<void> {
    await this.rodar('COMMIT;');
    this.proc.stdin.end();
  }
}

const pronto = (() => {
  if (!PASTA) return false;
  try {
    return spawnSync('psql', ['--version']).status === 0 && psql('postgres', 'SELECT 1;') !== undefined;
  } catch {
    return false;
  }
})();

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** 'travada' se a promessa não terminar em `ms` (a transação espera a trava do banco). */
const travada = (p: Promise<unknown>, ms = 400) => Promise.race([p.then(() => 'livre' as const), pausa(ms).then(() => 'travada' as const)]);

describe.skipIf(!pronto)('concorrência do adaptador SQL do core (PostgreSQL real)', () => {
  const banco = `macuxi_teste_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const T = randomUUID();
  const U1 = randomUUID();
  const U2 = randomUUID();
  const repo = new RepositorioCoreSql();
  const sessoes: Sessao[] = [];
  const abrir = () => {
    const s = new Sessao(banco, T);
    sessoes.push(s);
    return s;
  };

  beforeAll(() => {
    psql('postgres', `CREATE DATABASE ${banco};`, false);
    for (const f of readdirSync(PASTA as string).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) psql(banco, readFileSync(join(PASTA as string, f), 'utf8'));
    psql(banco, `INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ('${T}', '${T}', 'empresa-core', 'Empresa Core');
      INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ('${T}', 'Empresa Piloto LTDA', '11222333000181');
      INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil) VALUES
        ('${U1}', '${T}', 'um@piloto.test', 'Admin Um', '$argon2id$x', 'administrador'),
        ('${U2}', '${T}', 'dois@piloto.test', 'Admin Dois', '$argon2id$x', 'administrador');`);
  }, 120_000);
  afterAll(() => {
    for (const s of sessoes) s.proc.kill();
    spawnSync('psql', ['-X', '-q', '-c', `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`], { env: conexao('postgres') });
  });

  it('RF-CORE-01: duas gravações da empresa com o mesmo token de updated_at: a primeira vence e a segunda recebe null (409)', async () => {
    const leitura = abrir();
    const lida = await repo.empresa(leitura);
    await leitura.confirmar();
    const token = new Date(lida?.updated_at as unknown as string);
    const dados = { razao_social: 'Primeira LTDA', nome_fantasia: null, ie: null, fuso: 'America/Manaus' };

    const t1 = abrir();
    const t2 = abrir();
    await expect(repo.atualizarEmpresa(t1, dados, token, token)).resolves.toMatchObject({ razao_social: 'Primeira LTDA' });
    const segunda = repo.atualizarEmpresa(t2, { ...dados, razao_social: 'Segunda LTDA' }, token, token);
    expect(await travada(segunda)).toBe('travada'); // espera a trava da linha da primeira
    await t1.confirmar();
    await expect(segunda).resolves.toBeNull();
    await t2.confirmar();
    expect((await repo.empresa(abrir()))?.razao_social).toBe('Primeira LTDA');
  });

  it('RN-CORE-01: dois administradores inativando um ao outro ao mesmo tempo: o segundo é recusado e sobra um ativo', async () => {
    const t1 = abrir();
    const t2 = abrir();
    const agora = new Date('2026-11-21T15:00:00Z');
    const alterar = async (tx: Transacao, alvoId: string) => {
      // mesma sequência da rota: trava, conta os outros, avalia o domain e só então grava
      await repo.travarAdministradoresAtivos(tx);
      const atual = (await repo.usuarioPorId(tx, alvoId)) as LinhaUsuario;
      const outros = await repo.contarAdministradoresAtivos(tx, alvoId);
      const r = avaliarAlteracaoUsuario({ atual, alteracao: { ativo: false }, outrosAdministradoresAtivos: outros });
      if (r.ok) await repo.atualizarUsuario(tx, alvoId, { ativo: false }, agora);
      return r;
    };

    await repo.travarAdministradoresAtivos(t1); // t1 segura a trava
    const segundo = alterar(t2, U1); // t2 (inativando U1) espera a trava
    expect(await travada(segundo)).toBe('travada');
    expect(await alterar(t1, U2)).toEqual({ ok: true });
    await t1.confirmar();

    expect(await segundo).toEqual({ ok: false, mensagem: 'A empresa precisa de ao menos um administrador ativo' });
    await t2.confirmar();
    const leitura = abrir();
    expect(await repo.contarAdministradoresAtivos(leitura, randomUUID())).toBe(1);
    expect((await repo.usuarioPorId(leitura, U1))?.ativo).toBe(true);
  });
});
