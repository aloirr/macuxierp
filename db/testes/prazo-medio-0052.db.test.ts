/**
 * T-0085 (v0.3.12, migração 0052; ADR 0020): prazo_medio_dias (integer NULL, 0 a 999) em cadastros.condicao_pagamento e
 * cadastros.cliente; à vista (tPag 01, 04, 17) só com prazo médio nulo ou 0 (CHECK NOT VALID, linha inativa fora, padrão
 * da 0019); índice parcial (tenant_id, prazo_medio_dias) dos prazos ativos. O banco sobe até a 0051 com a massa (o
 * legado), depois recebe a 0052 (docs/banco/README.md).
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

const MIGRACAO = '0052_cadastros_prazo_medio.sql';
const CK_CONDICAO = 'condicao_prazo_medio_dias_ck';
const CK_CLIENTE = 'cliente_prazo_medio_dias_ck';
const CK_A_VISTA = 'condicao_prazo_medio_a_vista_ck';
const INDICE = 'condicao_pagamento_prazo_medio_ix';
const A = novoTenant('prazo-0052-a');
const APP_A = { papel: 'macuxierp_app', tenant: A.id };
const SA = '5a000000-0000-4000-8000-000000000521';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

/** Condição nova do tenant A; `prazo` = valor SQL de prazo_medio_dias, ou undefined para omitir a coluna. */
const condicao = (codigo: string, forma: string, prazo?: string): string =>
  `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias${
    prazo === undefined ? '' : ', prazo_medio_dias'
  }) VALUES ('${A.id}', '${codigo}', 'Condição ${codigo}', '${forma}', '{0}'${prazo === undefined ? '' : `, ${prazo}`});`;
const prazoDe = (tabela: string, filtro: string): unknown =>
  consultar<{ p: number | null }>(banco.conexao, `SELECT prazo_medio_dias AS p FROM cadastros.${tabela} WHERE ${filtro}`, APP_A);

let banco: BancoDeTeste;
let anteriores: PastaDeMigracoes;
let sessao: string;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — prazo médio no prazo e no cliente (T-0085, 0052)', () => {
  beforeAll(() => {
    banco = criarBancoDeTeste();
    anteriores = pastaComMigracoesAntesDe('0052');
    expect(migrar(banco.conexao, { pasta: anteriores.pasta, oficiais: false })).not.toContain(MIGRACAO);
    // Legado: a massa comum (condição AV à vista e cliente) gravada antes da 0052.
    executar(banco.conexao, fixturePlataforma(A) + fixtureModulos(A));
    expect(migrar(banco.conexao, { oficiais: false })).toContain(MIGRACAO);
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0052@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => {
    banco?.remover();
    anteriores?.remover();
  });

  it('colunas integer anuláveis, sem padrão e comentadas; CHECKs da faixa validados e o do à vista NOT VALID; índice parcial', () => {
    const colunas = consultar<{ tabela: string; tipo: string; nula: string; padrao: string | null; comentada: boolean }>(
      banco.conexao,
      `SELECT c.table_name AS tabela, c.data_type AS tipo, c.is_nullable AS nula, c.column_default AS padrao,
              col_description(format('cadastros.%I', c.table_name)::regclass, c.ordinal_position::int) ~ 'T-0085' AS comentada
       FROM information_schema.columns c
       WHERE c.table_schema = 'cadastros' AND c.column_name = 'prazo_medio_dias' ORDER BY c.table_name`,
    );
    expect(colunas).toEqual([
      { tabela: 'cliente', tipo: 'integer', nula: 'YES', padrao: null, comentada: true },
      { tabela: 'condicao_pagamento', tipo: 'integer', nula: 'YES', padrao: null, comentada: true },
    ]);
    const cks = consultar<{ nome: string; validada: boolean; def: string }>(
      banco.conexao,
      `SELECT conname AS nome, convalidated AS validada, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname IN ('${CK_CLIENTE}', '${CK_CONDICAO}', '${CK_A_VISTA}') ORDER BY conname`,
    );
    expect(cks.map(({ nome, validada }) => ({ nome, validada }))).toEqual([
      { nome: CK_CLIENTE, validada: true },
      { nome: CK_A_VISTA, validada: false },
      { nome: CK_CONDICAO, validada: true },
    ]);
    expect(cks[1]?.def).toMatch(/'01'.*'04'.*'17'/);
    const [ix] = consultar<{ def: string }>(banco.conexao, `SELECT indexdef AS def FROM pg_indexes WHERE indexname = '${INDICE}'`);
    expect(ix?.def).toMatch(/ON cadastros\.condicao_pagamento .*\(tenant_id, prazo_medio_dias\) WHERE \(deleted_at IS NULL\)/);
  });

  it('o legado sem prazo médio fica nulo e grava (UPDATE e INSERT sem a coluna)', () => {
    expect(prazoDe('condicao_pagamento', `codigo = 'AV'`)).toEqual([{ p: null }]);
    expect(prazoDe('cliente', `id = '${A.cliente}'`)).toEqual([{ p: null }]);
    executar(
      banco.conexao,
      `UPDATE cadastros.condicao_pagamento SET descricao = 'À vista (editada)' WHERE codigo = 'AV';
       UPDATE cadastros.cliente SET nome_fantasia = 'Fantasia' WHERE id = '${A.cliente}';
       ${condicao('SEM', '15')}`,
      APP_A,
    );
    expect(prazoDe('condicao_pagamento', `codigo IN ('AV', 'SEM') ORDER BY codigo`)).toEqual([{ p: null }, { p: null }]);
    expect(prazoDe('cliente', `id = '${A.cliente}'`)).toEqual([{ p: null }]);
  });

  it('1000 e -1 caem com 23514 no prazo e no cliente; 0 e 999 passam', () => {
    for (const v of ['1000', '-1']) {
      recusaDetalhada(banco.conexao, condicao(`F${v}`, '15', v), '23514', new RegExp(CK_CONDICAO), APP_A);
      recusaDetalhada(
        banco.conexao,
        `UPDATE cadastros.cliente SET prazo_medio_dias = ${v} WHERE id = '${A.cliente}';`,
        '23514',
        new RegExp(CK_CLIENTE),
        APP_A,
      );
    }
    executar(
      banco.conexao,
      `${condicao('B0', '15', '0')}${condicao('B999', '15', '999')}
       UPDATE cadastros.cliente SET prazo_medio_dias = 999 WHERE id = '${A.cliente}';`,
      APP_A,
    );
    expect(prazoDe('condicao_pagamento', `codigo IN ('B0', 'B999') ORDER BY codigo`)).toEqual([{ p: 0 }, { p: 999 }]);
    expect(prazoDe('cliente', `id = '${A.cliente}'`)).toEqual([{ p: 999 }]);
  });

  it('à vista (01, 04, 17) com 5 cai com 23514; com 0 ou nulo passa; boleto com 5 passa; a linha inativa fica fora', () => {
    for (const forma of ['01', '04', '17']) {
      recusaDetalhada(banco.conexao, condicao(`AV${forma}`, forma, '5'), '23514', new RegExp(CK_A_VISTA), APP_A);
    }
    recusaDetalhada(
      banco.conexao,
      `UPDATE cadastros.condicao_pagamento SET prazo_medio_dias = 5 WHERE codigo = 'AV';`,
      '23514',
      new RegExp(CK_A_VISTA),
      APP_A,
    );
    executar(
      banco.conexao,
      `${condicao('PIX0', '17', '0')}${condicao('DEB', '04', 'NULL')}${condicao('BOL5', '15', '5')}
       UPDATE cadastros.condicao_pagamento SET prazo_medio_dias = 0 WHERE codigo = 'AV';
       UPDATE cadastros.condicao_pagamento SET deleted_at = now() WHERE codigo = 'DEB';
       UPDATE cadastros.condicao_pagamento SET prazo_medio_dias = 5 WHERE codigo = 'DEB';`,
      APP_A,
    );
    expect(prazoDe('condicao_pagamento', `codigo IN ('AV', 'BOL5', 'DEB', 'PIX0') ORDER BY codigo`)).toEqual([
      { p: 0 },
      { p: 5 },
      { p: 5 },
      { p: 0 },
    ]);
    recusaDetalhada(
      banco.conexao,
      `UPDATE cadastros.condicao_pagamento SET deleted_at = NULL WHERE codigo = 'DEB';`,
      '23514',
      new RegExp(CK_A_VISTA),
      APP_A,
    );
  });

  it('a carga do portal (tx1 e tx3 do config, tx2 do app) grava o prazo médio do prazo e do cliente', () => {
    const comoConfig = (sql: string): string[] =>
      linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: 'macuxierp_config' }));
    const carga = (cadastro: string, gravar: string, gravadas: number): void => {
      const id = comoConfig(`SELECT cadastros.portal_carga_iniciar('${A.id}', '${cadastro}', 'adicionar', 'req-0052');`)[0];
      executar(banco.conexao, gravar, APP_A);
      comoConfig(`SELECT cadastros.portal_carga_concluir('${A.id}', '${id}', 'concluida', ${gravadas}, 0, NULL, 'req-0052');`);
    };
    carga(
      'condicao_pagamento',
      `INSERT INTO cadastros.condicao_pagamento (tenant_id, codigo, descricao, forma_tpag, prazos_dias, prazo_medio_dias,
         external_id) VALUES ('${A.id}', 'B28-56', 'Boleto 28/56', '15', '{28,56}', 42, 'PRZ-2856');
       UPDATE cadastros.condicao_pagamento SET prazo_medio_dias = 28 WHERE codigo = 'SEM';`,
      2,
    );
    carga(
      'cliente',
      `INSERT INTO cadastros.cliente (tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, filial_id,
         prazo_medio_dias, external_id) VALUES ('${A.id}', 'PJ', '11444777000161', '9', 'Cliente da carga', '${A.filial}', 45, 'CLI-45');
       UPDATE cadastros.cliente SET prazo_medio_dias = 30 WHERE id = '${A.cliente}';`,
      2,
    );
    expect(prazoDe('condicao_pagamento', `codigo IN ('B28-56', 'SEM') ORDER BY codigo`)).toEqual([{ p: 42 }, { p: 28 }]);
    expect(prazoDe('cliente', `external_id = 'CLI-45' OR id = '${A.cliente}' ORDER BY razao_social`)).toEqual([
      { p: 45 },
      { p: 30 },
    ]);
    const [r] = consultar<{ n: number }>(
      banco.conexao,
      `SELECT count(*)::int AS n FROM cadastros.carga_portal WHERE tenant_id = '${A.id}' AND resultado = 'concluida' AND gravadas = 2`,
    );
    expect(r).toEqual({ n: 2 });
  });

  it('a 0052 é reexecutável: rodar o arquivo de novo não dá erro, não duplica CHECK nem índice e não mexe nos dados', () => {
    const retrato = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conname IN ('${CK_CLIENTE}', '${CK_CONDICAO}', '${CK_A_VISTA}')) AS cks,
                (SELECT count(*)::int FROM pg_indexes WHERE indexname = '${INDICE}') AS ix,
                (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM cadastros.condicao_pagamento c) AS condicoes,
                (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM cadastros.cliente c) AS clientes`,
      );
    const antes = retrato();
    const m = listarMigracoes().find((x) => x.nome === MIGRACAO);
    rodarScript(banco.conexao, `BEGIN;\n${readFileSync(m?.caminho ?? '', 'utf8')}\nCOMMIT;`);
    expect(retrato()).toEqual(antes);
    expect(antes).toMatchObject([{ cks: 3, ix: 1 }]);
  });
});
