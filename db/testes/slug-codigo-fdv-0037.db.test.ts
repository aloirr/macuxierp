/**
 * T-0053, migração 0037: o código (slug) da empresa passa a ser o da licença do FDV, UF + 4 dígitos (decisão do
 * Alexandre; a troca thathyany -> am2808 entra pelo deploy). Troca única com auditoria, sorteio pela UF e
 * empresa_criar(p_slug, p_nome, p_fuso, p_request_id, p_uf DEFAULT NULL) no lugar da de 4 argumentos da 0033.
 * Dados fictícios.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { ErroPsql } from '../src/psql.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  PG_DISPONIVEL,
  PAPEIS_APP,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0037_plataforma_slug_codigo_fdv.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const CRIAR = 'plataforma.empresa_criar(text, text, text, text, text)';
const SORTEAR = 'plataforma.sortear_slug(text)';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000037';

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — código da empresa = código da licença do FDV (T-0053, 0037)',
  () => {
    let banco: BancoDeTeste;

    const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
    const reaplicar = (): void => {
      rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    };
    const comoConfig = (sessao: string | null, sql: string): string[] =>
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
    const novaEmpresa = (slug: string, excluida = false): string => {
      const id = randomUUID();
      executar(
        banco.conexao,
        `INSERT INTO plataforma.tenant (id, tenant_id, slug, nome, deleted_at)
       VALUES ('${id}', '${id}', '${slug}', 'Empresa Ficticia', ${excluida ? 'now()' : 'NULL'});`,
      );
      return id;
    };
    const slugDe = (id: string): string =>
      um<{ s: string }>(`SELECT slug AS s FROM plataforma.tenant WHERE id = '${id}'`).s;
    const auditoriasDaTroca = (): Record<string, unknown>[] =>
      consultar(
        banco.conexao,
        `SELECT tenant_id, usuario_id, superadmin_id, acao, entidade, entidade_id, antes, depois, request_id
       FROM plataforma.auditoria WHERE acao = 'plataforma.empresa.codigo_fdv' ORDER BY ocorrido_em`,
      );
    /** Mesmo cálculo da sortear_slug, um random() por tentativa, a partir da semente. */
    const sorteados = (semente: number, n: number): string[] =>
      linhas(
        rodarScript(
          banco.conexao,
          `SELECT setseed(${semente});
         SELECT 'am' || lpad((floor(random() * 10000))::int::text, 4, '0') FROM generate_series(1, ${n}) g ORDER BY g;`,
        ),
      );
    /** sortear_slug('AM') logo depois da semente, na mesma conexão. */
    const sortearComSemente = (semente: number): string | undefined =>
      linhas(
        rodarScript(banco.conexao, `SELECT setseed(${semente}); SELECT plataforma.sortear_slug('AM');`),
      )[0];

    type Empresa = { id: string; slug: string; fuso: string; situacao: string; modulos: unknown };
    const criar = (sessao: string, args: string): Empresa =>
      JSON.parse(comoConfig(sessao, `SELECT plataforma.empresa_criar(${args});`)[0] ?? 'null') as Empresa;
    const recusa = (sessao: string, args: string, codigo: string, msg: RegExp): void =>
      recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}SELECT plataforma.empresa_criar(${args});`, codigo, msg, {
        papel: CONFIG,
      });
    /** stderr da 0037 (NOTICE): o psql só o devolve no erro, então um erro no fim desfaz tudo (-1) e traz a saída. */
    const avisosDaMigracao = (): string => {
      try {
        rodarScript(banco.conexao, `${readFileSync(MIGRACAO, 'utf8')}\nSELECT 1 / 0;`, { transacao: true });
      } catch (e) {
        if (e instanceof ErroPsql) return e.saida;
        throw e;
      }
      throw new Error('a 0037 com 1/0 no fim deveria falhar');
    };

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
         VALUES ('${SA}', 'sa-0037@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);`,
      );
    });

    afterAll(() => banco?.remover());

    it('(a) sem a empresa thathyany a migração não muda nada', () => {
      const antes = um<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.tenant');
      reaplicar();
      expect(um<{ n: number }>('SELECT count(*)::int AS n FROM plataforma.tenant')).toEqual(antes);
      expect(auditoriasDaTroca()).toEqual([]);
    });

    it('(a) com am2808 já existente a thathyany fica como está, só com NOTICE (sem erro)', () => {
      const t = novaEmpresa('thathyany');
      const outra = novaEmpresa('am2808');
      expect(avisosDaMigracao()).toMatch(/NOTICE: {2}0037: código am2808 já existe em outra empresa/);
      reaplicar();
      expect([slugDe(t), slugDe(outra)]).toEqual(['thathyany', 'am2808']);
      expect(auditoriasDaTroca()).toEqual([]);
      executar(banco.conexao, `DELETE FROM plataforma.tenant WHERE id IN ('${t}', '${outra}');`);
    });

    it('(a) troca thathyany -> am2808 com a auditoria da migração (sem usuário nem superadmin); reexecutar não repete', () => {
      const t = novaEmpresa('thathyany');
      reaplicar();
      expect(slugDe(t)).toBe('am2808');
      const esperado = [
        {
          tenant_id: t,
          usuario_id: null,
          superadmin_id: null,
          acao: 'plataforma.empresa.codigo_fdv',
          entidade: 'tenant',
          entidade_id: t,
          antes: { slug: 'thathyany' },
          depois: { slug: 'am2808' },
          request_id: 'migracao-0037',
        },
      ];
      expect(auditoriasDaTroca()).toEqual(esperado);
      reaplicar();
      reaplicar();
      expect(slugDe(t)).toBe('am2808');
      expect(auditoriasDaTroca()).toEqual(esperado);
    });

    it('(b) sortear_slug: UF + 4 dígitos, UF validada, pula código ocupado (inclusive excluído) e esgota em 20', () => {
      const [s] = consultar<{ s: string }>(banco.conexao, `SELECT plataforma.sortear_slug(' am ') AS s`);
      expect(s?.s).toMatch(/^am[0-9]{4}$/);
      expect(um<{ s: string }>(`SELECT plataforma.sortear_slug('DF') AS s`).s).toMatch(/^df[0-9]{4}$/);
      for (const uf of ["'XX'", "'A'", "''", "'amazonas'", 'NULL'])
        recusaDetalhada(banco.conexao, `SELECT plataforma.sortear_slug(${uf});`, '23514', /uf invalida/);

      // Ocupa o 1º sorteio da semente (como excluída): o 2º sai.
      const [primeiro, segundo] = sorteados(0.37, 2);
      const ocupada = novaEmpresa(primeiro as string, true);
      expect(sortearComSemente(0.37)).toBe(primeiro === segundo ? sorteados(0.37, 3)[2] : segundo);

      // Ocupa os 20 sorteios da semente: sem código livre.
      const ocupar = [...new Set(sorteados(0.73, 20))].filter((x) => x !== primeiro);
      const ids = ocupar.map((slug) => novaEmpresa(slug));
      recusaDetalhada(
        banco.conexao,
        `SELECT setseed(0.73); SELECT plataforma.sortear_slug('AM');`,
        '23505',
        /sem código livre para a UF/,
      );
      executar(
        banco.conexao,
        `DELETE FROM plataforma.tenant WHERE id IN (${[ocupada, ...ids].map((i) => `'${i}'`).join(', ')});`,
      );
    });

    it('(c) empresa_criar com slug informado: chamada de 4 argumentos de hoje, como na 0033', () => {
      const s = novaSessao();
      const e = criar(s, `' Empresa-0037 ', 'Empresa Nova Ficticia', NULL, 'req-0037'`);
      expect(e).toMatchObject({
        slug: 'empresa-0037',
        fuso: 'America/Manaus',
        situacao: 'ativo',
        modulos: [{ modulo: 'core', ativo: true, valido_ate: null }],
      });
      expect(
        um(
          `SELECT superadmin_id, usuario_id, depois FROM plataforma.auditoria
         WHERE request_id = 'req-0037' AND acao = 'plataforma.empresa.criar'`,
        ),
      ).toEqual({
        superadmin_id: SA,
        usuario_id: null,
        depois: { slug: 'empresa-0037', situacao: 'ativo', modulos: ['core'] },
      });
      recusa(s, `'empresa-0037', 'Repetida', NULL, 'r'`, '23505', /duplicate key/);
      recusa(s, `'Referencia', 'Reservada', NULL, 'r'`, '23514', /slug reservado/);
      recusa(s, `'empresa-marte', 'Marte', 'Marte/Base', 'r'`, '23514', /fuso/);
    });

    it('(c) empresa_criar com slug e UF: a UF tem de ser o prefixo do código', () => {
      const s = novaSessao();
      expect(criar(s, `'AM2809', 'Coerente', NULL, 'r', ' am '`).slug).toBe('am2809');
      expect(criar(s, `'rr0001', 'Coerente', NULL, 'r', 'RR'`).slug).toBe('rr0001');
      for (const uf of ['RR', '', 'amx'])
        recusa(s, `'am2810', 'Diferente', NULL, 'r', '${uf}'`, '23514', /uf difere do codigo/);
      recusa(s, `'am2809', 'Repetida', NULL, 'r', 'AM'`, '23505', /duplicate key/);
    });

    it('(c) empresa_criar sem slug: código sorteado pela UF; UF obrigatória entre as 27', () => {
      const s = novaSessao();
      const e = criar(s, `NULL, 'Sorteada Ficticia', NULL, 'req-0037-uf', ' am '`);
      expect(e.slug).toMatch(/^am[0-9]{4}$/);
      expect(
        um(`SELECT depois FROM plataforma.auditoria WHERE request_id = 'req-0037-uf' AND acao = 'plataforma.empresa.criar'`),
      ).toEqual({ depois: { slug: e.slug, situacao: 'ativo', modulos: ['core'] } });
      for (const uf of ['NULL', "'ZZ'", "''", "'amazonas'"])
        recusa(s, `NULL, 'Invalida', NULL, 'r', ${uf}`, '23514', /uf invalida/);
      recusa(s, `NULL, 'Marte', 'Marte/Base', 'r', 'AM'`, '23514', /fuso/);
    });

    it('privilégios: empresa_criar (5 argumentos, uma só) só do config; sortear_slug sem EXECUTE para ninguém', () => {
      expect(
        um(
          `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                  AND proname = 'empresa_criar') AS n,
                (SELECT array_to_string(proargnames, ',') || '/' || pronargdefaults FROM pg_proc
                  WHERE oid = '${CRIAR}'::regprocedure) AS args,
                (SELECT prosecdef FROM pg_proc WHERE oid = '${SORTEAR}'::regprocedure) AS definer`,
        ),
      ).toEqual({ n: 1, args: 'p_slug,p_nome,p_fuso,p_request_id,p_uf/1', definer: true });
      for (const papel of [CONFIG, ...PAPEIS_APP]) {
        expect(
          um(
            `SELECT has_function_privilege('${papel}', '${CRIAR}', 'EXECUTE') AS criar,
                  has_function_privilege('${papel}', '${SORTEAR}', 'EXECUTE') AS sortear`,
          ),
          papel,
        ).toEqual({ criar: papel === CONFIG, sortear: false });
      }
      expect(
        um(`SELECT has_function_privilege('public', '${CRIAR}', 'EXECUTE') OR
                 has_function_privilege('public', '${SORTEAR}', 'EXECUTE') AS publico`),
      ).toEqual({ publico: false });
    });
  },
);
