/**
 * T-0052, migração 0036: troca obrigatória da senha provisória (ADR 0012; decisão do Alexandre de 23/11/2026, ~09h55
 * de Manaus). Coluna plataforma.usuario.deve_trocar_senha, leitura do worker e da leitura, UPDATE do app no próprio
 * tenant e as duas funções do 1º administrador do portal /config gravando true.
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
  PG_DISPONIVEL,
  permitirSetRole,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0036_usuario_deve_trocar_senha.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const SENHA = 'plataforma.empresa_primeiro_admin_senha(uuid, text, text)';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const HASH_NOVO = '$argon2id$v=19$m=65536,t=3,p=4$bm92b3NhbHQ$bm92b2hhc2g';
const SA = '5a000000-0000-4000-8000-000000000036';

/** A e B: tenants com usuário da fixture (inserido sem a coluna nova); E: empresa sem administrador. Dados fictícios. */
const A = novoTenant('senha-0036-a');
const B = novoTenant('senha-0036-b');
const E = randomUUID();

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — troca obrigatória da senha provisória (T-0052, 0036)',
  () => {
    let banco: BancoDeTeste;

    const comoConfig = (sessao: string, sql: string): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }));
    const novaSessao = (): string => {
      const id = randomUUID();
      executar(
        banco.conexao,
        `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ('${id}', '${SA}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
      return id;
    };
    const deveTrocar = (usuario: string): unknown =>
      consultar<{ d: unknown }>(
        banco.conexao,
        `SELECT deve_trocar_senha AS d FROM plataforma.usuario WHERE id = '${usuario}'`,
      )[0]?.d;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        `${fixturePlataforma(A)}${fixturePlataforma(B)}
INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ('${E}', '${E}', 'senha-0036-e', 'Empresa senha-0036-e');
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${E}', 'core');
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0036@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);`,
      );
    });

    afterAll(() => banco?.remover());

    it('coluna boolean NOT NULL DEFAULT false, comentada; usuário inserido sem a coluna fica false', () => {
      const [col] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT data_type, is_nullable, column_default,
         col_description('plataforma.usuario'::regclass, ordinal_position::int) IS NOT NULL AS comentada
       FROM information_schema.columns
       WHERE table_schema = 'plataforma' AND table_name = 'usuario' AND column_name = 'deve_trocar_senha'`,
      );
      expect(col).toEqual({
        data_type: 'boolean',
        is_nullable: 'NO',
        column_default: 'false',
        comentada: true,
      });
      expect(deveTrocar(A.usuario)).toBe(false);
      expect(deveTrocar(B.usuario)).toBe(false);
    });

    it('empresa_primeiro_admin_criar grava deve_trocar_senha = true', () => {
      const s = novaSessao();
      const [admin] = comoConfig(
        s,
        `SELECT plataforma.empresa_primeiro_admin_criar('${E}', 'dono@senha-0036-e.teste', 'Dono Ficticio', '${HASH}', 'req-criar');`,
      );
      expect(admin).toMatch(/^[0-9a-f-]{36}$/);
      expect(deveTrocar(admin as string)).toBe(true);
    });

    it('empresa_primeiro_admin_senha grava true, inclusive depois de o campo ter sido zerado', () => {
      executar(
        banco.conexao,
        `UPDATE plataforma.usuario SET deve_trocar_senha = false WHERE tenant_id = '${E}';`,
      );
      const s = novaSessao();
      const [admin] = comoConfig(
        s,
        `SELECT plataforma.empresa_primeiro_admin_senha('${E}', '${HASH_NOVO}', 'req-senha');`,
      );
      expect(deveTrocar(admin as string)).toBe(true);
      // Prepara A = true para os testes de leitura e de UPDATE do app.
      expect(
        comoConfig(
          s,
          `SELECT plataforma.empresa_primeiro_admin_senha('${A.id}', '${HASH_NOVO}', 'req-senha-a');`,
        ),
      ).toEqual([A.usuario]);
      expect(deveTrocar(A.usuario)).toBe(true);
      expect(deveTrocar(B.usuario)).toBe(false);
    });

    it('worker e leitura leem a coluna (sem o hash da senha)', () => {
      for (const papel of ['macuxierp_worker', 'macuxierp_leitura']) {
        const [r] = consultar<Record<string, unknown>>(
          banco.conexao,
          `SELECT has_column_privilege('${papel}', 'plataforma.usuario', 'deve_trocar_senha', 'SELECT') AS le,
           has_column_privilege('${papel}', 'plataforma.usuario', 'deve_trocar_senha', 'UPDATE') AS altera,
           has_column_privilege('${papel}', 'plataforma.usuario', 'senha_hash', 'SELECT') AS hash`,
        );
        expect(r).toEqual({ le: true, altera: false, hash: false });
      }
      const [r] = consultar<{ deve_trocar_senha: boolean }>(
        banco.conexao,
        `SELECT deve_trocar_senha FROM plataforma.usuario WHERE id = '${A.usuario}'`,
        { papel: 'macuxierp_worker', tenant: A.id },
      );
      expect(r).toEqual({ deve_trocar_senha: true });
    });

    it('o app zera a coluna no próprio tenant; o de outro tenant não é alcançado', () => {
      const saida = linhas(
        rodarComo(
          banco.conexao,
          `UPDATE plataforma.usuario SET deve_trocar_senha = false WHERE id = '${A.usuario}' RETURNING id;
         UPDATE plataforma.usuario SET deve_trocar_senha = true WHERE id = '${B.usuario}' RETURNING id;`,
          { papel: 'macuxierp_app', tenant: A.id },
        ),
      ).filter((l) => /^[0-9a-f-]{36}$/.test(l));
      expect(saida).toEqual([A.usuario]);
      expect(deveTrocar(A.usuario)).toBe(false);
      expect(deveTrocar(B.usuario)).toBe(false);
    });

    it('a 0036 reexecuta duas vezes sem erro e mantém o EXECUTE só do config', () => {
      const sql = readFileSync(MIGRACAO, 'utf8');
      rodarScript(banco.conexao, sql, { transacao: true });
      rodarScript(banco.conexao, sql, { transacao: true });
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT has_function_privilege('${CONFIG}', '${SENHA}', 'EXECUTE') AS config,
         has_function_privilege('macuxierp_app', '${SENHA}', 'EXECUTE') AS app`,
      );
      expect(r).toEqual({ config: true, app: false });
    });
  },
);
