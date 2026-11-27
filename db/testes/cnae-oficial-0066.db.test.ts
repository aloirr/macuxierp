/**
 * T-0106, migração 0066: tabela oficial CNAE 2.3 (subclasses) com a carga versionada do IBGE/CONCLA, leitura geral para
 * os três papéis, e as leituras da ficha da empresa (cnae_descricoes e municipio_nomes), só do macuxierp_config.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { lerFontes, PASTA_OFICIAIS } from '../src/oficiais.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarScript,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0066_cadastros_cnae_oficial.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const PAPEIS = ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura'] as const;
const FUNCOES = ['plataforma.cnae_descricoes(text[])', 'plataforma.municipio_nomes(text[])'];
const A = novoTenant('cnae-0066-a');

const CNAE = lerFontes().find((c) => c.carga === 'cnae')!;

describe('carga CNAE 2.3 (sem banco)', () => {
  it('subclasses de 7 dígitos, hierarquia coerente, sem repetidas', () => {
    const corpo = readFileSync(join(PASTA_OFICIAIS, CNAE.arquivo), 'utf8').trimEnd().split('\n');
    expect(corpo[0]).toBe('codigo,descricao,secao,divisao,grupo,classe');
    const codigos = corpo.slice(1).map((l) => {
      const m = /^"(\d{7})","[^"]+","([A-U])","(\d{2})","(\d{3})","(\d{5})"$/.exec(l);
      expect(m, l).not.toBeNull();
      const [, codigo, , divisao, grupo, classe] = m!;
      expect([classe, grupo, divisao], l).toEqual([
        codigo!.slice(0, 5),
        classe!.slice(0, 3),
        grupo!.slice(0, 2),
      ]);
      return codigo;
    });
    expect(new Set(codigos).size).toBe(codigos.length);
  });
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — CNAE oficial e nomes para a ficha (T-0106, 0066)', () => {
  let banco: BancoDeTeste;

  const ler = <T>(sql: string): T =>
    (consultar<{ r: T }>(banco.conexao, `SELECT (${sql}) AS r`, { papel: CONFIG })[0] as { r: T }).r;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao);
    permitirSetRole(banco.conexao);
    executar(banco.conexao, fixturePlataforma(A));
  });

  afterAll(() => banco?.remover());

  it('carga: amostra de códigos conhecidos', () => {
    expect(
      consultar(
        banco.conexao,
        `SELECT codigo, descricao, secao, divisao, grupo, classe, vigencia_inicio::text AS inicio FROM cadastros.cnae
         WHERE codigo IN ('0111301', '9900800') ORDER BY codigo`,
      ),
    ).toEqual([
      {
        codigo: '0111301',
        descricao: 'CULTIVO DE ARROZ',
        secao: 'A',
        divisao: '01',
        grupo: '011',
        classe: '01113',
        inicio: '2026-11-25',
      },
      {
        codigo: '9900800',
        descricao: 'ORGANISMOS INTERNACIONAIS E OUTRAS INSTITUIÇÕES EXTRATERRITORIAIS',
        secao: 'U',
        divisao: '99',
        grupo: '990',
        classe: '99008',
        inicio: '2026-11-25',
      },
    ]);
  });

  it('GRANT: app, worker e leitura só leem (todo tenant vê a de referência); nenhum grava; o config não lê direto', () => {
    for (const papel of PAPEIS) {
      expect(
        consultar(banco.conexao, `SELECT count(*)::int AS n FROM cadastros.cnae`, { papel, tenant: A.id }),
      ).toEqual([{ n: 1332 }]);
      const erro = falha(() =>
        executar(banco.conexao, `UPDATE cadastros.cnae SET descricao = 'x' WHERE codigo = '0111301';`, {
          papel,
          tenant: A.id,
        }),
      );
      expect(erro, papel).toMatch(/permission denied/);
    }
    expect(
      consultar(
        banco.conexao,
        `SELECT c.relrowsecurity AS rls,
           has_table_privilege('${CONFIG}', 'cadastros.cnae', 'SELECT') AS config,
           (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'cadastros' AND tablename = 'cnae'
              AND policyname = 'isolamento_tenant' AND qual LIKE '%tenant_referencia()%') AS politica
         FROM pg_class c WHERE c.oid = 'cadastros.cnae'::regclass`,
      ),
    ).toEqual([{ rls: true, config: false, politica: 1 }]);
  });

  it('privilégios das funções: só macuxierp_config; SECURITY DEFINER, search_path fixo, comentadas', () => {
    for (const f of FUNCOES) {
      const [r] = consultar<Record<string, unknown>>(
        banco.conexao,
        `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg, p.provolatile AS vol,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           pg_get_function_result(p.oid) AS retorno,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
           has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
           has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker,
           has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
      );
      expect({ f, ...r }).toEqual({
        f,
        definer: true,
        cfg: 'search_path=pg_catalog, pg_temp',
        vol: 's',
        comentado: true,
        retorno: 'jsonb',
        publico: false,
        app: false,
        worker: false,
        leitura: false,
        config: true,
      });
    }
  });

  it('cnae_descricoes: ordem recebida, sem repetidos, só dígitos, desconhecido ignorado; NULL e vazio = []', () => {
    expect(
      ler(
        `plataforma.cnae_descricoes(ARRAY['4711302', '0000000', '01.11-3-01', '4711302', 'x', NULL, '6201501'])`,
      ),
    ).toEqual([
      {
        codigo: '4711302',
        descricao:
          'COMÉRCIO VAREJISTA DE MERCADORIAS EM GERAL, COM PREDOMINÂNCIA DE PRODUTOS ALIMENTÍCIOS - SUPERMERCADOS',
      },
      { codigo: '0111301', descricao: 'CULTIVO DE ARROZ' },
      { codigo: '6201501', descricao: 'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA' },
    ]);
    expect(ler(`plataforma.cnae_descricoes(NULL)`)).toEqual([]);
    expect(ler(`plataforma.cnae_descricoes('{}'::text[])`)).toEqual([]);
    // A ficha da 0063 guarda cnae_secundarios como jsonb de códigos: o portal passa a lista como text[].
    expect(
      ler(
        `plataforma.cnae_descricoes(ARRAY(SELECT jsonb_array_elements_text('["0111302", "9999999"]'::jsonb)))`,
      ),
    ).toEqual([{ codigo: '0111302', descricao: 'CULTIVO DE MILHO' }]);
  });

  it('municipio_nomes: [{codigo, nome, uf}] na ordem recebida, sem repetidos, desconhecido ignorado', () => {
    expect(ler(`plataforma.municipio_nomes(ARRAY['3550308', '9999999', '1302603', '1302603'])`)).toEqual([
      { codigo: '3550308', nome: 'São Paulo', uf: 'SP' },
      { codigo: '1302603', nome: 'Manaus', uf: 'AM' },
    ]);
    expect(ler(`plataforma.municipio_nomes(NULL)`)).toEqual([]);
  });

  it('lista acima de 1000 códigos = 22023 nas duas', () => {
    for (const f of ['cnae_descricoes', 'municipio_nomes']) {
      recusaDetalhada(
        banco.conexao,
        `SELECT plataforma.${f}(array_fill('0111301'::text, ARRAY[1001]));`,
        '22023',
        /acima de 1000/,
        { papel: CONFIG },
      );
    }
    expect(
      ler<unknown[]>(`plataforma.cnae_descricoes(array_fill('0111301'::text, ARRAY[1000]))`),
    ).toHaveLength(1);
  });

  it('reexecutar a 0066 não muda tabela, carga, funções nem privilégios', () => {
    const retrato = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM cadastros.cnae) AS linhas,
           (SELECT max(updated_at)::text FROM cadastros.cnae) AS tocada,
           (SELECT count(*)::int FROM cadastros.tabela_oficial_versao WHERE carga = 'cnae') AS versoes,
           (SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint
              WHERE conrelid = 'cadastros.cnae'::regclass) AS restricoes,
           (SELECT string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, ''), ';' ORDER BY 1)
              FROM pg_proc p WHERE p.oid = ANY (ARRAY['${FUNCOES.join("'::regprocedure, '")}'::regprocedure]::oid[])) AS acl,
           has_table_privilege('macuxierp_leitura', 'cadastros.cnae', 'SELECT') AS leitura`,
      );
    const antes = retrato();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(retrato()).toEqual(antes);
  });
});
