/**
 * v0.3.31, migração 0080 (T-0134): a busca de plataforma.empresas_listar casa também o nome da empresa (além do
 * slug; a razão social entrou depois, na 0085), e plataforma.empresa_json devolve tem_fdv (integracao-fdv licenciado e
 * ativo). Dados fictícios.
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

const SQL_0080 = readFileSync(
  fileURLToPath(new URL('../migrations/0080_plataforma_empresas_busca_nome_tem_fdv.sql', import.meta.url)),
  'utf8',
);
const CONFIG = 'macuxierp_config';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000080';

/**
 * A: nome próprio e core.empresa, integracao-fdv ativo; B: integracao-fdv com ativo = false; C: licença vencida;
 * D: licença excluída; E: sem a linha do integracao-fdv.
 */
const A = novoTenant('busca-0080-a');
const B = novoTenant('busca-0080-b');
const C = novoTenant('busca-0080-c');
const D = novoTenant('busca-0080-d');
const E = novoTenant('busca-0080-e');
const TODAS = [A, B, C, D, E].map((t) => t.id);

interface Empresa {
  id: string;
  tem_fdv: unknown;
  [k: string]: unknown;
}

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — busca por nome e tem_fdv nas empresas do /config (0080)',
  () => {
    let banco: BancoDeTeste;
    let s: string;

    const comoConfig = (sql: string): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
    const listar = (busca: string | null): Empresa[] =>
      comoConfig(
        `SELECT plataforma.empresas_listar(${busca === null ? 'NULL' : `'${busca}'`}, NULL, 201);`,
      ).map((l) => JSON.parse(l) as Empresa);
    /** Só as empresas deste arquivo, em ordem de A a E. */
    const achadas = (busca: string | null): string[] => {
      const ids = new Set(listar(busca).map((e) => e.id));
      return TODAS.filter((id) => ids.has(id));
    };
    const ler = (id: string): Empresa =>
      JSON.parse(comoConfig(`SELECT plataforma.empresa_ler('${id}');`)[0] ?? 'null') as Empresa;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      s = randomUUID();
      executar(
        banco.conexao,
        `${[A, B, C, D, E].map(fixturePlataforma).join('')}
UPDATE plataforma.tenant SET nome = 'Comercial Tucuma Ltda' WHERE id = '${A.id}';
INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ('${A.id}', 'Distribuidora Jaraqui Eireli', '12345678000195');
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo, ativo, valido_ate, deleted_at) VALUES
  ('${A.id}', 'integracao-fdv', true, NULL, NULL),
  ('${B.id}', 'integracao-fdv', false, NULL, NULL),
  ('${C.id}', 'integracao-fdv', true, now() - interval '1 day', NULL),
  ('${D.id}', 'integracao-fdv', true, NULL, now());
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa-0080@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${s}', '${SA}', encode(sha256(convert_to('${s}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
    });

    afterAll(() => banco?.remover());

    it('busca pelo slug continua: trecho, sem diferença de maiúsculas e sem espaço nas pontas', () => {
      expect(achadas('busca-0080')).toEqual(TODAS);
      expect(achadas(' BUSCA-0080-C ')).toEqual([C.id]);
      expect(achadas(null)).toEqual(TODAS);
      expect(achadas('   ')).toEqual(TODAS);
    });

    it('busca pelo nome da empresa (lower(nome)), por trecho e sem diferença de maiúsculas', () => {
      expect(achadas('tucuma')).toEqual([A.id]);
      expect(achadas('COMERCIAL TUC')).toEqual([A.id]);
      // "Empresa busca-0080-b" (nome da fixture) casa pelo nome e pelo slug: aparece uma vez só.
      const b = listar('empresa busca-0080-b').filter((e) => e.id === B.id);
      expect(b).toHaveLength(1);
    });

    it('a razão social do core.empresa sai no json; a busca por ela entrou na 0085 (empresas-busca-razao-social-0085)', () => {
      expect(achadas('jaraqui')).toEqual([A.id]);
      expect(listar('tucuma').find((e) => e.id === A.id)?.razao_social).toBe('Distribuidora Jaraqui Eireli');
    });

    it('busca é literal: % e _ não são curinga; sem casamento = lista vazia', () => {
      expect(achadas('%')).toEqual([]);
      expect(achadas('busca_0080')).toEqual([]);
      expect(achadas('nada-casa-0080')).toEqual([]);
    });

    it('tem_fdv: true só com o integracao-fdv ativo, não vencido e não excluído; sempre booleano', () => {
      const esperado: Record<string, boolean> = {
        [A.id]: true,
        [B.id]: false,
        [C.id]: false,
        [D.id]: false,
        [E.id]: false,
      };
      for (const id of TODAS) expect({ id, tem_fdv: ler(id).tem_fdv }).toEqual({ id, tem_fdv: esperado[id] });
      // A listagem usa o mesmo json.
      const lista = listar('busca-0080');
      for (const e of lista)
        expect({ id: e.id, tem_fdv: e.tem_fdv }).toEqual({ id: e.id, tem_fdv: esperado[e.id] });
      // Reativar a licença de B liga o booleano.
      executar(
        banco.conexao,
        `UPDATE plataforma.tenant_modulo SET ativo = true WHERE tenant_id = '${B.id}' AND modulo = 'integracao-fdv';`,
      );
      expect(ler(B.id).tem_fdv).toBe(true);
      executar(
        banco.conexao,
        `UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = '${B.id}' AND modulo = 'integracao-fdv';`,
      );
    });

    it('privilégios e definição: listar só do config, empresa_json de ninguém; sem coluna nova em plataforma.tenant', () => {
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT has_function_privilege('${CONFIG}', 'plataforma.empresas_listar(text, uuid, integer)', 'EXECUTE') AS listar_config,
         has_function_privilege('macuxierp_app', 'plataforma.empresas_listar(text, uuid, integer)', 'EXECUTE') AS listar_app,
         has_function_privilege('${CONFIG}', 'plataforma.empresa_json(uuid)', 'EXECUTE') AS json_config,
         (SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ',') = 'search_path=pg_catalog, pg_temp'
                          AND obj_description(p.oid, 'pg_proc') LIKE '%0080%')
            FROM pg_proc p WHERE p.oid IN ('plataforma.empresas_listar(text, uuid, integer)'::regprocedure,
                                           'plataforma.empresa_json(uuid)'::regprocedure)) AS definicao,
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'plataforma' AND table_name = 'tenant' AND column_name = 'tem_fdv') AS coluna`,
      );
      expect(r).toEqual({
        listar_config: true,
        listar_app: false,
        json_config: false,
        definicao: true,
        coluna: false,
      });
    });

    it('a 0080 reexecuta sem erro e mantém a busca e o tem_fdv', () => {
      rodarScript(banco.conexao, SQL_0080, { transacao: true });
      rodarScript(banco.conexao, SQL_0080, { transacao: true });
      expect(achadas('tucuma')).toEqual([A.id]);
      expect(ler(A.id).tem_fdv).toBe(true);
    });
  },
);
