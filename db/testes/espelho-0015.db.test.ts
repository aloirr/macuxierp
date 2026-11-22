/**
 * T-0011 (migração 0015): registro_publicado.erp_id (par registro_external_id ↔ UUID do ERP, único por tenant e
 * entidade entre os ativos não excluídos) e a configuração da credencial (entidades_habilitadas, limite_registros_lote).
 * Estrutura, RLS entre dois tenants nas colunas novas, unicidade, CHECKs, privilégios e a 0015 sobre linhas já gravadas.
 * E a tabela conflito_chave (ADR 0010, item 3; T-0009 §8): um aberto por (entidade, erp_id), CHECKs, RLS e privilégios.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falhaDetalhada,
  numeros,
  PG_DISPONIVEL,
  permitirSetRole,
  rodarScript,
  verboso,
} from './apoio.ts';
import { fixtureIntegracao, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = '0015_integracao_fdv_espelho.sql';
const ENTIDADES = [
  'filial',
  'vendedor',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'estoque',
  'cliente',
  'cliente_endereco',
  'titulo',
  'nota',
];

const A = novoTenant('espelho-a');
const B = novoTenant('espelho-b');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const WORKER_A = { papel: 'macuxierp_worker', tenant: A.id };
const WORKER_B = { papel: 'macuxierp_worker', tenant: B.id };
const LEITURA_A = { papel: 'macuxierp_leitura', tenant: A.id };

/** Registro publicado (como o worker grava) com o erp_id dado. */
const registroSql = (
  tenant: string,
  erpId: string,
  entidade = 'produto',
  externo = randomUUID(),
  ativo = true,
): string =>
  `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash,
     alterado_em, fonte_ocorrido_em, ativo, erp_id)
   VALUES ('${tenant}', '${entidade}', '${externo}', '{"codigo": "P1"}', repeat('2', 64), now(), now(), ${ativo},
     '${erpId}');`;

/** Conflito de chave aberto (como o worker grava). */
const conflitoSql = (
  tenant: string,
  erpId: string,
  extra: { entidade?: string; codigo?: string; chave?: string } = {},
): string =>
  `INSERT INTO integracao_fdv.conflito_chave (tenant_id, entidade, erp_id, chave, codigo)
   VALUES ('${tenant}', '${extra.entidade ?? 'cliente'}', '${erpId}', ${extra.chave ?? "'CLI-001'"},
     '${extra.codigo ?? 'chave_alterada'}');`;

describe.skipIf(!PG_DISPONIVEL)(
  'banco macuxierp — espelho com erp_id e configuração da credencial (T-0011, 0015)',
  () => {
    let banco: BancoDeTeste;

    beforeAll(() => {
      banco = criarBancoDeTeste();
      migrar(banco.conexao, { oficiais: false });
      permitirSetRole(banco.conexao);
      executar(banco.conexao, [A, B].map((t) => fixturePlataforma(t) + fixtureIntegracao(t)).join('\n'));
    });

    afterAll(() => banco?.remover());

    it('estrutura: erp_id uuid anulável com o único parcial; a credencial com padrão, NOT NULL e os CHECKs', () => {
      const colunas = consultar<{ t: string; c: string; tipo: string; nulo: string; padrao: string | null }>(
        banco.conexao,
        `SELECT table_name AS t, column_name AS c, udt_name AS tipo, is_nullable AS nulo, column_default AS padrao
       FROM information_schema.columns WHERE table_schema = 'integracao_fdv'
         AND column_name IN ('erp_id', 'entidades_habilitadas', 'limite_registros_lote')
         AND table_name IN ('registro_publicado', 'credencial')
       ORDER BY 1, 2`,
      );
      expect(colunas.map(({ t, c, tipo, nulo }) => ({ t, c, tipo, nulo }))).toEqual([
        { t: 'credencial', c: 'entidades_habilitadas', tipo: '_entidade_hub', nulo: 'NO' },
        { t: 'credencial', c: 'limite_registros_lote', tipo: 'int4', nulo: 'NO' },
        { t: 'registro_publicado', c: 'erp_id', tipo: 'uuid', nulo: 'YES' },
      ]);
      const [indice] = consultar<{ def: string }>(
        banco.conexao,
        `SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'integracao_fdv'
         AND indexname = 'registro_publicado_erp_id_uq'`,
      );
      expect(indice?.def).toMatch(
        /UNIQUE INDEX .* \(tenant_id, entidade, erp_id\) WHERE \(\(deleted_at IS NULL\) AND ativo\)$/,
      );
      // Sem FK para outro schema: o erp_id é opaco.
      const [fk] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid
         AND a.attnum = ANY (k.conkey)
       WHERE k.conrelid = 'integracao_fdv.registro_publicado'::regclass AND k.contype = 'f' AND a.attname = 'erp_id'`,
      );
      expect(fk?.n).toBe(0);
    });

    it('credencial nova sem as colunas: todas as 12 entidades na ordem de carga e limite 5000', () => {
      const [c] = consultar<{ e: string[]; l: number }>(
        banco.conexao,
        'SELECT entidades_habilitadas AS e, limite_registros_lote AS l FROM integracao_fdv.credencial',
        APP_A,
      );
      expect(c).toEqual({ e: ENTIDADES, l: 5000 });
    });

    it('limite_registros_lote: 0, 5001 e nulo falham; 1 e 5000 passam', () => {
      for (const valor of ['0', '5001', '-1']) {
        const e = falhaDetalhada(() =>
          executar(
            banco.conexao,
            verboso(`UPDATE integracao_fdv.credencial SET limite_registros_lote = ${valor};`),
            APP_A,
          ),
        );
        expect({ valor, saida: e.saida }).toMatchObject({ valor, saida: expect.stringMatching(/23514/) });
        expect(e.mensagem).toMatch(/credencial_limite_registros_lote/);
      }
      expect(
        falhaDetalhada(() =>
          executar(
            banco.conexao,
            verboso('UPDATE integracao_fdv.credencial SET limite_registros_lote = NULL;'),
            APP_A,
          ),
        ).saida,
      ).toMatch(/23502/);
      for (const valor of [1, 5000]) {
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.credencial SET limite_registros_lote = ${valor};`,
          APP_A,
        );
        const [r] = consultar<{ l: number }>(
          banco.conexao,
          'SELECT limite_registros_lote AS l FROM integracao_fdv.credencial',
          APP_A,
        );
        expect(r?.l).toBe(valor);
      }
    });

    it('entidades_habilitadas: cada elemento no domínio entidade_hub; nula e elemento nulo falham; vazia e subconjunto passam', () => {
      for (const valor of ["ARRAY['produto', 'pedido']", "ARRAY['Produto']"]) {
        const e = falhaDetalhada(() =>
          executar(
            banco.conexao,
            verboso(`UPDATE integracao_fdv.credencial SET entidades_habilitadas = ${valor};`),
            APP_A,
          ),
        );
        expect({ valor, saida: e.saida }).toMatchObject({ valor, saida: expect.stringMatching(/23514/) });
        expect(e.mensagem).toMatch(/entidade_hub_check/);
      }
      const nulo = falhaDetalhada(() =>
        executar(
          banco.conexao,
          verboso("UPDATE integracao_fdv.credencial SET entidades_habilitadas = ARRAY['produto', NULL];"),
          APP_A,
        ),
      );
      expect(nulo.saida).toMatch(/23514/);
      expect(nulo.mensagem).toMatch(/credencial_entidades_habilitadas/);
      expect(
        falhaDetalhada(() =>
          executar(
            banco.conexao,
            verboso('UPDATE integracao_fdv.credencial SET entidades_habilitadas = NULL;'),
            APP_A,
          ),
        ).saida,
      ).toMatch(/23502/);
      for (const valor of ["'{}'", "ARRAY['cliente', 'produto']"]) {
        executar(
          banco.conexao,
          `UPDATE integracao_fdv.credencial SET entidades_habilitadas = ${valor};`,
          APP_A,
        );
      }
      const [r] = consultar<{ e: string[] }>(
        banco.conexao,
        'SELECT entidades_habilitadas AS e FROM integracao_fdv.credencial',
        APP_A,
      );
      expect(r?.e).toEqual(['cliente', 'produto']);
    });

    it('troca de chave: o app grava a credencial nova já com a configuração copiada da substituída', () => {
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.credencial SET entidades_habilitadas = ARRAY['cliente', 'produto'],
           limite_registros_lote = 300 WHERE substituida_em IS NULL AND deleted_at IS NULL;`,
        APP_A,
      );
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.credencial SET substituida_em = now() WHERE substituida_em IS NULL AND deleted_at IS NULL;
         INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo,
           entidades_habilitadas, limite_registros_lote)
           VALUES ('${A.id}', 'conector-a2', 'teste', decode(repeat('bb', 40), 'hex'), 'mxf_novo',
             ARRAY['cliente', 'produto']::integracao_fdv.entidade_hub[], 300);`,
        APP_A,
      );
      const [r] = consultar<{ e: string[]; l: number }>(
        banco.conexao,
        `SELECT entidades_habilitadas AS e, limite_registros_lote AS l FROM integracao_fdv.credencial
         WHERE substituida_em IS NULL AND deleted_at IS NULL`,
        APP_A,
      );
      expect(r).toEqual({ e: ['cliente', 'produto'], l: 300 });
    });

    it('erp_id: repetido na mesma entidade do tenant falha; outra entidade, outro tenant ou excluído passam', () => {
      const erp = randomUUID();
      executar(banco.conexao, registroSql(A.id, erp), WORKER_A);
      const e = falhaDetalhada(() => executar(banco.conexao, verboso(registroSql(A.id, erp)), WORKER_A));
      expect(e.saida).toMatch(/23505/);
      expect(e.mensagem).toMatch(/registro_publicado_erp_id_uq/);
      // Gravar o erp_id num registro já existente da mesma entidade também cai no único.
      const outro = randomUUID();
      executar(banco.conexao, registroSql(A.id, outro), WORKER_A);
      expect(
        falhaDetalhada(() =>
          executar(
            banco.conexao,
            verboso(
              `UPDATE integracao_fdv.registro_publicado SET erp_id = '${erp}' WHERE erp_id = '${outro}';`,
            ),
            WORKER_A,
          ),
        ).saida,
      ).toMatch(/23505/);
      executar(banco.conexao, registroSql(A.id, erp, 'produto_unidade'), WORKER_A);
      executar(banco.conexao, registroSql(B.id, erp), WORKER_B);
      // Excluído (deleted_at) libera o par para o registro novo.
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.registro_publicado SET deleted_at = now() WHERE erp_id = '${erp}' AND entidade = 'produto';`,
        WORKER_A,
      );
      executar(banco.conexao, registroSql(A.id, erp), WORKER_A);
      const [n] = consultar<{ total: number; vivos: number }>(
        banco.conexao,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS vivos
       FROM integracao_fdv.registro_publicado WHERE erp_id = '${erp}' AND entidade = 'produto'`,
        WORKER_A,
      );
      expect(n).toEqual({ total: 2, vivos: 1 });
      // Troca de external_id (RN-CORE-05): a linha antiga inativa convive com a nova ativa; duas ativas falham.
      const troca = randomUUID();
      executar(banco.conexao, registroSql(A.id, troca, 'cliente', randomUUID(), false), WORKER_A);
      executar(banco.conexao, registroSql(A.id, troca, 'cliente'), WORKER_A);
      expect(
        falhaDetalhada(() => executar(banco.conexao, verboso(registroSql(A.id, troca, 'cliente')), WORKER_A))
          .mensagem,
      ).toMatch(/registro_publicado_erp_id_uq/);
      // erp_id nulo (linhas antes da publicação) nunca conflita.
      for (let i = 0; i < 2; i++) {
        executar(banco.conexao, registroSql(A.id, erp, 'estoque').replace(`'${erp}');`, 'NULL);'), WORKER_A);
      }
    });

    it('RLS nas colunas novas: o UPDATE do tenant A na credencial do tenant B atinge 0 linhas', () => {
      const mudou = rodarScript(
        banco.conexao,
        `SET ROLE macuxierp_app; SET app.tenant_id = '${A.id}';
       UPDATE integracao_fdv.credencial SET limite_registros_lote = 7, entidades_habilitadas = '{}'
       WHERE tenant_id = '${B.id}' RETURNING 1;`,
        { transacao: true },
      );
      expect(numeros(mudou)).toEqual([]);
    });

    it('privilégios nas colunas novas: o worker grava erp_id e o app não; o app configura a credencial e o worker não', () => {
      const negado = (sql: string, ctx: { papel: string; tenant: string }): void => {
        const e = falhaDetalhada(() => executar(banco.conexao, verboso(sql), ctx));
        expect({ sql, papel: ctx.papel, saida: e.saida }).toMatchObject({
          sql,
          papel: ctx.papel,
          saida: expect.stringMatching(/42501/),
        });
      };
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.registro_publicado SET erp_id = erp_id WHERE erp_id = '${A.cliente}';`,
        WORKER_A,
      );
      negado(`UPDATE integracao_fdv.registro_publicado SET erp_id = gen_random_uuid();`, APP_A);
      negado('UPDATE integracao_fdv.credencial SET limite_registros_lote = 10;', WORKER_A);
      negado("UPDATE integracao_fdv.credencial SET entidades_habilitadas = '{}';", WORKER_A);
    });

    it('conflito_chave: estrutura, RLS ligado, um aberto por (entidade, erp_id) e nenhuma FK para fora do schema', () => {
      const colunas = consultar<{ c: string; tipo: string; nulo: boolean }>(
        banco.conexao,
        `SELECT attname AS c, format_type(atttypid, atttypmod) AS tipo, NOT attnotnull AS nulo FROM pg_attribute
         WHERE attrelid = 'integracao_fdv.conflito_chave'::regclass AND attnum > 0 AND NOT attisdropped
         ORDER BY attnum`,
      );
      expect(colunas).toEqual([
        { c: 'id', tipo: 'uuid', nulo: false },
        { c: 'tenant_id', tipo: 'uuid', nulo: false },
        { c: 'entidade', tipo: 'integracao_fdv.entidade_hub', nulo: false },
        { c: 'erp_id', tipo: 'uuid', nulo: false },
        { c: 'chave', tipo: 'text', nulo: false },
        { c: 'codigo', tipo: 'integracao_fdv.codigo', nulo: false },
        { c: 'detectado_em', tipo: 'timestamp(3) with time zone', nulo: false },
        { c: 'resolvido_em', tipo: 'timestamp(3) with time zone', nulo: true },
        { c: 'created_at', tipo: 'timestamp with time zone', nulo: false },
        { c: 'updated_at', tipo: 'timestamp with time zone', nulo: false },
        { c: 'deleted_at', tipo: 'timestamp with time zone', nulo: true },
        { c: 'external_id', tipo: 'text', nulo: true },
      ]);
      const [rls] = consultar<{ rls: boolean; pol: number }>(
        banco.conexao,
        `SELECT relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'integracao_fdv'
           AND tablename = 'conflito_chave') AS pol
         FROM pg_class WHERE oid = 'integracao_fdv.conflito_chave'::regclass`,
      );
      expect(rls).toEqual({ rls: true, pol: 1 });
      const [indice] = consultar<{ def: string }>(
        banco.conexao,
        `SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'integracao_fdv'
         AND indexname = 'conflito_chave_aberto_uq'`,
      );
      expect(indice?.def).toMatch(
        /UNIQUE INDEX .* \(tenant_id, entidade, erp_id\) WHERE \(resolvido_em IS NULL\)$/,
      );
      // Só a FK de tenant_id (padrão do banco); erp_id é opaco.
      const fks = consultar<{ alvo: string }>(
        banco.conexao,
        `SELECT confrelid::regclass::text AS alvo FROM pg_constraint
         WHERE conrelid = 'integracao_fdv.conflito_chave'::regclass AND contype = 'f'`,
      );
      expect(fks).toEqual([{ alvo: 'plataforma.tenant' }]);
    });

    it('conflito_chave: o 2º aberto do mesmo (entidade, erp_id) falha; resolvido, abrir outro passa', () => {
      const erp = randomUUID();
      executar(banco.conexao, conflitoSql(A.id, erp), WORKER_A);
      const e = falhaDetalhada(() =>
        executar(banco.conexao, verboso(conflitoSql(A.id, erp, { codigo: 'chave_duplicada' })), WORKER_A),
      );
      expect(e.saida).toMatch(/23505/);
      expect(e.mensagem).toMatch(/conflito_chave_aberto_uq/);
      // Outra entidade e outro tenant com o mesmo erp_id não conflitam.
      executar(banco.conexao, conflitoSql(A.id, erp, { entidade: 'produto' }), WORKER_A);
      executar(banco.conexao, conflitoSql(B.id, erp), WORKER_B);
      // O BKO resolve; o próximo conflito do mesmo par abre.
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.conflito_chave SET resolvido_em = now()
         WHERE erp_id = '${erp}' AND entidade = 'cliente' AND resolvido_em IS NULL;`,
        APP_A,
      );
      executar(banco.conexao, conflitoSql(A.id, erp, { codigo: 'chave_duplicada' }), WORKER_A);
      // O worker também resolve (o conflito sumiu) e a retenção marca deleted_at.
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.conflito_chave SET resolvido_em = now()
         WHERE erp_id = '${erp}' AND entidade = 'cliente' AND resolvido_em IS NULL;
         UPDATE integracao_fdv.conflito_chave SET deleted_at = now()
         WHERE erp_id = '${erp}' AND entidade = 'cliente' AND resolvido_em IS NOT NULL;`,
        WORKER_A,
      );
      const [n] = consultar<{ total: number; abertos: number; excluidos: number }>(
        banco.conexao,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE resolvido_em IS NULL)::int AS abertos,
           count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS excluidos
         FROM integracao_fdv.conflito_chave WHERE erp_id = '${erp}' AND entidade = 'cliente'`,
        APP_A,
      );
      expect(n).toEqual({ total: 2, abertos: 0, excluidos: 2 });
    });

    it('conflito_chave: CHECKs de código, entidade, tamanho da chave e resolvido_em >= detectado_em', () => {
      const casos: [string, string, RegExp][] = [
        [
          'codigo fora da lista',
          conflitoSql(A.id, randomUUID(), { codigo: 'chave_nova' }),
          /conflito_chave_codigo/,
        ],
        [
          'codigo fora do domínio',
          conflitoSql(A.id, randomUUID(), { codigo: 'Chave alterada' }),
          /codigo_check/,
        ],
        [
          'entidade fora do domínio',
          conflitoSql(A.id, randomUUID(), { entidade: 'pedido' }),
          /entidade_hub_check/,
        ],
        ['chave vazia', conflitoSql(A.id, randomUUID(), { chave: "''" }), /conflito_chave_chave/],
        [
          'chave com 201',
          conflitoSql(A.id, randomUUID(), { chave: "repeat('x', 201)" }),
          /conflito_chave_chave/,
        ],
      ];
      for (const [caso, sql, restricao] of casos) {
        const e = falhaDetalhada(() => executar(banco.conexao, verboso(sql), WORKER_A));
        expect({ caso, saida: e.saida }).toMatchObject({ caso, saida: expect.stringMatching(/23514/) });
        expect({ caso, mensagem: e.mensagem }).toMatchObject({
          caso,
          mensagem: expect.stringMatching(restricao),
        });
      }
      expect(
        falhaDetalhada(() =>
          executar(banco.conexao, verboso(conflitoSql(A.id, randomUUID(), { chave: 'NULL' })), WORKER_A),
        ).saida,
      ).toMatch(/23502/);
      const erp = randomUUID();
      executar(
        banco.conexao,
        conflitoSql(A.id, erp, { chave: "repeat('x', 200)", entidade: 'filial' }),
        WORKER_A,
      );
      const antes = falhaDetalhada(() =>
        executar(
          banco.conexao,
          verboso(
            `UPDATE integracao_fdv.conflito_chave SET resolvido_em = detectado_em - interval '1 second'
             WHERE erp_id = '${erp}';`,
          ),
          APP_A,
        ),
      );
      expect(antes.saida).toMatch(/23514/);
      expect(antes.mensagem).toMatch(/conflito_chave_resolvido/);
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.conflito_chave SET resolvido_em = detectado_em WHERE erp_id = '${erp}';`,
        APP_A,
      );
    });

    it('conflito_chave: deleted_at só em conflito resolvido; o aberto não some nem trava o único em silêncio', () => {
      const erp = randomUUID();
      executar(banco.conexao, conflitoSql(A.id, erp, { entidade: 'estoque' }), WORKER_A);
      const aberto = falhaDetalhada(() =>
        executar(
          banco.conexao,
          verboso(`UPDATE integracao_fdv.conflito_chave SET deleted_at = now() WHERE erp_id = '${erp}';`),
          WORKER_A,
        ),
      );
      expect(aberto.saida).toMatch(/23514/);
      expect(aberto.mensagem).toMatch(/conflito_chave_exclui_resolvido/);
      executar(
        banco.conexao,
        `UPDATE integracao_fdv.conflito_chave SET resolvido_em = now() WHERE erp_id = '${erp}';
         UPDATE integracao_fdv.conflito_chave SET deleted_at = now() WHERE erp_id = '${erp}';`,
        WORKER_A,
      );
      const [r] = consultar<{ abertos: number; excluidos: number }>(
        banco.conexao,
        `SELECT count(*) FILTER (WHERE resolvido_em IS NULL)::int AS abertos,
           count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS excluidos
         FROM integracao_fdv.conflito_chave WHERE erp_id = '${erp}'`,
        WORKER_A,
      );
      expect(r).toEqual({ abertos: 0, excluidos: 1 });
    });

    it('conflito_chave: RLS — o tenant A não vê nem resolve o conflito do B', () => {
      const erp = randomUUID();
      executar(banco.conexao, conflitoSql(B.id, erp, { entidade: 'vendedor' }), WORKER_B);
      for (const ctx of [APP_A, WORKER_A, LEITURA_A]) {
        const [r] = consultar<{ n: number }>(
          banco.conexao,
          `SELECT count(*)::int AS n FROM integracao_fdv.conflito_chave WHERE erp_id = '${erp}'`,
          ctx,
        );
        expect({ papel: ctx.papel, n: r?.n }).toEqual({ papel: ctx.papel, n: 0 });
      }
      for (const papel of ['macuxierp_app', 'macuxierp_worker']) {
        const mudou = rodarScript(
          banco.conexao,
          `SET ROLE ${papel}; SET app.tenant_id = '${A.id}';
         UPDATE integracao_fdv.conflito_chave SET resolvido_em = now() WHERE erp_id = '${erp}' RETURNING 1;`,
          { transacao: true },
        );
        expect({ papel, linhas: numeros(mudou) }).toEqual({ papel, linhas: [] });
      }
      // O worker do A não grava conflito em nome do B.
      expect(
        falhaDetalhada(() => executar(banco.conexao, verboso(conflitoSql(B.id, randomUUID())), WORKER_A))
          .saida,
      ).toMatch(/42501/);
      const [b] = consultar<{ n: number }>(
        banco.conexao,
        `SELECT count(*)::int AS n FROM integracao_fdv.conflito_chave WHERE erp_id = '${erp}' AND resolvido_em IS NULL`,
        WORKER_B,
      );
      expect(b?.n).toBe(1);
    });

    it('conflito_chave: DELETE negado a todos; o app só resolve; o worker só resolve e exclui; a leitura só lê', () => {
      const negado = (sql: string, ctx: { papel: string; tenant: string }): void => {
        const e = falhaDetalhada(() => executar(banco.conexao, verboso(sql), ctx));
        expect({ sql, papel: ctx.papel, saida: e.saida }).toMatchObject({
          sql,
          papel: ctx.papel,
          saida: expect.stringMatching(/42501/),
        });
      };
      executar(banco.conexao, conflitoSql(A.id, randomUUID(), { entidade: 'titulo' }), WORKER_A);
      for (const ctx of [APP_A, WORKER_A, LEITURA_A]) {
        negado(`DELETE FROM integracao_fdv.conflito_chave WHERE entidade = 'titulo';`, ctx);
      }
      for (const set of [
        "chave = 'outra'",
        "codigo = 'chave_duplicada'",
        'erp_id = gen_random_uuid()',
        "entidade = 'nota'",
        'detectado_em = now()',
        'deleted_at = now()',
        'updated_at = now()',
        'external_id = NULL',
        `tenant_id = '${B.id}'`,
      ]) {
        negado(`UPDATE integracao_fdv.conflito_chave SET ${set} WHERE entidade = 'titulo';`, APP_A);
      }
      for (const set of [
        "chave = 'outra'",
        "codigo = 'chave_duplicada'",
        'erp_id = gen_random_uuid()',
        "entidade = 'nota'",
        'detectado_em = now()',
        'updated_at = now()',
        `tenant_id = '${B.id}'`,
      ]) {
        negado(`UPDATE integracao_fdv.conflito_chave SET ${set} WHERE entidade = 'titulo';`, WORKER_A);
      }
      negado(conflitoSql(A.id, randomUUID()), APP_A);
      negado(conflitoSql(A.id, randomUUID()), LEITURA_A);
      negado(
        `UPDATE integracao_fdv.conflito_chave SET resolvido_em = now() WHERE entidade = 'titulo';`,
        LEITURA_A,
      );
      const [r] = consultar<{ n: number }>(
        banco.conexao,
        "SELECT count(*)::int AS n FROM integracao_fdv.conflito_chave WHERE entidade = 'titulo'",
        LEITURA_A,
      );
      expect(r?.n).toBe(1);
    });
  },
);

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — 0015 sobre linhas já gravadas (T-0011)', () => {
  let banco: BancoDeTeste;
  let pasta: string;
  const C = novoTenant('espelho-c');

  beforeAll(() => {
    banco = criarBancoDeTeste();
    pasta = mkdtempSync(join(tmpdir(), 'macuxi-0015-'));
    for (const m of listarMigracoes().filter((x) => x.nome < '0015'))
      copyFileSync(m.caminho, join(pasta, m.nome));
  });

  afterAll(() => {
    banco?.remover();
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it('a credencial gravada antes ganha o padrão; os registros antigos ficam com erp_id nulo, sem conflito', () => {
    expect(migrar(banco.conexao, { pasta, oficiais: false })).not.toContain(MIGRACAO);
    executar(
      banco.conexao,
      `${fixturePlataforma(C)}
       INSERT INTO integracao_fdv.credencial (tenant_id, conector_id, ambiente, chave_cifrada, chave_prefixo)
         VALUES ('${C.id}', 'conector-c', 'teste', decode(repeat('aa', 40), 'hex'), 'mxf_abcd');
       INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash,
         alterado_em, fonte_ocorrido_em, ativo)
         SELECT '${C.id}', 'cliente', 'cli-' || i, '{}', repeat('3', 64), now(), now(), true FROM generate_series(1, 2) i;`,
    );

    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);

    const [r] = consultar<{ e: string[]; l: number; nulos: number }>(
      banco.conexao,
      `SELECT c.entidades_habilitadas AS e, c.limite_registros_lote AS l,
         (SELECT count(*)::int FROM integracao_fdv.registro_publicado WHERE erp_id IS NULL) AS nulos
       FROM integracao_fdv.credencial c WHERE c.tenant_id = '${C.id}'`,
    );
    expect(r).toEqual({ e: ENTIDADES, l: 5000, nulos: 2 });
    // Reexecutar o SQL da 0015 não muda nada nem falha (idempotente).
    const [m] = listarMigracoes().filter((x) => x.nome === MIGRACAO);
    rodarScript(banco.conexao, `\\i '${m!.caminho}'`, { transacao: true });
  });
});
