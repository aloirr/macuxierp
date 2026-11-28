/**
 * v0.3.30, migração 0079 (T-0133): e-mail único entre os usuários de todas as empresas, para o login sem o código da
 * empresa. O superadmin fica fora (decisão A do PO; a 0076 casa usuário e superadmin pelo mesmo e-mail). Dados fictícios.
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
  falhaDetalhada,
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const SQL_0079 = readFileSync(
  fileURLToPath(new URL('../migrations/0079_plataforma_email_global.sql', import.meta.url)),
  'utf8',
);
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000079';
const SA_EMAIL = 'sa-0079@plataforma.teste';
const CONTA = 'plataforma.conta_por_email(text)';
const LIVRE = 'plataforma.exigir_email_livre(text)';

const A = novoTenant('email-0079-a');
const B = novoTenant('email-0079-b');
const C = novoTenant('email-0079-c'); // sem administrador: para o 1º admin

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — e-mail único no sistema todo (v0.3.30, 0079, T-0133)',
  () => {
    let banco: BancoDeTeste;
    let s: string;

    const recusa = (sql: string, codigo: string, padrao: RegExp): void =>
      recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: 'macuxierp_config' });
    const conta = (email: string): Record<string, unknown>[] =>
      consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT * FROM plataforma.conta_por_email('${email}')`,
      );
    const criarSql = (tenant: string, email: string): string =>
      `SELECT plataforma.empresa_usuario_criar('${tenant}', '${email}', 'Pessoa Ficticia', 'vendedor', '${HASH}', '{}', NULL);`;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      s = randomUUID();
      executar(
        banco.conexao,
        `${fixturePlataforma(A)}${fixturePlataforma(B)}
INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ('${C.id}', '${C.id}', '${C.slug}', 'Empresa ${C.slug}');
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', '${SA_EMAIL}', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${s}', '${SA}', encode(sha256(convert_to('${s}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
    });

    afterAll(() => banco?.remover());

    it('privilégios: conta_por_email só do app; exigir_email_livre sem EXECUTE; definer e search_path fixo', () => {
      for (const f of [CONTA, LIVRE]) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
           has_function_privilege('macuxierp_config', p.oid, 'EXECUTE') AS config,
           has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
        );
        expect({ f, ...r }).toEqual({
          f,
          definer: true,
          cfg: 'search_path=pg_catalog, pg_temp',
          comentado: true,
          app: f === CONTA,
          config: false,
          leitura: false,
        });
      }
    });

    it('e-mail repetido entre empresas: INSERT do app, criar do portal e 1º admin recusam (23505); excluído libera', () => {
      const email = `adm@${A.slug}.teste`;
      recusaDetalhada(
        banco.conexao,
        `INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil)
         VALUES ('${B.id}', '${email}', 'Outro Ficticio', '${HASH}', 'vendedor');`,
        '23505',
        /usuario_email_global_uq/,
      );
      recusa(criarSql(B.id, email), '23505', /email_em_uso/);
      recusa(
        `SELECT plataforma.empresa_primeiro_admin_criar('${C.id}', '${email.toUpperCase()}', 'Admin Ficticio', '${HASH}', NULL);`,
        '23505',
        /email_em_uso/,
      );
      // O superadmin não conta: o mesmo e-mail dele pode ser usuário (0076).
      const [u] = linhas(
        rodarComo(banco.conexao, `${sessaoSql(s)}${criarSql(B.id, SA_EMAIL)}`, { papel: 'macuxierp_config' }),
      );
      expect(u).toContain('"perfil": "vendedor"');
      // Excluído libera o e-mail para outra empresa.
      executar(
        banco.conexao,
        `UPDATE plataforma.usuario SET deleted_at = now() WHERE email = '${SA_EMAIL}';`,
      );
      expect(
        linhas(
          rodarComo(
            banco.conexao,
            `${sessaoSql(s)}SELECT plataforma.empresa_primeiro_admin_criar('${C.id}', '${SA_EMAIL}', 'Admin Ficticio', '${HASH}', NULL);`,
            { papel: 'macuxierp_config' },
          ),
        )[0],
      ).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('conta_por_email (ADR 0021): usuário antes do superadmin, só tipo, tenant e suspensa; encerrada sem linha; normaliza', () => {
      expect(conta(` ADM@${A.slug.toUpperCase()}.TESTE `)).toEqual([
        { tipo: 'usuario', tenant_id: A.id, suspensa: false },
      ]);
      expect(conta(SA_EMAIL)).toEqual([
        { tipo: 'usuario', tenant_id: C.id, suspensa: false },
        { tipo: 'superadmin', tenant_id: null, suspensa: false },
      ]);
      expect(conta('ninguem@nada.teste')).toEqual([]);
      // Suspensa = true; encerrada não devolve linha (ADR 0021).
      executar(banco.conexao, `UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${A.id}';`);
      expect(conta(`adm@${A.slug}.teste`)).toEqual([{ tipo: 'usuario', tenant_id: A.id, suspensa: true }]);
      executar(banco.conexao, `UPDATE plataforma.tenant SET situacao = 'encerrado' WHERE id = '${A.id}';`);
      expect(conta(`adm@${A.slug}.teste`)).toEqual([]);
      executar(banco.conexao, `UPDATE plataforma.tenant SET situacao = 'ativo' WHERE id = '${A.id}';`);
      const [def] = consultar<{ colunas: string }>(
        banco.conexao,
        `SELECT pg_get_function_result('${CONTA}'::regprocedure) AS colunas`,
      );
      expect(def?.colunas).toBe('TABLE(tipo text, tenant_id uuid, suspensa boolean)');
    });

    it('a checagem aborta sem mudar nada quando há e-mail repetido, e só mostra a contagem', () => {
      // Simula o banco antes da 0079, numa transação desfeita.
      const { saida } = falhaDetalhada(() =>
        rodarScript(
          banco.conexao,
          `BEGIN;
DROP INDEX plataforma.usuario_email_global_uq;
INSERT INTO plataforma.usuario (tenant_id, email, nome, senha_hash, perfil)
  VALUES ('${B.id}', 'adm@${A.slug}.teste', 'Repetido Ficticio', '${HASH}', 'vendedor');
${SQL_0079}
ROLLBACK;`,
        ),
      );
      expect(saida).toMatch(
        /0079: 1 e-mail\(s\) repetido\(s\) entre empresas, em 2 usuário\(s\); nada foi alterado/,
      );
      expect(saida).not.toContain(`adm@${A.slug}`);
      const [r] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'usuario_email_global_uq'`,
      );
      expect(r?.n).toBe(1);
    });

    it('a 0079 reexecuta sem erro, com o índice global e sem o da 0078', () => {
      rodarScript(banco.conexao, SQL_0079, { transacao: true });
      rodarScript(banco.conexao, SQL_0079, { transacao: true });
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT (SELECT indexdef FROM pg_indexes WHERE indexname = 'usuario_email_global_uq') AS global,
         (SELECT count(*)::int FROM pg_indexes WHERE indexname = 'usuario_email_vivo_uq') AS vivo`,
      );
      expect(r?.global).toMatch(/UNIQUE INDEX .* \(email\) WHERE \(deleted_at IS NULL\)/);
      expect(r?.vivo).toBe(0);
    });
  },
);
