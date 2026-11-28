/**
 * 0076 (v0.3.21, decisão 45 A; ADR 0012 §1 e §4): o /config aberto pelo menu do BKO sem login de novo.
 * - plataforma.superadmin_acesso_pelo_bko(tenant, usuario): o boolean do item "Configuração" (só lê, não audita);
 * - plataforma.superadmin_abrir_sessao_pelo_bko(refresh_hash, token_hash, expira_max): valida a sessão do BKO pelo
 *   hash do refresh, acha o superadmin pelo e-mail normalizado, revoga a sessão do /config aberta antes pela mesma
 *   família do BKO, abre a nova (até 8 h, nunca além do refresh) e audita no tenant de referência;
 * - plataforma.sessao_superadmin.origem_sessao_bko.
 * MXS11 = troca de senha pendente do usuário (TROCAR_SENHA); MXS12 = sem superadmin apto (SEM_ACESSO_CONFIG). Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  PAPEIS_APP,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaCompleta,
  rodarComo,
  rodarScript,
} from './apoio.ts';
import { fixturePlataforma, hashSql, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0076_plataforma_superadmin_pelo_bko.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const ACESSO = 'plataforma.superadmin_acesso_pelo_bko(uuid, uuid)';
const ABRIR = 'plataforma.superadmin_abrir_sessao_pelo_bko(plataforma.sha256_hex, plataforma.sha256_hex, timestamptz)';
const ACAO = 'plataforma.superadmin.entrar_pelo_bko';

const A = novoTenant('sa-0076-a');
const B = novoTenant('sa-0076-b');
const S = novoTenant('sa-0076-s'); // suspenso

// Superadmins: aptos (OK1..OK6) e um por motivo de recusa. Desde a 0079 o e-mail de usuário é único no sistema
// todo, então cada usuário do B e do S tem o seu superadmin apto (ok4..ok6).
const SA = {
  ok1: '5a000000-0000-4000-8000-000000000761',
  ok2: '5a000000-0000-4000-8000-000000000762',
  ok3: '5a000000-0000-4000-8000-000000000763',
  travado: '5a000000-0000-4000-8000-000000000764',
  inativo: '5a000000-0000-4000-8000-000000000765',
  excluido: '5a000000-0000-4000-8000-000000000766',
  troca: '5a000000-0000-4000-8000-000000000767',
  ok4: '5a000000-0000-4000-8000-000000000768',
  ok5: '5a000000-0000-4000-8000-000000000769',
  ok6: '5a000000-0000-4000-8000-00000000076a',
} as const;
const email = (k: string): string => `${k}@sa0076.teste`;

// Usuários do BKO: [id, tenant, e-mail, extra (ativo, deve_trocar_senha, deleted_at)].
const U = {
  ok: randomUUID(),
  teto: randomUUID(),
  travado: randomUUID(),
  saInativo: randomUUID(),
  saExcluido: randomUUID(),
  saTroca: randomUUID(),
  sem: randomUUID(),
  deve: randomUUID(),
  inativo: randomUUID(),
  excluido: randomUUID(),
  reuso: randomUUID(),
  suspenso: randomUUID(),
  maiusc: randomUUID(),
} as const;

const FAMILIA_REUSO = randomUUID();

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — /config pelo BKO (0076, 45 A)', () => {
  let banco: BancoDeTeste;

  const abrirSql = (refresh: string, token: string, expira: string): string =>
    `SELECT superadmin_id, expira_em FROM plataforma.superadmin_abrir_sessao_pelo_bko(${hashSql(refresh)},
       ${hashSql(token)}, ${expira})`;
  const abrir = (refresh: string, token = randomUUID(), expira = "now() + interval '1 hour'") =>
    consultar<{ superadmin_id: string; expira_em: string }>(banco.conexao, abrirSql(refresh, token, expira), {
      papel: CONFIG,
    });
  const recusa = (refresh: string, codigo: string, mensagem: RegExp, expira = "now() + interval '1 hour'"): void =>
    recusaCompleta(
      banco.conexao,
      `${abrirSql(refresh, randomUUID(), expira)};`,
      { codigo, detalhe: undefined, mensagem },
      { papel: CONFIG },
    );
  const acesso = (tenant: string, usuario: string): string[] =>
    linhas(rodarComo(banco.conexao, `SELECT plataforma.superadmin_acesso_pelo_bko('${tenant}', '${usuario}');`, {
      papel: CONFIG,
    }));
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const sessaoBko = (refresh: string): string =>
    um<{ j: string }>(`SELECT to_jsonb(s)::text AS j FROM plataforma.sessao s WHERE refresh_hash = ${hashSql(refresh)}`)
      .j;
  const contaSuperadmin = (sa: string): string =>
    um<{ j: string }>(
      `SELECT jsonb_build_object('falhas', falhas_login, 'trava', bloqueado_ate, 'acesso', ultimo_acesso_em,
         'atualizado', updated_at)::text AS j FROM plataforma.superadmin WHERE id = '${sa}'`,
    ).j;
  const sessoesConfig = (sa: string): number =>
    um<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.sessao_superadmin WHERE superadmin_id = '${sa}'`).n;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    executar(banco.conexao, `${fixturePlataforma(A)}${fixturePlataforma(B)}${fixturePlataforma(S)}`);
    executar(
      banco.conexao,
      `UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${S.id}';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo, falhas_login, bloqueado_ate,
  deleted_at) VALUES
  ('${SA.ok1}', '${email('ok1')}', 'Superadmin Um', '${HASH}', false, true, 2, now() - interval '1 hour', NULL),
  ('${SA.ok2}', '${email('ok2')}', 'Superadmin Dois', '${HASH}', false, true, 0, NULL, NULL),
  ('${SA.ok3}', '${email('ok3')}', 'Superadmin Tres', '${HASH}', false, true, 0, NULL, NULL),
  ('${SA.travado}', '${email('travado')}', 'Superadmin Travado', '${HASH}', false, true, 5,
     now() + interval '15 minutes', NULL),
  ('${SA.inativo}', '${email('inativo')}', 'Superadmin Inativo', '${HASH}', false, false, 0, NULL, NULL),
  ('${SA.excluido}', '${email('excluido')}', 'Superadmin Excluido', '${HASH}', false, true, 0, NULL, now()),
  ('${SA.troca}', '${email('troca')}', 'Superadmin Troca', '${HASH}', true, true, 0, NULL, NULL),
  ('${SA.ok4}', '${email('ok4')}', 'Superadmin Quatro', '${HASH}', false, true, 0, NULL, NULL),
  ('${SA.ok5}', '${email('ok5')}', 'Superadmin Cinco', '${HASH}', false, true, 0, NULL, NULL),
  ('${SA.ok6}', '${email('ok6')}', 'Superadmin Seis', '${HASH}', false, true, 0, NULL, NULL);
INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil, ativo, deve_trocar_senha, deleted_at)
VALUES
  ('${U.ok}', '${A.id}', '${email('ok1')}', 'Usuario Ok', '${HASH}', 'administrador', true, false, NULL),
  ('${U.teto}', '${A.id}', '${email('ok3')}', 'Usuario Teto', '${HASH}', 'gerente', true, false, NULL),
  ('${U.travado}', '${A.id}', '${email('travado')}', 'Usuario Travado', '${HASH}', 'gerente', true, false, NULL),
  ('${U.saInativo}', '${A.id}', '${email('inativo')}', 'Usuario Sa Inativo', '${HASH}', 'gerente', true, false, NULL),
  ('${U.saExcluido}', '${A.id}', '${email('excluido')}', 'Usuario Sa Excluido', '${HASH}', 'gerente', true, false,
     NULL),
  ('${U.saTroca}', '${A.id}', '${email('troca')}', 'Usuario Sa Troca', '${HASH}', 'gerente', true, false, NULL),
  ('${U.sem}', '${A.id}', 'sem@sa0076.teste', 'Usuario Sem', '${HASH}', 'gerente', true, false, NULL),
  ('${U.deve}', '${A.id}', '${email('ok2')}', 'Usuario Deve', '${HASH}', 'gerente', true, true, NULL),
  ('${U.inativo}', '${B.id}', '${email('ok4')}', 'Usuario Inativo', '${HASH}', 'gerente', false, false, NULL),
  ('${U.excluido}', '${B.id}', '${email('ok2')}', 'Usuario Excluido', '${HASH}', 'gerente', true, false, now()),
  ('${U.reuso}', '${B.id}', '${email('ok6')}', 'Usuario Reuso', '${HASH}', 'gerente', true, false, NULL),
  ('${U.suspenso}', '${S.id}', '${email('ok5')}', 'Usuario Suspenso', '${HASH}', 'gerente', true, false, NULL);
INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em, revogada_em, deleted_at) VALUES
  ('${A.id}', '${U.ok}', gen_random_uuid(), ${hashSql('r-ok')}, now() + interval '30 days', NULL, NULL),
  ('${A.id}', '${U.ok}', gen_random_uuid(), ${hashSql('r-vencida')}, now() - interval '1 second', NULL, NULL),
  ('${A.id}', '${U.ok}', gen_random_uuid(), ${hashSql('r-revogada')}, now() + interval '1 day', now(), NULL),
  ('${A.id}', '${U.ok}', gen_random_uuid(), ${hashSql('r-excluida')}, now() + interval '1 day', NULL, now()),
  ('${A.id}', '${U.ok}', gen_random_uuid(), ${hashSql('r-curta')}, now() + interval '2 hours', NULL, NULL),
  ('${A.id}', '${U.teto}', gen_random_uuid(), ${hashSql('r-teto')}, now() + interval '30 days', NULL, NULL),
  ('${A.id}', '${U.travado}', gen_random_uuid(), ${hashSql('r-travado')}, now() + interval '1 day', NULL, NULL),
  ('${A.id}', '${U.saInativo}', gen_random_uuid(), ${hashSql('r-sa-inativo')}, now() + interval '1 day', NULL, NULL),
  ('${A.id}', '${U.saExcluido}', gen_random_uuid(), ${hashSql('r-sa-excluido')}, now() + interval '1 day', NULL,
     NULL),
  ('${A.id}', '${U.saTroca}', gen_random_uuid(), ${hashSql('r-sa-troca')}, now() + interval '1 day', NULL, NULL),
  ('${A.id}', '${U.sem}', gen_random_uuid(), ${hashSql('r-sem')}, now() + interval '1 day', NULL, NULL),
  ('${A.id}', '${U.deve}', gen_random_uuid(), ${hashSql('r-deve')}, now() + interval '1 day', NULL, NULL),
  ('${B.id}', '${U.inativo}', gen_random_uuid(), ${hashSql('r-inativo')}, now() + interval '1 day', NULL, NULL),
  ('${B.id}', '${U.excluido}', gen_random_uuid(), ${hashSql('r-excluido')}, now() + interval '1 day', NULL, NULL),
  ('${B.id}', '${U.reuso}', '${FAMILIA_REUSO}', ${hashSql('r-reuso')}, now() + interval '30 days', NULL, NULL),
  ('${S.id}', '${U.suspenso}', gen_random_uuid(), ${hashSql('r-suspenso')}, now() + interval '1 day', NULL, NULL);`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) sessão do BKO inexistente, vencida, revogada ou excluída: nenhuma linha e nada gravado', () => {
    for (const r of ['r-nao-existe', 'r-vencida', 'r-revogada', 'r-excluida']) {
      expect({ r, linhas: abrir(r) }).toEqual({ r, linhas: [] });
    }
    expect(sessoesConfig(SA.ok1)).toBe(0);
  });

  it('(b) tenant suspenso, usuário inativo e usuário excluído: nenhuma linha', () => {
    for (const r of ['r-suspenso', 'r-inativo', 'r-excluido']) {
      expect({ r, linhas: abrir(r) }).toEqual({ r, linhas: [] });
    }
    const aptos = [SA.ok1, SA.ok2, SA.ok4, SA.ok5];
    expect(aptos.reduce((n, sa) => n + sessoesConfig(sa), 0)).toBe(0);
  });

  it('(c) usuário com troca de senha pendente: MXS11, mesmo com superadmin apto no e-mail', () => {
    recusa('r-deve', 'MXS11', /MXS11: troca de senha pendente no ERP$/);
    expect(sessoesConfig(SA.ok2)).toBe(0);
  });

  it('(d) superadmin travado, inativo, excluído, com troca pendente ou inexistente: MXS12, nada gravado', () => {
    const antes = contaSuperadmin(SA.travado);
    for (const r of ['r-travado', 'r-sa-inativo', 'r-sa-excluido', 'r-sa-troca', 'r-sem']) {
      recusa(r, 'MXS12', /MXS12: sem acesso ao \/config$/);
    }
    expect(contaSuperadmin(SA.travado)).toBe(antes);
    for (const sa of [SA.travado, SA.inativo, SA.excluido, SA.troca]) expect(sessoesConfig(sa)).toBe(0);
  });

  it('(e) abre a sessão com origem_sessao_bko; o BKO, falhas, trava e ultimo_acesso_em não mudam', () => {
    const bkoAntes = sessaoBko('r-ok');
    const contaAntes = contaSuperadmin(SA.ok1);
    const token = randomUUID();
    expect(abrir('r-ok', token).map((l) => l.superadmin_id)).toEqual([SA.ok1]);
    expect(sessaoBko('r-ok')).toBe(bkoAntes);
    expect(contaSuperadmin(SA.ok1)).toBe(contaAntes);
    const sessao = um<Record<string, unknown>>(
      `SELECT x.origem_sessao_bko = b.id AS origem, x.revogada_em IS NULL AS aberta, x.tenant_id::text AS tenant
       FROM plataforma.sessao_superadmin x JOIN plataforma.sessao b ON b.refresh_hash = ${hashSql('r-ok')}
       WHERE x.token_hash = ${hashSql(token)}`,
    );
    expect(sessao).toEqual({ origem: true, aberta: true, tenant: REFERENCIA });
    // A sessão nova vale na validação de sempre (0033).
    expect(
      linhas(
        rodarComo(
          banco.conexao,
          `SELECT superadmin_id FROM plataforma.superadmin_sessao_por_token(${hashSql(token)});`,
          { papel: CONFIG },
        ),
      ),
    ).toEqual([SA.ok1]);
  });

  it('(f) auditoria: uma linha no tenant de referência, autor superadmin, sem e-mail nem hash', () => {
    const token = randomUUID();
    abrir('r-teto', token);
    const r = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT a.tenant_id::text AS tenant, a.usuario_id, a.superadmin_id::text AS sa, a.entidade, a.antes,
         a.depois = jsonb_build_object('tenant_origem', '${A.id}', 'usuario_id', '${U.teto}', 'sessao_bko_id', b.id)
           AS depois,
         position('@' IN a.depois::text) = 0 AND position(${hashSql('r-teto')} IN a.depois::text) = 0
           AND position(${hashSql(token)} IN a.depois::text) = 0 AS limpo
       FROM plataforma.auditoria a JOIN plataforma.sessao b ON b.refresh_hash = ${hashSql('r-teto')}
       WHERE a.acao = '${ACAO}' AND a.superadmin_id = '${SA.ok3}'`,
    );
    expect(r).toEqual([
      { tenant: REFERENCIA, usuario_id: null, sa: SA.ok3, entidade: 'superadmin', antes: null, depois: true, limpo: true },
    ]);
    expect(
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao = '${ACAO}' AND tenant_id <> '${REFERENCIA}'`,
      ).n,
    ).toBe(0);
  });

  it('(g) validade: teto de 8 h, p_expira_max menor, refresh menor; vencida ou nula = 23514', () => {
    const [teto] = abrir('r-ok', randomUUID(), "now() + interval '30 hours'");
    const r = um<Record<string, boolean>>(
      `SELECT '${teto?.expira_em}'::timestamptz <= now() + interval '8 hours'
         AND '${teto?.expira_em}'::timestamptz > now() + interval '7 hours 59 minutes' AS teto`,
    );
    expect(r).toEqual({ teto: true });
    const max = new Date(Date.now() + 3_600_000).toISOString();
    const [menor] = abrir('r-ok', randomUUID(), `'${max}'::timestamptz`);
    expect(um<{ ok: boolean }>(`SELECT '${menor?.expira_em}'::timestamptz = '${max}'::timestamptz AS ok`).ok).toBe(
      true,
    );
    const [curta] = abrir('r-curta', randomUUID(), "now() + interval '8 hours'");
    expect(
      um<{ ok: boolean }>(
        `SELECT '${curta?.expira_em}'::timestamptz = expira_em AS ok FROM plataforma.sessao
         WHERE refresh_hash = ${hashSql('r-curta')}`,
      ).ok,
    ).toBe(true);
    recusa('r-ok', '23514', /validade da sessão/, "now() - interval '1 second'");
    recusa('r-ok', '23514', /validade da sessão/, 'NULL');
  });

  it('(h) reuso: a segunda chamada do mesmo refresh (e a da rotação, mesma família) revoga a anterior', () => {
    const abertas = (): string[] =>
      consultar<{ t: string }>(
        banco.conexao,
        `SELECT token_hash AS t FROM plataforma.sessao_superadmin
         WHERE superadmin_id = '${SA.ok6}' AND origem_sessao_bko IS NOT NULL AND revogada_em IS NULL
           AND origem_sessao_bko IN (SELECT id FROM plataforma.sessao WHERE familia = '${FAMILIA_REUSO}')`,
      ).map((l) => l.t);
    const hash = (t: string): string => um<{ h: string }>(`SELECT ${hashSql(t)} AS h`).h;
    const t1 = randomUUID();
    const t2 = randomUUID();
    const t3 = randomUUID();
    abrir('r-reuso', t1);
    expect(abertas()).toEqual([hash(t1)]);
    abrir('r-reuso', t2);
    expect(abertas()).toEqual([hash(t2)]);
    // Rotação do refresh do BKO: a linha velha revogada, a nova na mesma família.
    executar(
      banco.conexao,
      `UPDATE plataforma.sessao SET revogada_em = now() WHERE refresh_hash = ${hashSql('r-reuso')};
       INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em)
       VALUES ('${B.id}', '${U.reuso}', '${FAMILIA_REUSO}', ${hashSql('r-reuso-2')}, now() + interval '30 days');`,
    );
    expect(abrir('r-reuso')).toEqual([]); // o refresh velho já não abre
    abrir('r-reuso-2', t3);
    expect(abertas()).toEqual([hash(t3)]);
  });

  it('(i) token repetido: 23505 natural', () => {
    const token = randomUUID();
    abrir('r-ok', token);
    recusaCompleta(
      banco.conexao,
      `${abrirSql('r-ok', token, "now() + interval '1 hour'")};`,
      { codigo: '23505', detalhe: 'Key', mensagem: /sessao_superadmin_token_hash_key/ },
      { papel: CONFIG },
    );
  });

  it('(j) superadmin_acesso_pelo_bko: true só com superadmin apto e usuário não excluído do tenant', () => {
    const casos: [string, string, string, string][] = [
      ['apto', A.id, U.ok, 't'],
      ['superadmin travado', A.id, U.travado, 'f'],
      ['superadmin inativo', A.id, U.saInativo, 'f'],
      ['superadmin excluído', A.id, U.saExcluido, 'f'],
      ['superadmin com troca', A.id, U.saTroca, 'f'],
      ['sem superadmin', A.id, U.sem, 'f'],
      ['usuário excluído', B.id, U.excluido, 'f'],
      ['tenant errado', B.id, U.ok, 'f'],
      ['usuário inexistente', A.id, randomUUID(), 'f'],
    ];
    for (const [caso, tenant, usuario, esperado] of casos) {
      expect({ caso, r: acesso(tenant, usuario) }).toEqual({ caso, r: [esperado] });
    }
    expect(
      um<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE acao LIKE '%pelo_bko%'
        AND superadmin_id = '${SA.travado}'`).n,
    ).toBe(0);
  });

  it('(k) e-mail do usuário com maiúsculas e espaços casa com o superadmin (sem o CHECK, numa transação desfeita)', () => {
    const { conname } = um<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'plataforma.usuario'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%lower(btrim(email))%'`,
    );
    const saida = rodarScript(
      banco.conexao,
      `BEGIN;
ALTER TABLE plataforma.usuario DROP CONSTRAINT ${conname};
INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil)
  VALUES ('${U.maiusc}', '${A.id}', '  OK1@Sa0076.TESTE ', 'Usuario Maiusc', '${HASH}', 'gerente');
INSERT INTO plataforma.sessao (tenant_id, usuario_id, familia, refresh_hash, expira_em)
  VALUES ('${A.id}', '${U.maiusc}', gen_random_uuid(), ${hashSql('r-maiusc')}, now() + interval '1 day');
SET LOCAL ROLE ${CONFIG};
SELECT plataforma.superadmin_acesso_pelo_bko('${A.id}', '${U.maiusc}');
SELECT superadmin_id FROM plataforma.superadmin_abrir_sessao_pelo_bko(${hashSql('r-maiusc')}, ${hashSql(randomUUID())},
  now() + interval '1 hour');
ROLLBACK;`,
    );
    expect(linhas(saida)).toEqual(['t', SA.ok1]);
  });

  it('(l) DEFINER, search_path, COMMENT; EXECUTE só do config; PUBLIC, app, worker e leitura sem acesso', () => {
    for (const f of [ACESSO, ABRIR]) {
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT p.prosecdef AS definer, p.provolatile AS vol, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') LIKE '%0076%' AS comentado,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
             AS publico,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
      );
      expect({ f, ...r }).toEqual({
        f,
        definer: true,
        vol: f === ACESSO ? 's' : 'v',
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        config: true,
      });
      for (const papel of PAPEIS_APP) {
        const [p] = consultar<{ pode: boolean }>(
          banco.conexao,
          `SELECT has_function_privilege('${papel}', '${f}', 'EXECUTE') AS pode`,
        );
        expect({ f, papel, ...p }).toEqual({ f, papel, pode: false });
      }
    }
    for (const sql of [
      `${abrirSql('r-ok', randomUUID(), "now() + interval '1 hour'")};`,
      `SELECT plataforma.superadmin_acesso_pelo_bko('${A.id}', '${U.ok}');`,
    ]) {
      recusaCompleta(
        banco.conexao,
        sql,
        { codigo: '42501', detalhe: undefined, mensagem: /permission denied/ },
        { papel: 'macuxierp_app', tenant: A.id },
      );
    }
  });

  it('(m) coluna origem_sessao_bko: uuid, nula, sem FK, com COMMENT', () => {
    const r = um<Record<string, unknown>>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS tipo, NOT a.attnotnull AS nula,
         col_description(a.attrelid, a.attnum) LIKE '%0076%' AS comentada,
         (SELECT count(*)::int FROM pg_constraint c WHERE c.conrelid = a.attrelid AND c.contype = 'f'
            AND a.attnum = ANY (c.conkey)) AS fks
       FROM pg_attribute a WHERE a.attrelid = 'plataforma.sessao_superadmin'::regclass
         AND a.attname = 'origem_sessao_bko'`,
    );
    expect(r).toEqual({ tipo: 'uuid', nula: true, comentada: true, fks: 0 });
  });

  it('(n) a 0076 reexecuta duas vezes sem erro, sem duplicar função e sem mudar privilégio', () => {
    const sql = readFileSync(MIGRACAO, 'utf8');
    rodarScript(banco.conexao, sql, { transacao: true });
    rodarScript(banco.conexao, sql, { transacao: true });
    const [r] = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                AND proname IN ('superadmin_acesso_pelo_bko', 'superadmin_abrir_sessao_pelo_bko')) AS n,
         has_function_privilege('${CONFIG}', '${ABRIR}', 'EXECUTE') AS config,
         has_function_privilege('public', '${ABRIR}', 'EXECUTE') AS publico`,
    );
    expect(r).toEqual({ n: 2, config: true, publico: false });
  });
});
