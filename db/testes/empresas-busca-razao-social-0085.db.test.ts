/**
 * v0.3.32, migração 0085: a busca de plataforma.empresas_listar casa também a razão social do core.empresa, lida pela
 * plataforma.empresa_json (a única função de plataforma que lê schema de módulo, emenda da ADR 0012 §4). A busca
 * não vaza entre tenants: cada empresa casa só pela própria razão social. Dados fictícios.
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

const SQL_0085 = readFileSync(
  fileURLToPath(new URL('../migrations/0085_plataforma_empresas_busca_razao_social.sql', import.meta.url)),
  'utf8',
);
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000085';

/**
 * A: razão social "Distribuidora Jaraqui Eireli"; B: "Atacado Pirarucu Ltda", com o nome "Pirarucu" (casa pelo nome
 * e pela razão); C: sem core.empresa; D: empresa excluída (deleted_at), razão "Jaraqui Excluida Ltda"; E: core.empresa
 * excluída (deleted_at), razão "Jaraqui Antiga Ltda".
 */
const A = novoTenant('busca-0085-a');
const B = novoTenant('busca-0085-b');
const C = novoTenant('busca-0085-c');
const D = novoTenant('busca-0085-d');
const E = novoTenant('busca-0085-e');
const TODAS = [A, B, C, D, E].map((t) => t.id);

interface Empresa {
  id: string;
  razao_social: unknown;
  [k: string]: unknown;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — busca pela razão social nas empresas do /config (0085)',
  () => {
    let banco: BancoDeTeste;
    let s: string;

    const comoConfig = (sql: string): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
    const texto = (v: string | null): string => (v === null ? 'NULL' : `'${v}'`);
    const listar = (busca: string | null, cursor: string | null = null, limite = 201): Empresa[] =>
      comoConfig(`SELECT plataforma.empresas_listar(${texto(busca)}, ${texto(cursor)}, ${limite});`).map(
        (l) => JSON.parse(l) as Empresa,
      );
    /** Só as empresas deste arquivo, em ordem de A a E. */
    const achadas = (busca: string | null): string[] => {
      const ids = new Set(listar(busca).map((e) => e.id));
      return TODAS.filter((id) => ids.has(id));
    };

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      s = randomUUID();
      executar(
        banco.conexao,
        `${[A, B, C, D, E].map(fixturePlataforma).join('')}
UPDATE plataforma.tenant SET nome = 'Pirarucu' WHERE id = '${B.id}';
UPDATE plataforma.tenant SET deleted_at = now() WHERE id = '${D.id}';
INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES
  ('${A.id}', 'Distribuidora Jaraqui Eireli', '12345678000195'),
  ('${B.id}', 'Atacado Pirarucu Ltda', '12312312300008'),
  ('${D.id}', 'Jaraqui Excluida Ltda', '32132132100036');
INSERT INTO core.empresa (tenant_id, razao_social, cnpj, deleted_at)
  VALUES ('${E.id}', 'Jaraqui Antiga Ltda', '55566677700088', now());
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0085@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${s}', '${SA}', encode(sha256(convert_to('${s}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
    });

    afterAll(() => banco?.remover());

    it('busca pela razão social: trecho, sem diferença de maiúsculas e sem espaço nas pontas', () => {
      expect(achadas('jaraqui')).toEqual([A.id]);
      expect(achadas(' DISTRIBUIDORA JARAQUI ')).toEqual([A.id]);
      expect(achadas('eireli')).toEqual([A.id]);
      expect(achadas('atacado pirarucu')).toEqual([B.id]);
      expect(listar('jaraqui').find((e) => e.id === A.id)?.razao_social).toBe('Distribuidora Jaraqui Eireli');
    });

    it('sem vazar entre tenants: cada empresa casa só pela própria razão social', () => {
      // "ltda" está na razão de B, de D (empresa excluída) e de E (core.empresa excluída): só B aparece.
      expect(achadas('ltda')).toEqual([B.id]);
      expect(achadas('distribuidora')).toEqual([A.id]);
      expect(achadas('atacado')).toEqual([B.id]);
      expect(achadas('excluida')).toEqual([]);
      expect(achadas('antiga')).toEqual([]);
      // C (sem core.empresa) continua achada pelo slug.
      expect(achadas('busca-0085-c')).toEqual([C.id]);
    });

    it('casar pelo nome e pela razão ao mesmo tempo traz a empresa uma vez só; slug e nome continuam', () => {
      expect(listar('pirarucu').filter((e) => e.id === B.id)).toHaveLength(1);
      expect(achadas('busca-0085')).toEqual([A.id, B.id, C.id, E.id]);
      expect(achadas(null)).toEqual([A.id, B.id, C.id, E.id]);
    });

    it('busca é literal: % e _ não são curinga na razão social', () => {
      expect(achadas('%')).toEqual([]);
      expect(achadas('jaraqui_eireli')).toEqual([]);
      expect(achadas('nada-casa-0085')).toEqual([]);
    });

    it('cursor e limite valem para a busca pela razão social', () => {
      executar(
        banco.conexao,
        `UPDATE core.empresa SET razao_social = 'Atacado Jaraqui Ltda' WHERE tenant_id = '${B.id}';`,
      );
      const [primeiro, segundo] = [A.id, B.id].sort();
      expect(listar('jaraqui', null, 1).map((e) => e.id)).toEqual([primeiro]);
      expect(listar('jaraqui', primeiro ?? null).map((e) => e.id)).toEqual([segundo]);
      executar(
        banco.conexao,
        `UPDATE core.empresa SET razao_social = 'Atacado Pirarucu Ltda' WHERE tenant_id = '${B.id}';`,
      );
    });

    it('só o config executa; a empresas_listar não cita schema de módulo (ADR 0012 §4); a 0085 reexecuta', () => {
      const f = `'plataforma.empresas_listar(text, uuid, integer)'`;
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT has_function_privilege('${CONFIG}', ${f}, 'EXECUTE') AS config,
       has_function_privilege('macuxierp_app', ${f}, 'EXECUTE') AS app,
       has_function_privilege('macuxierp_leitura', ${f}, 'EXECUTE') AS leitura,
       has_function_privilege('macuxierp_worker', ${f}, 'EXECUTE') AS worker,
       (SELECT p.prosecdef AND array_to_string(p.proconfig, ',') = 'search_path=pg_catalog, pg_temp'
               AND obj_description(p.oid, 'pg_proc') LIKE '%0085%'
               AND p.prosrc !~ '(^|[^a-z_])(core|cadastros|pedido|faturamento|fiscal|integracao_fdv|sefaz_simulador)\\.'
          FROM pg_proc p WHERE p.oid = ${f}::regprocedure) AS definicao`,
      );
      expect(r).toEqual({ config: true, app: false, leitura: false, worker: false, definicao: true });
      rodarScript(banco.conexao, SQL_0085, { transacao: true });
      rodarScript(banco.conexao, SQL_0085, { transacao: true });
      expect(achadas('jaraqui')).toEqual([A.id]);
    });
  },
);
