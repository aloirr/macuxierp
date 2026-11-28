/**
 * v0.3.31, migração 0081 (T-0135, RN-CORE-01): a guarda do último administrador (plataforma.exigir_outro_admin, 0078)
 * trava a empresa antes de contar os administradores ativos. Duas transações simultâneas, cada uma tirando um dos dois
 * últimos administradores: exatamente uma recebe MXU01. Antes da 0081, a guarda chamada sem a trava do tenant deixava
 * as duas passarem (a empresa ficava sem administrador). Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { rodarScriptAssincrono } from '../src/psql.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  PG_DISPONIVEL,
  type PastaDeMigracoes,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  rodarScript,
} from './apoio.ts';
import { fixturePlataforma, novoTenant, type Tenant } from './fixture.ts';

const SQL_0081 = readFileSync(
  fileURLToPath(new URL('../migrations/0081_plataforma_ultimo_admin_trava.sql', import.meta.url)),
  'utf8',
);
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000081';

/** Uma empresa com exatamente dois administradores ativos: o da fixture e o segundo, criado aqui. */
interface Empresa {
  t: Tenant;
  outro: string;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const motivo = (r: PromiseSettledResult<string>): string =>
  r.status === 'rejected' ? String((r.reason as Error).message) : 'ok';

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — trava do último administrador (0081, RN-CORE-01)', () => {
  let banco: BancoDeTeste;
  let anteriores: PastaDeMigracoes;
  let s: string;
  let n = 0;

  const novaEmpresa = (): Empresa => {
    n += 1;
    const t = novoTenant(`trava-0081-${n}`);
    const outro = randomUUID();
    executar(
      banco.conexao,
      `${fixturePlataforma(t)}
INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil)
  VALUES ('${outro}', '${t.id}', 'adm2@${t.slug}.teste', 'Administrador Dois', '${HASH}', 'administrador');`,
    );
    return { t, outro };
  };
  const adminsAtivos = (e: Empresa): number =>
    consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM plataforma.usuario
        WHERE tenant_id = '${e.t.id}' AND perfil = 'administrador' AND ativo AND deleted_at IS NULL`,
    )[0]?.n ?? -1;

  /** A primeira entra, grava e segura 1 s; a segunda entra 300 ms depois, com a primeira ainda aberta. */
  const corrida = async (primeira: string, segunda: string): Promise<PromiseSettledResult<string>[]> => {
    const p1 = rodarScriptAssincrono(banco.conexao, `${primeira}\nSELECT pg_sleep(1);\nCOMMIT;\n`);
    await esperar(300);
    const p2 = rodarScriptAssincrono(banco.conexao, `${segunda}\nCOMMIT;\n`);
    return Promise.allSettled([p1, p2]);
  };
  /** A guarda direto, sem passar pelo empresa_alvo (sem a trava do tenant): trava o usuário, confere e inativa. */
  const pelaGuarda = (e: Empresa, usuario: string): string => `BEGIN;
SELECT 1 FROM plataforma.usuario WHERE id = '${usuario}' FOR UPDATE;
SELECT plataforma.exigir_outro_admin('${e.t.id}', '${usuario}');
UPDATE plataforma.usuario SET ativo = false WHERE id = '${usuario}';`;
  /** O caminho do portal /config, como o superadmin. */
  const peloPortal = (e: Empresa, sql: string): string => `SET ROLE ${CONFIG};
BEGIN;
SET LOCAL macuxierp.sessao_superadmin = '${s}';
${sql.replace(/:t/g, `'${e.t.id}'`)}`;
  const exatamenteUmaRecusa = (r: PromiseSettledResult<string>[]): void => {
    const motivos = r.map(motivo);
    expect(motivos.filter((m) => m === 'ok')).toHaveLength(1);
    expect(motivos.filter((m) => m !== 'ok')).toEqual([expect.stringMatching(/último administrador ativo/)]);
  };

  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0081');
    migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false });
    permitirSetRole(banco.conexao);
  });

  afterAll(() => {
    anteriores?.remover();
    banco?.remover();
  });

  it('antes da 0081: a guarda sem a trava do tenant deixa as duas passarem (a empresa fica sem administrador)', async () => {
    const e = novaEmpresa();
    const r = await corrida(pelaGuarda(e, e.t.usuario), pelaGuarda(e, e.outro));
    expect(r.map(motivo)).toEqual(['ok', 'ok']);
    expect(adminsAtivos(e)).toBe(0);
  });

  it('com a 0081: a guarda é VOLATILE, trava por empresa e, na corrida direta, exatamente uma recebe MXU01', async () => {
    migrar(banco.conexao, { oficiais: false });
    executar(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
         VALUES ('${SA}', 'sa-0081@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);`,
    );
    s = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
         VALUES ('${s}', '${SA}', encode(sha256(convert_to('${s}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    const [d] = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT p.provolatile AS vol, p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
         obj_description(p.oid, 'pg_proc') LIKE '%0081%' AS comentado,
         has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
         has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
       FROM pg_proc p WHERE p.oid = 'plataforma.exigir_outro_admin(uuid, uuid)'::regprocedure`,
    );
    expect(d).toEqual({
      vol: 'v',
      definer: true,
      cfg: 'search_path=pg_catalog, pg_temp',
      comentado: true,
      app: false,
      config: false,
    });
    const e = novaEmpresa();
    exatamenteUmaRecusa(await corrida(pelaGuarda(e, e.t.usuario), pelaGuarda(e, e.outro)));
    expect(adminsAtivos(e)).toBe(1);
  });

  it('portal: dois superadmins inativando os dois últimos administradores ao mesmo tempo: exatamente um MXU01', async () => {
    const e = novaEmpresa();
    exatamenteUmaRecusa(
      await corrida(
        peloPortal(e, `SELECT plataforma.empresa_usuario_inativar(:t, '${e.t.usuario}', '${randomUUID()}');`),
        peloPortal(e, `SELECT plataforma.empresa_usuario_inativar(:t, '${e.outro}', '${randomUUID()}');`),
      ),
    );
    expect(adminsAtivos(e)).toBe(1);
  });

  it('portal: excluir contra inativar e rebaixar contra excluir: exatamente um MXU01, sobra um administrador', async () => {
    const e1 = novaEmpresa();
    exatamenteUmaRecusa(
      await corrida(
        peloPortal(
          e1,
          `SELECT plataforma.empresa_usuario_excluir(:t, '${e1.t.usuario}', '${randomUUID()}');`,
        ),
        peloPortal(e1, `SELECT plataforma.empresa_usuario_inativar(:t, '${e1.outro}', '${randomUUID()}');`),
      ),
    );
    expect(adminsAtivos(e1)).toBe(1);
    const e2 = novaEmpresa();
    exatamenteUmaRecusa(
      await corrida(
        peloPortal(
          e2,
          `SELECT plataforma.empresa_usuario_editar(:t, '${e2.t.usuario}', '{"perfil": "gerente"}', NULL);`,
        ),
        peloPortal(e2, `SELECT plataforma.empresa_usuario_excluir(:t, '${e2.outro}', '${randomUUID()}');`),
      ),
    );
    expect(adminsAtivos(e2)).toBe(1);
  });

  it('empresas diferentes não se esperam: as duas passam, cada uma com outro administrador', async () => {
    const e1 = novaEmpresa();
    const e2 = novaEmpresa();
    const r = await corrida(pelaGuarda(e1, e1.t.usuario), pelaGuarda(e2, e2.t.usuario));
    expect(r.map(motivo)).toEqual(['ok', 'ok']);
    expect([adminsAtivos(e1), adminsAtivos(e2)]).toEqual([1, 1]);
  });

  it('a 0081 reexecuta sem erro e mantém a guarda', () => {
    rodarScript(banco.conexao, SQL_0081, { transacao: true });
    rodarScript(banco.conexao, SQL_0081, { transacao: true });
    const e = novaEmpresa();
    executar(banco.conexao, `UPDATE plataforma.usuario SET ativo = false WHERE id = '${e.outro}';`);
    expect(() =>
      executar(banco.conexao, `SELECT plataforma.exigir_outro_admin('${e.t.id}', '${e.t.usuario}');`),
    ).toThrow(/último administrador ativo/);
  });
});
