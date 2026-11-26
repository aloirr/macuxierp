/**
 * T-0106, migração 0070 (RD-2132 a 2134): a lista de códigos das leituras da ficha vira a interna
 * plataforma.codigos_pedidos.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  consultar,
  criarBancoDeTeste,
  executar,
  falha,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  recusaDetalhada,
  rodarScript,
} from './apoio.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0070_plataforma_codigos_pedidos.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const INTERNA = 'plataforma.codigos_pedidos(text[])';

/** Entradas que cobrem ordem, repetidos (também com máscara), desconhecidos, NULL, vazio, tamanho errado e o limite. */
const ENTRADAS = [
  `ARRAY['4711302', '0000000', '01.11-3-01', '4711302', 'x', NULL, '6201501', '47.11-3/02']`,
  `ARRAY['3550308', '9999999', '1302603', '1302603', '13026030', '130260', '', NULL]`,
  `ARRAY(SELECT jsonb_array_elements_text('["0111302", "9999999"]'::jsonb))`,
  `ARRAY[NULL]::text[]`,
  `NULL`,
  `'{}'::text[]`,
  `array_fill('0111301'::text, ARRAY[1000])`,
];

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — interna codigos_pedidos (T-0106, 0070)', () => {
  let banco: BancoDeTeste;

  const leituras = (): unknown =>
    consultar<{ r: unknown }>(
      banco.conexao,
      ENTRADAS.map(
        (e, n) =>
          `SELECT ${n} AS n, jsonb_build_array(plataforma.cnae_descricoes(${e}), plataforma.municipio_nomes(${e})) AS r`,
      ).join(' UNION ALL ') + ' ORDER BY n',
      { papel: CONFIG },
    );
  const recusas = (): void => {
    for (const f of ['cnae_descricoes', 'municipio_nomes'])
      recusaDetalhada(
        banco.conexao,
        `SELECT plataforma.${f}(array_fill('0111301'::text, ARRAY[1001]));`,
        '22023',
        /acima de 1000/,
        {
          papel: CONFIG,
        },
      );
  };
  let antes: unknown;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    const anteriores = pastaComMigracoesAntesDe('0070');
    try {
      migrar(banco.conexao, { pasta: anteriores.pasta });
    } finally {
      anteriores.remover();
    }
    permitirSetRole(banco.conexao);
    antes = leituras();
    recusas();
    migrar(banco.conexao);
  });

  afterAll(() => banco?.remover());

  it('interna sem EXECUTE para nenhum papel; SECURITY DEFINER, search_path fixo, comentada', () => {
    expect(
      consultar(
        banco.conexao,
        `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           pg_get_function_result(p.oid) AS retorno,
           (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner) AS executam
         FROM pg_proc p WHERE p.oid = '${INTERNA}'::regprocedure`,
      ),
    ).toEqual([
      {
        definer: true,
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        retorno: 'TABLE(codigo text, ordem bigint)',
        executam: 0,
      },
    ]);
    expect(
      falha(() =>
        executar(banco.conexao, `SELECT * FROM plataforma.codigos_pedidos(ARRAY['0111301']);`, {
          papel: CONFIG,
        }),
      ),
    ).toMatch(/permission denied/);
  });

  it('cnae_descricoes e municipio_nomes: o mesmo resultado e o mesmo 22023 de antes da 0070', () => {
    expect(leituras()).toEqual(antes);
    recusas();
  });

  it('reexecutar a 0070 não muda as funções nem os privilégios', () => {
    const retrato = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT p.oid::regprocedure::text AS f, coalesce(p.proacl::text, '') AS acl, md5(p.prosrc) AS corpo,
           obj_description(p.oid, 'pg_proc') AS comentario
         FROM pg_proc p
         WHERE p.oid = ANY (ARRAY['${INTERNA}'::regprocedure, 'plataforma.cnae_descricoes(text[])'::regprocedure,
           'plataforma.municipio_nomes(text[])'::regprocedure]::oid[])
         ORDER BY 1`,
      );
    const r = retrato();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(retrato()).toEqual(r);
  });
});
