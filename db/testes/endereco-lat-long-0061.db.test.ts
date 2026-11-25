/**
 * T-0096 (v0.3.13, migração 0061): latitude e longitude numeric(9, 6) anuláveis em cadastros.cliente_endereco, com os
 * CHECKs da faixa (-90 a 90 e -180 a 180; o nulo passa). O banco sobe até a 0060 com a massa (o legado), depois recebe a
 * 0061; a carga e o zerar do portal seguem iguais com as colunas novas (docs/banco/README.md).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarMigracoes, migrar } from '../src/migrar.ts';
import {
  type BancoDeTeste,
  type PastaDeMigracoes,
  consultar,
  criarBancoDeTeste,
  executar,
  linhas,
  PG_DISPONIVEL,
  pastaComMigracoesAntesDe,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = '0061_cadastros_endereco_lat_long.sql';
const CK_LAT = 'cliente_endereco_latitude_ck';
const CK_LON = 'cliente_endereco_longitude_ck';
const A = novoTenant('latlong-0061-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const SA = '5a000000-0000-4000-8000-000000000611';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

let banco: BancoDeTeste;
let anteriores: PastaDeMigracoes;
let sessao: string;

const PRINCIPAL = `cliente_id = '${A.cliente}' AND tipo = 'principal'`;
/** Grava latitude e longitude (valores SQL) no endereço principal legado do tenant A, como o app. */
const gravar = (lat: string, lon: string): string =>
  `UPDATE cadastros.cliente_endereco SET latitude = ${lat}, longitude = ${lon} WHERE ${PRINCIPAL};`;
const coordenadas = (filtro = PRINCIPAL): unknown =>
  consultar(
    banco.conexao,
    `SELECT latitude::text AS lat, longitude::text AS lon FROM cadastros.cliente_endereco WHERE ${filtro} ORDER BY logradouro`,
    APP_A,
  );
/** Funções do portal /config, com a sessão do superadmin. */
const comoConfig = (sql: string): string[] =>
  linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: 'macuxierp_config' }));

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — coordenadas do endereço do cliente (T-0096, 0061)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0061');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    // Legado: a massa comum (cliente com endereço principal) gravada antes da 0061.
    executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A));
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0061@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('colunas numeric(9, 6) anuláveis, sem padrão e comentadas; CHECKs nomeados e validados; app grava as colunas', () => {
    expect(
      consultar(
        banco.conexao,
        `SELECT c.column_name AS coluna, c.data_type AS tipo, c.numeric_precision AS p, c.numeric_scale AS s,
                c.is_nullable AS nula, c.column_default AS padrao,
                col_description('cadastros.cliente_endereco'::regclass, c.ordinal_position::int) ~ 'T-0096' AS comentada,
                has_column_privilege('macuxierp_app', 'cadastros.cliente_endereco', c.column_name, 'INSERT')
                  AND has_column_privilege('macuxierp_app', 'cadastros.cliente_endereco', c.column_name, 'UPDATE') AS app,
                has_column_privilege('macuxierp_leitura', 'cadastros.cliente_endereco', c.column_name, 'SELECT')
                  AND has_column_privilege('macuxierp_worker', 'cadastros.cliente_endereco', c.column_name, 'SELECT') AS leem
           FROM information_schema.columns c
          WHERE c.table_schema = 'cadastros' AND c.table_name = 'cliente_endereco' AND c.column_name IN ('latitude', 'longitude')
          ORDER BY 1`,
      ),
    ).toEqual(
      ['latitude', 'longitude'].map((coluna) => ({
        coluna,
        tipo: 'numeric',
        p: 9,
        s: 6,
        nula: 'YES',
        padrao: null,
        comentada: true,
        app: true,
        leem: true,
      })),
    );
    const cks = consultar<{ nome: string; validada: boolean }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validada FROM pg_constraint
        WHERE conrelid = 'cadastros.cliente_endereco'::regclass AND conname IN ('${CK_LAT}', '${CK_LON}') ORDER BY 1`,
    );
    expect(cks).toEqual([
      { nome: CK_LAT, validada: true },
      { nome: CK_LON, validada: true },
    ]);
  });

  it('o legado fica nulo; o nulo passa no UPDATE e no INSERT', () => {
    expect(coordenadas()).toEqual([{ lat: null, lon: null }]);
    executar(
      banco.conexao,
      `${gravar('NULL', 'NULL')}
       INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep,
         latitude, longitude) VALUES ('${A.id}', '${A.cliente}', 'entrega', 'Rua Nula', '1', 'Centro', '1302603', 'AM', '69000004',
         NULL, -60.025);`,
      APP_A,
    );
    expect(coordenadas(`logradouro = 'Rua Nula'`)).toEqual([{ lat: null, lon: '-60.025000' }]);
  });

  it('os limites -90/90 e -180/180 passam; 90.000001, -90.000001, 180.000001 e -180.000001 caem com 23514', () => {
    for (const [lat, lon] of [
      ['-90', '-180'],
      ['90', '180'],
      ['-3.101944', '-60.025'],
    ] as const) {
      executar(banco.conexao, gravar(lat, lon), APP_A);
    }
    expect(coordenadas()).toEqual([{ lat: '-3.101944', lon: '-60.025000' }]);
    for (const v of ['90.000001', '-90.000001']) {
      recusaDetalhada(banco.conexao, gravar(v, '0'), '23514', new RegExp(CK_LAT), APP_A);
    }
    for (const v of ['180.000001', '-180.000001']) {
      recusaDetalhada(banco.conexao, gravar('0', v), '23514', new RegExp(CK_LON), APP_A);
    }
    expect(coordenadas()).toEqual([{ lat: '-3.101944', lon: '-60.025000' }]);
  });

  it('a carga do portal (tx1 e tx3 do config, tx2 do app) e o zerar listam e apagam o endereço com coordenada', () => {
    const carga = comoConfig(
      `SELECT cadastros.portal_carga_iniciar('${A.id}', 'cliente', 'adicionar', 'req-0061');`,
    )[0];
    executar(
      banco.conexao,
      `INSERT INTO cadastros.cliente_endereco (tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep,
         latitude, longitude, external_id) VALUES ('${A.id}', '${A.cliente}', 'cobranca', 'Rua Carga', '2', 'Centro', '1302603',
         'AM', '69000005', -3.1, -60.0, 'END-0061');`,
      APP_A,
    );
    comoConfig(
      `SELECT cadastros.portal_carga_concluir('${A.id}', '${carga}', 'concluida', 1, 0, NULL, 'req-0061');`,
    );
    expect(coordenadas(`external_id = 'END-0061'`)).toEqual([{ lat: '-3.100000', lon: '-60.000000' }]);
    const [{ id }] = consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM cadastros.cliente_endereco WHERE external_id = 'END-0061'`,
    ) as [{ id: string }];
    const fatos = JSON.parse(
      comoConfig(`SELECT cadastros.portal_zeragem_fatos('${A.id}', ARRAY['cliente']);`)[0] ?? 'null',
    ) as { tabelas: { tabela: string; linhas: { id: string; com_chave: boolean }[] }[] };
    expect(fatos.tabelas.find((t) => t.tabela === 'cliente_endereco')?.linhas).toContainEqual(
      expect.objectContaining({ id, com_chave: true }),
    );
    const plano = { apagar: [{ tabela: 'cliente_endereco', ids: [id] }] };
    comoConfig(
      `SELECT cadastros.portal_zerar('${A.id}', '${JSON.stringify(plano)}'::jsonb, 'req-zerar-0061');`,
    );
    expect(coordenadas(`external_id = 'END-0061'`)).toEqual([]);
    expect(coordenadas(`cliente_id = '${A.cliente}'`)).toEqual([
      { lat: '-3.101944', lon: '-60.025000' },
      { lat: null, lon: '-60.025000' },
    ]);
  });

  it('a 0061 é reexecutável: rodar o arquivo de novo não dá erro, não duplica CHECK e não mexe nos dados', () => {
    const retrato = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_constraint
                  WHERE conrelid = 'cadastros.cliente_endereco'::regclass AND conname IN ('${CK_LAT}', '${CK_LON}')) AS cks,
                (SELECT count(*)::int FROM pg_constraint
                  WHERE conrelid = 'cadastros.cliente_endereco'::regclass AND contype = 'c') AS todos,
                (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM cadastros.cliente_endereco e) AS enderecos`,
      );
    const antes = retrato();
    const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
    rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
    expect(retrato()).toEqual(antes);
    expect(antes).toMatchObject([{ cks: 2 }]);
  });
});
