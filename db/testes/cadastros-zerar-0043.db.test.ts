/**
 * T-0058 (lote B), migração 0043 (RN-CAD-10): zerar dados por cadastro pelo portal /config, no desenho final do
 * engenheiro-software. O banco só fornece os fatos (cadastros.portal_zeragem_fatos, pedido/faturamento
 * .portal_usos_cadastros, integracao_fdv.portal_estado_entidades) e aplica o plano do domain (cadastros.portal_zerar,
 * integracao_fdv.portal_zerar_espelho). Barreiras (42501, MXS01, P0002, MXC04, 23514), formatos exatos, usos por pedido,
 * nota e título, espelho zerado (CHECK da 0007), MXI03, MXC03, DELETE com estoque_movimento e o gatilho de volta,
 * auditoria só com contagens, o outro tenant intacto e nada fiscal muda.
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
  falha,
  falhaDetalhada,
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
  tabelasDos,
  verboso,
} from './apoio.ts';
import {
  fixtureFaturamento,
  fixtureIntegracao,
  fixtureModulos,
  fixturePedido,
  fixturePlataforma,
  novoTenant,
  RETRATO,
  type Tenant,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0043_cadastros_zerar.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
const A = novoTenant('zerar-0043-a');
const B = novoTenant('zerar-0043-b');
/** Suspensa. */
const D = novoTenant('zerar-0043-d');
/** Ativa, com o módulo cadastros desligado. */
const E = novoTenant('zerar-0043-e');
const SA = '5a000000-0000-4000-8000-000000000431';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

const FATOS = 'cadastros.portal_zeragem_fatos(uuid, text[])';
const ZERAR = 'cadastros.portal_zerar(uuid, jsonb, text)';
const USOS_PEDIDO = 'pedido.portal_usos_cadastros(uuid, jsonb)';
const USOS_FATURAMENTO = 'faturamento.portal_usos_cadastros(uuid, jsonb)';
const ESTADO = 'integracao_fdv.portal_estado_entidades(uuid, text[])';
const ESPELHO = 'integracao_fdv.portal_zerar_espelho(uuid, text[], text)';
const PORTAL = [FATOS, ZERAR, USOS_PEDIDO, USOS_FATURAMENTO, ESTADO, ESPELHO];
const INTERNAS = [
  'cadastros.portal_zerar_cadastros()',
  'cadastros.portal_zerar_tabelas()',
  'cadastros.portal_zerar_anulaveis()',
  'cadastros.portal_zerar_ids(jsonb, text)',
  'cadastros.portal_zerar_plano_valido(jsonb)',
  'cadastros.portal_zerar_empresa(uuid)',
  'integracao_fdv.portal_conferir_entidades(text[])',
  'plataforma.portal_refs_uuid(jsonb, text[])',
  'plataforma.empresa_alvo_leitura(uuid)',
];
const TABELAS = [
  'filial',
  'vendedor',
  'condicao_pagamento',
  'tabela_preco',
  'produto',
  'cliente',
  'produto_unidade',
  'tabela_preco_item',
  'estoque_saldo',
  'estoque_movimento',
  'cliente_endereco',
  'cliente_contato',
];
const SCHEMAS = ['cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao_fdv', 'core', 'plataforma'];
const FISCAIS = [
  'faturamento.nota',
  'faturamento.nota_item',
  'faturamento.nota_xml',
  'faturamento.nota_evento',
  'faturamento.transmissao',
  'faturamento.inutilizacao',
  'faturamento.serie_numeracao',
  'faturamento.contingencia',
  'faturamento.titulo',
  'faturamento.titulo_baixa',
  'faturamento.pedido_a_faturar',
  'faturamento.configuracao_filial',
  'faturamento.configuracao_filial_historico',
  'core.certificado',
  'core.ambiente_fiscal',
  'fiscal.regra_tributaria',
];

// Linhas extras do tenant A (dados fictícios): o que o plano apaga, o que fica em uso e o que é anulado.
const X = {
  filial: randomUUID(),
  vendedor: randomUUID(),
  condicao: randomUUID(),
  tabela: randomUUID(),
  produto: randomUUID(),
  unidade: randomUUID(),
  item: randomUUID(),
  saldo: randomUUID(),
  movimento: randomUUID(),
  cliente: randomUUID(),
  endereco: randomUUID(),
  contato: randomUUID(),
  /** Cliente em uso (pedido) que aponta para o vendedor e a condição que saem: o plano anula as colunas. */
  cliente2: randomUUID(),
  pedido: randomUUID(),
};

const extrasDeA = (t: Tenant): string => `
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep, external_id)
  VALUES ('${X.filial}', '${t.id}', '11222333000181', 'Filial livre', '3', 'Rua C', '3', 'Centro', '1302603', 'AM', '69000002', 'F2');
INSERT INTO cadastros.vendedor (id, tenant_id, codigo, nome, filial_id, external_id)
  VALUES ('${X.vendedor}', '${t.id}', 'V2', 'Vendedor livre', '${t.filial}', 'V2');
INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias)
  VALUES ('${X.condicao}', '${t.id}', 'PX', 'PIX', '17', '{0}');
INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio) VALUES ('${X.tabela}', '${t.id}', 'Promo', '2026-01-01');
INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao,
  custo_centavos, external_id) VALUES ('${X.produto}', '${t.id}', 'P2', 'Suco 1 L', '22021000', 'UN', 'UN', 'padrao', 299, 'P2');
INSERT INTO cadastros.produto_unidade (id, tenant_id, produto_id, unidade, fator) VALUES ('${X.unidade}', '${t.id}', '${X.produto}', 'CX', 60000);
INSERT INTO cadastros.tabela_preco_item (id, tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos)
  VALUES ('${X.item}', '${t.id}', '${X.tabela}', '${t.filial}', '${X.produto}', 990);
INSERT INTO cadastros.estoque_saldo (id, tenant_id, filial_id, produto_id, quantidade) VALUES ('${X.saldo}', '${t.id}', '${t.filial}', '${X.produto}', 5000);
INSERT INTO cadastros.estoque_movimento (id, tenant_id, filial_id, produto_id, tipo, quantidade, motivo)
  VALUES ('${X.movimento}', '${t.id}', '${t.filial}', '${X.produto}', 'entrada', 5000, 'carga inicial');
INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id,
  tabela_preco_id, filial_id, vendedor_id, limite_credito_centavos)
  VALUES ('${X.cliente}', '${t.id}', 'PJ', '11444777000161', '9', 'Cliente livre', '${X.condicao}', '${X.tabela}', '${t.filial}',
    '${X.vendedor}', 0),
  ('${X.cliente2}', '${t.id}', 'PJ', '11444777000242', '9', 'Cliente com pedido', '${X.condicao}', '${X.tabela}', '${t.filial}',
    '${X.vendedor}', 0);
INSERT INTO cadastros.cliente_endereco (id, tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
  VALUES ('${X.endereco}', '${t.id}', '${X.cliente}', 'principal', 'Rua D', '4', 'Centro', '1302603', 'AM', '69000003');
INSERT INTO cadastros.cliente_contato (id, tenant_id, cliente_id, nome) VALUES ('${X.contato}', '${t.id}', '${X.cliente}', 'Financeiro');
-- pedido do cliente2, com o vendedor e a condição que saem (o plano anula as colunas do cliente2, não o pedido)
INSERT INTO pedido.pedido (id, tenant_id, numero, origem, filial_id, cliente_id, vendedor_id, condicao_pagamento_id,
  cliente_retrato, emitido_em, total_centavos)
  VALUES ('${X.pedido}', '${t.id}', 3, 'bko', '${t.filial}', '${X.cliente2}', '${X.vendedor}', '${X.condicao}',
    '${RETRATO}', now(), 1000);
-- espelho do produto: um com payload confirmado (P2) e um anulado (payload nulo: inativo, não pendente, confirmado)
INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em,
  fonte_ocorrido_em, fonte_refs, ativo, pendente, hash_confirmado, confirmado_em, erp_id) VALUES
  ('${t.id}', 'produto', 'P2', '{"sku": "P2"}', repeat('4', 64), now(), now(), '{}', true, false, repeat('4', 64), now(), '${X.produto}'),
  ('${t.id}', 'produto', 'P9', NULL, repeat('5', 64), now(), now(), '{}', false, false, repeat('5', 64), now(), '${t.produto}');
INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, cursor_alterado_em, cursor_external_id, sessao_aberta_id, proximo_em)
  VALUES ('${t.id}', 'produto', now(), 'P2', gen_random_uuid(), now() + interval '1 day');
UPDATE integracao_fdv.credencial SET entidades_habilitadas = '{cliente}' WHERE tenant_id = '${t.id}';
`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — zerar dados por cadastro (T-0058, 0043)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const recusaConfig = (sql: string, codigo: string, padrao: RegExp, s: string | null = sessao): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: CONFIG });
  /** SQLSTATE, DETAIL e HINT da recusa como config. */
  const recusaCom = (sql: string, codigo: string, detalhe: string, dica?: string): void => {
    const e = falhaDetalhada(() =>
      executar(banco.conexao, verboso(`${sessaoSql(sessao)}${sql}`), { papel: CONFIG }),
    );
    expect({ sql, saida: e.saida }).toMatchObject({ sql, saida: expect.stringContaining(codigo) });
    const r: Record<string, string | undefined> = { sql, detalhe: /DETAIL:\s+(\S+)/.exec(e.saida)?.[1] };
    if (dica !== undefined) r.dica = /HINT:\s+(\S+)/.exec(e.saida)?.[1];
    expect(r).toEqual({ sql, detalhe, ...(dica !== undefined ? { dica } : {}) });
  };
  const json = <T>(sql: string): T => JSON.parse(comoConfig(sql)[0] ?? 'null') as T;
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const n = (sql: string): number => um<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`).n;
  const lit = (v: unknown): string => `'${JSON.stringify(v)}'::jsonb`;
  const fatosSql = (t: string, cad: string): string =>
    `SELECT cadastros.portal_zeragem_fatos('${t}', ${cad});`;
  const zerarSql = (t: string, plano: unknown, req = 'req-zerar'): string =>
    `SELECT cadastros.portal_zerar('${t}', ${typeof plano === 'string' ? plano : lit(plano)}, '${req}');`;
  const usosPedidoSql = (t: string, refs: unknown): string =>
    `SELECT pedido.portal_usos_cadastros('${t}', ${typeof refs === 'string' ? refs : lit(refs)});`;
  const usosFatSql = (t: string, refs: unknown): string =>
    `SELECT faturamento.portal_usos_cadastros('${t}', ${typeof refs === 'string' ? refs : lit(refs)});`;
  const estadoSql = (t: string, ents: string): string =>
    `SELECT integracao_fdv.portal_estado_entidades('${t}', ${ents});`;
  const espelhoSql = (t: string, ents: string, req = 'req-espelho'): string =>
    `SELECT integracao_fdv.portal_zerar_espelho('${t}', ${ents}, '${req}');`;
  const nAud = (t: string, acao: string): number =>
    n(`plataforma.auditoria WHERE tenant_id = '${t}' AND acao = '${acao}'`);
  /** Retrato (contagem e hash do conteúdo) das tabelas do tenant. */
  const retrato = (t: string, tabelas?: readonly string[]): Record<string, string> => {
    const lista = tabelas ?? tabelasDos(banco.conexao, SCHEMAS).map((x) => `${x.esquema}.${x.tabela}`);
    const com = lista.filter(
      (x) =>
        um<{ c: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '${x}'::regclass AND attname = 'tenant_id' AND NOT attisdropped) AS c`,
        ).c,
    );
    const r = consultar<{ t: string; h: string }>(
      banco.conexao,
      com
        .map(
          (x) =>
            `SELECT '${x}' AS t, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(z)::text, ',' ORDER BY to_jsonb(z)::text), '')) AS h
               FROM ${x} z WHERE z.tenant_id = '${t}'`,
        )
        .join('\nUNION ALL\n'),
    );
    return Object.fromEntries(r.map((x) => [x.t, x.h]));
  };
  const gatilho = (): string =>
    um<{ e: string }>(
      `SELECT tgenabled AS e FROM pg_trigger WHERE tgname = 'somente_insercao' AND tgrelid = 'cadastros.estoque_movimento'::regclass`,
    ).e;
  const ordenar = (ids: string[]): string[] => [...ids].sort();

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    const massa = (t: Tenant): string =>
      fixturePlataforma(t) +
      fixtureModulos(t) +
      fixturePedido(t) +
      fixtureFaturamento(t) +
      fixtureIntegracao(t);
    executar(banco.conexao, massa(A) + extrasDeA(A));
    executar(banco.conexao, massa(B) + fixturePlataforma(D) + fixturePlataforma(E));
    executar(
      banco.conexao,
      `UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${D.id}';
UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = '${E.id}' AND modulo = 'cadastros';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0043@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) EXECUTE só do config nas seis; internas de ninguém; SECURITY DEFINER, search_path fixo, comentadas; app, worker e leitura = 42501', () => {
    for (const f of [...PORTAL, ...INTERNAS]) {
      const r = um<Record<string, unknown>>(
        `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
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
        comentado: true,
        publico: false,
        app: false,
        worker: false,
        leitura: false,
        config: PORTAL.includes(f),
      });
    }
    expect(um(`SELECT cadastros.portal_zerar_tabelas() AS l`)).toEqual({ l: TABELAS });
    const chamadas = [
      fatosSql(A.id, `ARRAY['produto']`),
      zerarSql(A.id, {}),
      usosPedidoSql(A.id, {}),
      usosFatSql(A.id, {}),
      estadoSql(A.id, `ARRAY['produto']`),
      espelhoSql(A.id, `ARRAY['produto']`),
    ];
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      for (const sql of chamadas) {
        recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, '42501', /permission denied/, {
          papel,
          tenant: A.id,
        });
      }
    }
    // o config ganhou USAGE nos schemas, mas segue sem ler as tabelas
    for (const t of ['cadastros.produto', 'pedido.pedido', 'faturamento.nota']) {
      recusaConfig(`SELECT count(*) FROM ${t};`, '42501', /permission denied/);
    }
  });

  it('(b) sem sessão = MXS01; referência ou inexistente = P0002; MXC04 empresa_inativa e modulo_desligado só nas do cadastros', () => {
    const todas = (t: string): string[] => [
      fatosSql(t, `ARRAY['produto']`),
      zerarSql(t, {}),
      usosPedidoSql(t, {}),
      usosFatSql(t, {}),
      estadoSql(t, `ARRAY['produto']`),
      espelhoSql(t, `ARRAY['produto']`),
    ];
    for (const sql of todas(A.id)) recusaConfig(sql, 'MXS01', /sessão de superadmin inválida/, null);
    for (const t of [REFERENCIA, randomUUID()]) {
      for (const sql of todas(t)) recusaConfig(sql, 'P0002', /empresa não encontrada/);
    }
    for (const [t, detalhe] of [
      [D.id, 'empresa_inativa'],
      [E.id, 'modulo_desligado'],
    ] as const) {
      recusaCom(fatosSql(t, `ARRAY['produto']`), 'MXC04', detalhe);
      recusaCom(zerarSql(t, {}), 'MXC04', detalhe);
    }
    // as leituras dos outros schemas valem para a empresa visível, ativa ou não
    expect(json(usosPedidoSql(D.id, {}))).toEqual({ em_uso: [] });
    expect(json(usosFatSql(D.id, {}))).toEqual({ em_uso: [], filiais_com_nota: [] });
    expect(nAud(A.id, 'cadastros.dados.zerar')).toBe(0);
  });

  it('(c) cadastro, tabela, coluna, chave ou formato fora da lista fechada = 23514; nada muda', () => {
    const antes = retrato(A.id);
    for (const cad of [
      `'{}'::text[]`,
      'NULL',
      `ARRAY['produto', NULL]`,
      `ARRAY['produto', 'produto']`,
      `ARRAY['nota']`,
      `ARRAY['preco', 'titulo']`,
    ]) {
      recusaConfig(fatosSql(A.id, cad), '23514', /cadastros fora da lista/);
    }
    for (const plano of [
      'NULL',
      `'[]'::jsonb`,
      { apagar: [{ tabela: 'nota', ids: [A.nota] }] },
      { apagar: [{ tabela: 'produto', ids: [A.produto], extra: 1 }] },
      { apagar: [{ tabela: 'produto', ids: ['nao-e-uuid'] }] },
      { apagar: [{ tabela: 'produto', ids: A.produto }] },
      { apagar: { tabela: 'produto', ids: [A.produto] } },
      { anular: [{ tabela: 'cliente', coluna: 'filial_id', ids: [A.cliente] }] },
      { anular: [{ tabela: 'vendedor', coluna: 'filial_id', ids: [X.vendedor] }] },
      { anular: [{ tabela: 'cliente', ids: [A.cliente] }] },
      { em_uso: [{ tabela: 'pedido', ids: [A.pedido] }] },
      { outra: [] },
    ]) {
      recusaConfig(zerarSql(A.id, plano), '23514', /plano de zeragem fora do formato/);
    }
    for (const refs of [
      'NULL',
      { nota: [A.nota] },
      { produto: A.produto },
      { produto: ['x'] },
      { produto: [1] },
    ]) {
      recusaConfig(usosPedidoSql(A.id, refs), '23514', /referências fora do formato/);
      recusaConfig(usosFatSql(A.id, refs), '23514', /referências fora do formato/);
    }
    for (const ents of [
      'NULL',
      `ARRAY['produto', 'produto']`,
      `ARRAY['nota']`,
      `ARRAY['forma_prazo']`,
      `ARRAY['cliente', NULL]`,
    ]) {
      recusaConfig(estadoSql(A.id, ents), '23514', /entidades fora da F2/);
      recusaConfig(espelhoSql(A.id, ents), '23514', /entidades fora da F2/);
    }
    expect(retrato(A.id)).toEqual(antes);
  });

  it('(d) fatos: formato exato, só o alcance dos cadastros pedidos, refs das FKs e com_chave; nenhum outro dado', () => {
    type Linha = { id: string; refs: Record<string, string>; com_chave: boolean };
    type Fatos = { tabelas: { tabela: string; linhas: Linha[] }[] };
    const f = json<Fatos>(fatosSql(A.id, `ARRAY['produto']`));
    expect(Object.keys(f)).toEqual(['tabelas']);
    expect(f.tabelas.map((t) => t.tabela)).toEqual([
      'produto',
      'produto_unidade',
      'tabela_preco_item',
      'estoque_saldo',
      'estoque_movimento',
    ]);
    for (const t of f.tabelas) {
      expect(Object.keys(t).sort()).toEqual(['linhas', 'tabela']);
      for (const l of t.linhas) expect(Object.keys(l).sort()).toEqual(['com_chave', 'id', 'refs']);
    }
    const produto = f.tabelas[0]!.linhas;
    expect(produto).toEqual(
      [
        { id: A.produto, refs: {}, com_chave: false },
        { id: X.produto, refs: {}, com_chave: true },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(f.tabelas[2]!.linhas.find((l) => l.id === X.item)).toEqual({
      id: X.item,
      refs: { tabela_preco: X.tabela, filial: A.filial, produto: X.produto },
      com_chave: false,
    });
    // o texto não traz nenhum dado do cadastro
    const texto = JSON.stringify(f);
    for (const proibido of ['Suco', 'Refrigerante', 'P2', 'carga inicial']) {
      expect({ proibido, tem: texto.includes(proibido) }).toEqual({ proibido, tem: false });
    }
    // filial leva vendedor, cliente (com endereço e contato), preço e estoque que apontam para ela
    const fil = json<Fatos>(fatosSql(A.id, `ARRAY['filial']`));
    expect(fil.tabelas.map((t) => t.tabela)).toEqual([
      'filial',
      'vendedor',
      'cliente',
      'tabela_preco_item',
      'estoque_saldo',
      'estoque_movimento',
      'cliente_endereco',
      'cliente_contato',
    ]);
    expect(fil.tabelas[0]!.linhas.find((l) => l.id === X.filial)).toEqual({
      id: X.filial,
      refs: {},
      com_chave: true,
    });
    expect(fil.tabelas[2]!.linhas.find((l) => l.id === X.cliente)).toEqual({
      id: X.cliente,
      refs: {
        filial: A.filial,
        vendedor: X.vendedor,
        condicao_pagamento: X.condicao,
        tabela_preco: X.tabela,
      },
      com_chave: false,
    });
    // vendedor: só os clientes que apontam para ele (para anular), sem endereço nem contato
    const ven = json<Fatos>(fatosSql(A.id, `ARRAY['vendedor']`));
    expect(ven.tabelas.map((t) => t.tabela)).toEqual(['vendedor', 'cliente']);
    expect(ordenar(ven.tabelas[1]!.linhas.map((l) => l.id))).toEqual(
      ordenar([A.cliente, X.cliente, X.cliente2]),
    );
    const cli = json<Fatos>(fatosSql(A.id, `ARRAY['cliente', 'forma_prazo']`));
    expect(cli.tabelas.map((t) => t.tabela)).toEqual([
      'condicao_pagamento',
      'cliente',
      'cliente_endereco',
      'cliente_contato',
    ]);
    // só leitura: nenhuma auditoria
    expect(nAud(A.id, 'cadastros.dados.zerar')).toBe(0);
  });

  it('(e) usos por pedido, nota e título; filiais_com_nota; formatos exatos', () => {
    const refs = {
      filial: [A.filial, X.filial],
      vendedor: [X.vendedor],
      condicao_pagamento: [X.condicao],
      tabela_preco: [X.tabela],
      produto: [A.produto, X.produto],
      cliente: [A.cliente, X.cliente, X.cliente2],
    };
    expect(json(usosPedidoSql(A.id, refs))).toEqual({
      em_uso: [
        { tabela: 'filial', ids: [A.filial], motivo: 'pedido' },
        { tabela: 'vendedor', ids: [X.vendedor], motivo: 'pedido' },
        { tabela: 'condicao_pagamento', ids: [X.condicao], motivo: 'pedido' },
        { tabela: 'produto', ids: [A.produto], motivo: 'pedido' },
        { tabela: 'cliente', ids: ordenar([A.cliente, X.cliente2]), motivo: 'pedido' },
      ],
    });
    expect(json(usosFatSql(A.id, refs))).toEqual({
      em_uso: [
        { tabela: 'filial', ids: [A.filial], motivo: 'nota' },
        { tabela: 'filial', ids: [A.filial], motivo: 'titulo' },
        { tabela: 'produto', ids: [A.produto], motivo: 'nota' },
        { tabela: 'cliente', ids: [A.cliente], motivo: 'nota' },
        { tabela: 'cliente', ids: [A.cliente], motivo: 'titulo' },
      ],
      filiais_com_nota: [A.filial],
    });
    // os ids de B não aparecem para A (cada função filtra o tenant)
    expect(
      json(usosPedidoSql(A.id, { filial: [B.filial], cliente: [B.cliente], produto: [B.produto] })),
    ).toEqual({ em_uso: [] });
    expect(
      json(usosFatSql(A.id, { filial: [B.filial], cliente: [B.cliente], produto: [B.produto] })),
    ).toEqual({
      em_uso: [],
      filiais_com_nota: [],
    });
  });

  it('(f) estado das entidades e MXI03 com cadastro ligado ou lote em voo; nada muda', () => {
    const antes = retrato(A.id);
    expect(json(estadoSql(A.id, `ARRAY['produto', 'cliente', 'preco']`))).toEqual({
      entidades: [
        { entidade: 'produto', ligada: false, lote_em_voo: false },
        { entidade: 'cliente', ligada: true, lote_em_voo: false },
        { entidade: 'preco', ligada: false, lote_em_voo: false },
      ],
    });
    recusaCom(espelhoSql(A.id, `ARRAY['produto', 'cliente']`), 'MXI03', 'entidade_ligada', 'cliente');
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, corpo, estado)
       SELECT tenant_id, 'preco', id, 'delta', repeat('e', 64), '{}', 'montado' FROM integracao_fdv.credencial WHERE tenant_id = '${A.id}';`,
    );
    expect(json<{ entidades: unknown[] }>(estadoSql(A.id, `ARRAY['preco']`)).entidades).toEqual([
      { entidade: 'preco', ligada: false, lote_em_voo: true },
    ]);
    recusaCom(espelhoSql(A.id, `ARRAY['produto', 'preco']`), 'MXI03', 'lote_em_voo', 'preco');
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.lote_envio SET deleted_at = now() WHERE tenant_id = '${A.id}' AND estado = 'montado';`,
    );
    const depois = retrato(A.id);
    for (const k of Object.keys(antes).filter((x) => x !== 'integracao_fdv.lote_envio')) {
      expect({ k, h: depois[k] }).toEqual({ k, h: antes[k] });
    }
    expect(nAud(A.id, 'integracao-fdv.espelho.zerar')).toBe(0);
  });

  it('(g) espelho zerado: linha e registro_external_id ficam, erp_id e confirmação saem (CHECK da 0007), cursor zerado e antecipado', () => {
    const antesB = retrato(B.id);
    expect(json(espelhoSql(A.id, `ARRAY['produto', 'preco']`, 'req-espelho-a'))).toEqual({
      entidades: [
        { entidade: 'produto', registros: 2 },
        { entidade: 'preco', registros: 0 },
      ],
    });
    expect(
      consultar(
        banco.conexao,
        `SELECT registro_external_id AS x, erp_id, payload IS NULL AS sem_payload, hash_confirmado IS NULL AS sem_hash,
                confirmado_em IS NULL AS sem_conf, ativo, pendente
           FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}' AND entidade = 'produto' ORDER BY 1`,
      ),
    ).toEqual([
      {
        x: 'P2',
        erp_id: null,
        sem_payload: false,
        sem_hash: true,
        sem_conf: true,
        ativo: true,
        pendente: false,
      },
      // a linha anulada fica anulada (payload nulo exige a confirmação), só sem o erp_id
      {
        x: 'P9',
        erp_id: null,
        sem_payload: true,
        sem_hash: false,
        sem_conf: false,
        ativo: false,
        pendente: false,
      },
    ]);
    expect(
      um(
        `SELECT cursor_alterado_em, cursor_external_id, sessao_aberta_id, proximo_em <= now() AS antecipado
           FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' AND entidade = 'produto'`,
      ),
    ).toEqual({
      cursor_alterado_em: null,
      cursor_external_id: null,
      sessao_aberta_id: null,
      antecipado: true,
    });
    // o cliente (outra entidade) não muda
    expect(
      um(
        `SELECT erp_id FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}' AND entidade = 'cliente'`,
      ),
    ).toEqual({
      erp_id: A.cliente,
    });
    const [a] = consultar<{ depois: unknown; superadmin_id: string }>(
      banco.conexao,
      `SELECT depois, superadmin_id FROM plataforma.auditoria WHERE request_id = 'req-espelho-a'`,
    );
    expect(a).toEqual({
      depois: {
        entidades: [
          { entidade: 'produto', registros: 2 },
          { entidade: 'preco', registros: 0 },
        ],
      },
      superadmin_id: SA,
    });
    expect(retrato(B.id)).toEqual(antesB);
  });

  it('(h) MXC03: id em uso, id sumido, coluna a anular fora do plano e referência que segura o DELETE; nada muda e o gatilho fica ligado', () => {
    const antes = retrato(A.id);
    recusaCom(
      zerarSql(A.id, {
        apagar: [{ tabela: 'produto', ids: [A.produto] }],
        em_uso: [{ tabela: 'produto', ids: [A.produto] }],
      }),
      'MXC03',
      'em_uso',
      'produto',
    );
    recusaCom(
      zerarSql(A.id, { apagar: [{ tabela: 'produto', ids: [randomUUID()] }] }),
      'MXC03',
      'sumiu',
      'produto',
    );
    // o id de outro tenant também "sumiu" para A
    recusaCom(
      zerarSql(A.id, { apagar: [{ tabela: 'cliente', ids: [B.cliente] }] }),
      'MXC03',
      'sumiu',
      'cliente',
    );
    recusaCom(
      zerarSql(A.id, { anular: [{ tabela: 'cliente', coluna: 'vendedor_id', ids: [X.cliente2] }] }),
      'MXC03',
      'anular_fora_do_plano',
      'cliente.vendedor_id',
    );
    // o produto ainda tem unidade, item, saldo e movimento; o movimento sai junto, mas a unidade não
    recusaCom(
      zerarSql(A.id, {
        apagar: [
          { tabela: 'produto', ids: [X.produto] },
          { tabela: 'tabela_preco_item', ids: [X.item] },
          { tabela: 'estoque_saldo', ids: [X.saldo] },
          { tabela: 'estoque_movimento', ids: [X.movimento] },
        ],
      }),
      'MXC03',
      'referencia',
      'produto',
    );
    expect(gatilho()).toBe('O');
    expect(retrato(A.id)).toEqual(antes);
    expect(nAud(A.id, 'cadastros.dados.zerar')).toBe(0);
  });

  it('(i) zerar de fato: anula, apaga na ordem das FKs com o estoque_movimento, o gatilho volta, nada fiscal muda e B intacto', () => {
    const antesB = retrato(B.id);
    const fiscalA = retrato(A.id, FISCAIS);
    // o plano que o domain montaria para produto + cliente + vendedor + forma_prazo (o em uso fica e é anulado)
    const plano = {
      apagar: [
        { tabela: 'produto', ids: [X.produto] },
        { tabela: 'produto_unidade', ids: [X.unidade] },
        { tabela: 'tabela_preco_item', ids: [X.item] },
        { tabela: 'estoque_saldo', ids: [X.saldo] },
        { tabela: 'estoque_movimento', ids: [X.movimento] },
        { tabela: 'cliente', ids: [X.cliente] },
        { tabela: 'cliente_endereco', ids: [X.endereco] },
        { tabela: 'cliente_contato', ids: [X.contato] },
        { tabela: 'vendedor', ids: [X.vendedor] },
        { tabela: 'condicao_pagamento', ids: [X.condicao] },
      ],
      anular: [
        { tabela: 'cliente', coluna: 'vendedor_id', ids: [X.cliente2] },
        { tabela: 'cliente', coluna: 'condicao_pagamento_id', ids: [X.cliente2] },
      ],
      em_uso: [
        { tabela: 'produto', ids: [A.produto] },
        { tabela: 'cliente', ids: [A.cliente, X.cliente2] },
      ],
    };
    const r = json(zerarSql(A.id, plano, 'req-zerar-a'));
    expect(r).toEqual({
      apagados: [
        { tabela: 'cliente_contato', quantidade: 1 },
        { tabela: 'cliente_endereco', quantidade: 1 },
        { tabela: 'estoque_movimento', quantidade: 1 },
        { tabela: 'estoque_saldo', quantidade: 1 },
        { tabela: 'tabela_preco_item', quantidade: 1 },
        { tabela: 'produto_unidade', quantidade: 1 },
        { tabela: 'cliente', quantidade: 1 },
        { tabela: 'produto', quantidade: 1 },
        { tabela: 'condicao_pagamento', quantidade: 1 },
        { tabela: 'vendedor', quantidade: 1 },
      ],
      anulados: [
        { tabela: 'cliente', coluna: 'condicao_pagamento_id', quantidade: 1 },
        { tabela: 'cliente', coluna: 'vendedor_id', quantidade: 1 },
      ],
    });
    for (const [tabela, id] of [
      ['produto', X.produto],
      ['produto_unidade', X.unidade],
      ['tabela_preco_item', X.item],
      ['estoque_saldo', X.saldo],
      ['estoque_movimento', X.movimento],
      ['cliente', X.cliente],
      ['cliente_endereco', X.endereco],
      ['cliente_contato', X.contato],
      ['vendedor', X.vendedor],
      ['condicao_pagamento', X.condicao],
    ] as const) {
      expect({ tabela, n: n(`cadastros.${tabela} WHERE id = '${id}'`) }).toEqual({ tabela, n: 0 });
    }
    // a decisão do PO vem no plano: a tabela de preço e a ligação do cliente a ela ficam
    expect(n(`cadastros.tabela_preco WHERE id = '${X.tabela}'`)).toBe(1);
    expect(
      um(
        `SELECT vendedor_id, condicao_pagamento_id, tabela_preco_id FROM cadastros.cliente WHERE id = '${X.cliente2}'`,
      ),
    ).toEqual({
      vendedor_id: null,
      condicao_pagamento_id: null,
      tabela_preco_id: X.tabela,
    });
    // o que está em uso fica; o pedido não muda (o vendedor e a condição dele são retrato opaco)
    expect(n(`cadastros.produto WHERE id = '${A.produto}'`)).toBe(1);
    expect(n(`cadastros.estoque_movimento WHERE tenant_id = '${A.id}'`)).toBe(1);
    expect(um(`SELECT vendedor_id FROM pedido.pedido WHERE id = '${X.pedido}'`)).toEqual({
      vendedor_id: X.vendedor,
    });
    // o gatilho só de inserção voltou: o admin não apaga nem altera movimento
    expect(gatilho()).toBe('O');
    expect(
      falha(() =>
        executar(banco.conexao, `DELETE FROM cadastros.estoque_movimento WHERE tenant_id = '${A.id}';`),
      ),
    ).toMatch(/./);
    expect(
      falha(() =>
        executar(
          banco.conexao,
          `UPDATE cadastros.estoque_movimento SET motivo = 'x' WHERE tenant_id = '${A.id}';`,
        ),
      ),
    ).toMatch(/./);
    // nada fiscal muda; o outro tenant não muda
    expect(retrato(A.id, FISCAIS)).toEqual(fiscalA);
    expect(retrato(B.id)).toEqual(antesB);
    // o mesmo plano de novo: os ids sumiram = o estado mudou
    recusaCom(zerarSql(A.id, plano), 'MXC03', 'sumiu');
    // plano vazio: nada a fazer, mas audita
    expect(json(zerarSql(A.id, {}, 'req-zerar-vazio'))).toEqual({ apagados: [], anulados: [] });
  });

  it('(j) auditoria: uma linha por zerar, com superadmin e empresa, só com as contagens', () => {
    expect(nAud(A.id, 'cadastros.dados.zerar')).toBe(2);
    expect(nAud(B.id, 'cadastros.dados.zerar')).toBe(0);
    const [a] = consultar<{
      entidade: string;
      entidade_id: string;
      usuario_id: string | null;
      superadmin_id: string;
      antes: unknown;
      depois: { apagados: unknown[]; anulados: unknown[] };
    }>(
      banco.conexao,
      `SELECT entidade, entidade_id, usuario_id, superadmin_id, antes, depois FROM plataforma.auditoria WHERE request_id = 'req-zerar-a'`,
    );
    expect(a).toMatchObject({
      entidade: 'empresa',
      entidade_id: A.id,
      usuario_id: null,
      superadmin_id: SA,
      antes: null,
    });
    expect(Object.keys(a!.depois).sort()).toEqual(['anulados', 'apagados']);
    expect(a!.depois.apagados).toContainEqual({ tabela: 'produto', quantidade: 1 });
    const texto = JSON.stringify(a!.depois);
    for (const proibido of [
      'Cliente',
      'Suco',
      'Promo',
      '11444777000161',
      'P2',
      ...Object.values(X),
      A.cliente,
      A.produto,
    ]) {
      expect({ proibido, tem: texto.includes(proibido) }).toEqual({ proibido, tem: false });
    }
  });

  it('(k) reexecutar a 0043 não muda dado nem privilégio', () => {
    const antes = [retrato(A.id), retrato(B.id)];
    const priv = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT p.oid::regprocedure::text AS f, p.prosecdef, p.proconfig, p.proacl::text AS acl FROM pg_proc p
          WHERE p.oid = ANY (ARRAY[${[...PORTAL, ...INTERNAS].map((f) => `'${f}'::regprocedure`).join(', ')}]::oid[]) ORDER BY 1`,
      );
    const p = priv();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect([retrato(A.id), retrato(B.id)]).toEqual(antes);
    expect(priv()).toEqual(p);
    expect((p as unknown[]).length).toBe(PORTAL.length + INTERNAS.length);
    expect(gatilho()).toBe('O');
  });
});
