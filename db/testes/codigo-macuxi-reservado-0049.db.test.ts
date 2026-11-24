/**
 * T-0076 (v0.3.10), migração 0049: o código de empresa "MACUXI" é reservado ao login do superadmin (login único com a
 * Empresa sempre visível; o superadmin entra com "MACUXI" e cai no /config). Código da empresa: RN-CORE-11 (o login
 * não diferencia maiúsculas, então a reserva vale em qualquer grafia, depois de lower(btrim())). Dados fictícios.
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
  PAPEIS_APP,
  permitirSetRole,
  recusaComDetalhe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';

const MIGRACAO = fileURLToPath(
  new URL('../migrations/0049_plataforma_codigo_macuxi_reservado.sql', import.meta.url),
);
const CONFIG = 'macuxierp_config';
const CRIAR = 'plataforma.empresa_criar(text, text, text, text, text)';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-000000000491';
const COMENTARIO_0037 =
  'Portal /config (0037; antes 0033, de 4 argumentos): cria a empresa (ativa, com a licença do core) e audita sem o nome. Com p_slug: slug informado (reservado = check_violation; repetido = unique_violation) e p_uf, se vier, tem de ser o prefixo dele (senão check_violation). Sem p_slug: p_uf entre as 27 (senão check_violation) e código sorteado no formato da licença do FDV (sortear_slug; sem código livre = unique_violation). Fuso desconhecido = check_violation. Só macuxierp_config. T-0053.';

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — código MACUXI reservado ao superadmin (T-0076, 0049)',
  () => {
    let banco: BancoDeTeste;

    const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
    const reaplicar = (): void => {
      rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    };
    const novaSessao = (): string => {
      const id = randomUUID();
      executar(
        banco.conexao,
        `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ('${id}', '${SA}', encode(sha256(convert_to('${id}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
      );
      return id;
    };
    const criar = (sessao: string, slug: string): { slug: string } =>
      JSON.parse(
        linhas(
          rodarComo(
            banco.conexao,
            `${sessaoSql(sessao)}SELECT plataforma.empresa_criar('${slug}', 'Empresa Ficticia', NULL, 'req-0049');`,
            { papel: CONFIG },
          ),
        )[0] ?? 'null',
      ) as { slug: string };
    const inserirSql = (slug: string, excluida = false): string => {
      const id = randomUUID();
      return `INSERT INTO plataforma.tenant (id, tenant_id, slug, nome, deleted_at)
            VALUES ('${id}', '${id}', '${slug}', 'Empresa Ficticia', ${excluida ? 'now()' : 'NULL'});`;
    };
    const empresasMacuxi = (): number =>
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM plataforma.tenant WHERE lower(btrim(slug)) = 'macuxi'`,
      ).n;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(
        banco.conexao,
        `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
       VALUES ('${SA}', 'sa-0049@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);`,
      );
    });

    afterAll(() => banco?.remover());

    it('(a) empresa_criar recusa MACUXI em qualquer grafia: 23514, DETAIL codigo_reservado_superadmin', () => {
      const s = novaSessao();
      for (const slug of ['MACUXI', 'macuxi', ' Macuxi ']) {
        const sql = `${sessaoSql(s)}SELECT plataforma.empresa_criar('${slug}', 'Reservada', NULL, 'r');`;
        recusaComDetalhe(banco.conexao, sql, '23514', 'codigo_reservado_superadmin', { papel: CONFIG });
        recusaDetalhada(banco.conexao, sql, '23514', /slug reservado/, { papel: CONFIG });
      }
      expect(empresasMacuxi()).toBe(0);
      expect(
        um<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE request_id = 'r'`).n,
      ).toBe(0);
    });

    it('(b) INSERT e UPDATE diretos com o código caem no CHECK tenant_slug_macuxi_reservado', () => {
      recusaDetalhada(banco.conexao, inserirSql('macuxi'), '23514', /tenant_slug_macuxi_reservado/);
      recusaDetalhada(banco.conexao, inserirSql('macuxi', true), '23514', /tenant_slug_macuxi_reservado/);
      // Fora do formato (maiúscula, espaço) já cai no CHECK do slug da 0002, também 23514.
      for (const slug of ['MACUXI', ' Macuxi '])
        recusaDetalhada(banco.conexao, inserirSql(slug), '23514', /check/);
      const id = randomUUID();
      executar(
        banco.conexao,
        `INSERT INTO plataforma.tenant (id, tenant_id, slug, nome) VALUES ('${id}', '${id}', 'macuxi-0049', 'Ficticia');`,
      );
      recusaDetalhada(
        banco.conexao,
        `UPDATE plataforma.tenant SET slug = 'macuxi' WHERE id = '${id}';`,
        '23514',
        /tenant_slug_macuxi_reservado/,
      );
      expect(
        um(
          `SELECT convalidated AS validado, pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid = 'plataforma.tenant'::regclass AND conname = 'tenant_slug_macuxi_reservado'`,
        ),
      ).toEqual({ validado: true, def: "CHECK ((lower(btrim(slug)) <> 'macuxi'::text))" });
      expect(empresasMacuxi()).toBe(0);
    });

    it('(c) códigos que só começam por macuxi continuam aceitos', () => {
      const s = novaSessao();
      expect(criar(s, 'MACUXI2').slug).toBe('macuxi2');
      expect(criar(s, ' macuxifdv ').slug).toBe('macuxifdv');
      executar(banco.conexao, inserirSql('macuxi-erp'));
      executar(banco.conexao, inserirSql('xmacuxi'));
    });

    it('(d) empresa_criar: uma só, mesmos argumentos, SECURITY DEFINER, search_path, COMMENT e privilégios', () => {
      expect(
        um(
          `SELECT (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'plataforma'::regnamespace
                  AND proname = 'empresa_criar') AS n,
                array_to_string(proargnames, ',') || '/' || pronargdefaults AS args,
                prosecdef AS definer, proconfig AS config,
                obj_description(oid, 'pg_proc') AS comentario
         FROM pg_proc WHERE oid = '${CRIAR}'::regprocedure`,
        ),
      ).toEqual({
        n: 1,
        args: 'p_slug,p_nome,p_fuso,p_request_id,p_uf/1',
        definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
        comentario: COMENTARIO_0037,
      });
      for (const papel of [CONFIG, ...PAPEIS_APP]) {
        expect(
          um(`SELECT has_function_privilege('${papel}', '${CRIAR}', 'EXECUTE') AS criar`),
          papel,
        ).toEqual({ criar: papel === CONFIG });
      }
      expect(um(`SELECT has_function_privilege('public', '${CRIAR}', 'EXECUTE') AS publico`)).toEqual({
        publico: false,
      });
    });

    it('migração: reexecutável; aborta se alguma empresa, mesmo excluída, já tiver o código', () => {
      reaplicar();
      reaplicar();
      expect(
        um<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_constraint
         WHERE conrelid = 'plataforma.tenant'::regclass AND conname = 'tenant_slug_macuxi_reservado'`,
        ).n,
      ).toBe(1);
      for (const excluida of [false, true]) {
        let erro = '';
        try {
          rodarScript(
            banco.conexao,
            `ALTER TABLE plataforma.tenant DROP CONSTRAINT tenant_slug_macuxi_reservado;
           ${inserirSql('macuxi', excluida)}
           ${readFileSync(MIGRACAO, 'utf8')}`,
            { transacao: true },
          );
        } catch (e) {
          erro = String((e as { saida?: string }).saida ?? e);
        }
        expect(erro).toMatch(/0049: o código macuxi é reservado ao login do superadmin/);
        // A transação inteira foi desfeita: o CHECK continua e a linha não entrou.
        expect(empresasMacuxi()).toBe(0);
      }
    });
  },
);
