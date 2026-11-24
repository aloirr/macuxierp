/**
 * T-0086 §5, migração 0053 (RN-CAD-10 emendada em 24/11/2026): o cadastros.portal_zerar marca no espelho do FDV, antes de
 * apagar e na mesma transação, o que sai do ERP e já foi publicado (ativo = false, pendente, payload com ativo = false e
 * o hash novo), pela integracao_fdv.portal_inativar_espelho. A integração ligada não bloqueia; o lote em voo bloqueia
 * (MXI03); falha no espelho não apaga nada; os mantidos não mudam; o espelho não é limpo e o cursor não volta ao início.
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
  type Tenant,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(
  new URL('../migrations/0053_integracao_fdv_zerar_inativa.sql', import.meta.url),
);
const CONFIG = 'macuxierp_config';
const A = novoTenant('zerar-0053-a');
const B = novoTenant('zerar-0053-b');
const SA = '5a000000-0000-4000-8000-000000000531';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SCHEMAS = ['cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao_fdv', 'core', 'plataforma'];
const INTERNAS = [
  'integracao_fdv.json_canonico(jsonb)',
  'integracao_fdv.hash_registro(jsonb)',
  'integracao_fdv.portal_inativar_espelho(uuid, text[], jsonb)',
  'integracao_fdv.portal_inativar_linhas(uuid, uuid[])',
];
const ZERAR = 'cadastros.portal_zerar(uuid, jsonb, text)';
const CONFIRMADO = 'a'.repeat(64);

// Registros do tenant A que o plano apaga (dados fictícios) e as chaves do Hub deles no espelho.
const X = {
  filial: randomUUID(),
  vendedor: randomUUID(),
  /** No espelho, mas nunca publicado: sai do espelho (deleted_at), sem inativação pendente. */
  vendedor2: randomUUID(),
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
};

/** Linha publicada (confirmada) do espelho; `confirmado = false` = nunca foi ao Hub. */
const espelho = (
  t: string,
  entidade: string,
  chave: string,
  erpId: string | null,
  payload: Record<string, unknown>,
  refs: Record<string, string> = {},
  confirmado = true,
): string => `
INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em,
  fonte_ocorrido_em, fonte_refs, ativo, pendente, hash_confirmado, confirmado_em, erp_id)
  VALUES ('${t}', '${entidade}', '${chave}', '${JSON.stringify({ external_id: chave, ativo: true, ...payload })}',
    '${CONFIRMADO}', '2026-11-21T12:00:00.123Z', '2026-11-21T12:00:00.123Z', '${JSON.stringify(refs)}', true, ${!confirmado},
    ${confirmado ? `'${CONFIRMADO}', now()` : 'NULL, NULL'}, ${erpId === null ? 'NULL' : `'${erpId}'`});`;

const extrasDeA = (t: Tenant): string => `
INSERT INTO cadastros.filial (id, tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep)
  VALUES ('${X.filial}', '${t.id}', '11222333000181', 'Filial livre', '3', 'Rua C', '3', 'Centro', '1302603', 'AM', '69000002');
INSERT INTO cadastros.vendedor (id, tenant_id, codigo, nome, filial_id)
  VALUES ('${X.vendedor}', '${t.id}', 'V2', 'Vendedor livre', '${t.filial}'),
         ('${X.vendedor2}', '${t.id}', 'V3', 'Vendedor novo', '${t.filial}');
INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias)
  VALUES ('${X.condicao}', '${t.id}', 'PX', 'PIX', '17', '{0}');
INSERT INTO cadastros.tabela_preco (id, tenant_id, nome, vigencia_inicio) VALUES ('${X.tabela}', '${t.id}', 'Promo', '2026-01-01');
INSERT INTO cadastros.produto (id, tenant_id, codigo, descricao, ncm, unidade_comercial, unidade_tributavel, grupo_tributacao,
  custo_centavos) VALUES ('${X.produto}', '${t.id}', 'P2', 'Suco 1 L', '22021000', 'UN', 'UN', 'padrao', 299);
INSERT INTO cadastros.produto_unidade (id, tenant_id, produto_id, unidade, fator) VALUES ('${X.unidade}', '${t.id}', '${X.produto}', 'CX', 60000);
INSERT INTO cadastros.tabela_preco_item (id, tenant_id, tabela_preco_id, filial_id, produto_id, preco_centavos)
  VALUES ('${X.item}', '${t.id}', '${X.tabela}', '${t.filial}', '${X.produto}', 990);
INSERT INTO cadastros.estoque_saldo (id, tenant_id, filial_id, produto_id, quantidade) VALUES ('${X.saldo}', '${t.id}', '${t.filial}', '${X.produto}', 5000);
INSERT INTO cadastros.estoque_movimento (id, tenant_id, filial_id, produto_id, tipo, quantidade, motivo)
  VALUES ('${X.movimento}', '${t.id}', '${t.filial}', '${X.produto}', 'entrada', 5000, 'carga inicial');
INSERT INTO cadastros.cliente (id, tenant_id, tipo_pessoa, documento, ind_ie_dest, razao_social, condicao_pagamento_id,
  tabela_preco_id, filial_id, vendedor_id, limite_credito_centavos)
  VALUES ('${X.cliente}', '${t.id}', 'PJ', '11444777000161', '9', 'Cliente livre', '${X.condicao}', '${X.tabela}', '${t.filial}',
    '${X.vendedor}', 0);
INSERT INTO cadastros.cliente_endereco (id, tenant_id, cliente_id, tipo, logradouro, numero, bairro, municipio_ibge, uf, cep)
  VALUES ('${X.endereco}', '${t.id}', '${X.cliente}', 'principal', 'Rua D', '4', 'Centro', '1302603', 'AM', '69000003');
INSERT INTO cadastros.cliente_contato (id, tenant_id, cliente_id, nome) VALUES ('${X.contato}', '${t.id}', '${X.cliente}', 'Financeiro');
-- espelho do que sai (publicado), do que nunca foi ao Hub e dos mantidos
${espelho(t.id, 'filial', 'F2', X.filial, { nome: 'Filial livre' })}
${espelho(t.id, 'vendedor', 'V2', X.vendedor, { nome: 'Vendedor livre' }, { filial_id: t.filial })}
${espelho(t.id, 'vendedor', 'V3', X.vendedor2, { nome: 'Vendedor novo' }, { filial_id: t.filial }, false)}
${espelho(t.id, 'prazo_pagamento', 'PX', X.condicao, { forma_external_id: 'FX', codigo: 'PX', parcelas_dias: [0] }, { condicao_pagamento_id: X.condicao })}
${espelho(t.id, 'forma_pagamento', 'FX', null, { codigo: '17', nome: 'PIX' }, { condicao_pagamento_id: X.condicao })}
-- a forma FA veio da condição que sai, mas o prazo PA (mantido) ainda a usa: fica ativa
${espelho(t.id, 'forma_pagamento', 'FA', null, { codigo: '01', nome: 'Dinheiro' }, { condicao_pagamento_id: X.condicao })}
${espelho(t.id, 'prazo_pagamento', 'PA', randomUUID(), { forma_external_id: 'FA', codigo: 'AV', parcelas_dias: [0] })}
${espelho(t.id, 'produto', 'P2', X.produto, { sku: 'P2', nome: 'Suco 1 L', unidade: 'UN' })}
${espelho(t.id, 'produto', 'P1', t.produto, { sku: 'P1', nome: 'Refrigerante 2 L', unidade: 'UN' })}
${espelho(t.id, 'produto_unidade', 'U2', X.unidade, { produto_external_id: 'P2', unidade: 'CX', fator: 6, padrao: false }, { produto_id: X.produto })}
${espelho(t.id, 'preco', 'PR2', randomUUID(), { produto_external_id: X.produto, preco_cents: 990 }, { tabela_preco_id: X.tabela, produto_id: X.produto, filial_id: t.filial })}
${espelho(t.id, 'estoque', 'E2', randomUUID(), { produto_external_id: X.produto, saldo: 0.5 }, { filial_id: t.filial, produto_id: X.produto })}
${espelho(t.id, 'estoque', 'E1', randomUUID(), { produto_external_id: t.produto, saldo: 10 }, { filial_id: t.filial, produto_id: t.produto })}
${espelho(t.id, 'cliente', 'C2', X.cliente, { razao_social: 'Cliente livre' }, { filial_id: t.filial, vendedor_id: X.vendedor })}
-- integração ligada em todas as entidades da F2
UPDATE integracao_fdv.credencial SET entidades_habilitadas = integracao_fdv.portal_entidades_f2()::integracao_fdv.entidade_hub[]
 WHERE tenant_id = '${t.id}';
${espelho(t.id, 'cliente_endereco', 'CE2', X.endereco, { cliente_external_id: 'C2', logradouro: 'Rua D' }, { cliente_id: X.cliente })}
`;

/** O plano que o domain montaria: tudo de X sai; o produto e o cliente da massa estão em pedido (mantidos). */
const PLANO = {
  apagar: [
    { tabela: 'filial', ids: [X.filial] },
    { tabela: 'vendedor', ids: [X.vendedor, X.vendedor2] },
    { tabela: 'condicao_pagamento', ids: [X.condicao] },
    { tabela: 'produto', ids: [X.produto] },
    { tabela: 'produto_unidade', ids: [X.unidade] },
    { tabela: 'tabela_preco_item', ids: [X.item] },
    { tabela: 'estoque_saldo', ids: [X.saldo] },
    { tabela: 'estoque_movimento', ids: [X.movimento] },
    { tabela: 'cliente', ids: [X.cliente] },
    { tabela: 'cliente_endereco', ids: [X.endereco] },
    { tabela: 'cliente_contato', ids: [X.contato] },
  ],
  em_uso: [
    { tabela: 'produto', ids: [A.produto] },
    { tabela: 'cliente', ids: [A.cliente] },
  ],
};

const INATIVACAO = [
  { entidade: 'filial', quantidade: 1 },
  { entidade: 'vendedor', quantidade: 1 },
  { entidade: 'forma_pagamento', quantidade: 1 },
  { entidade: 'prazo_pagamento', quantidade: 1 },
  { entidade: 'produto', quantidade: 1 },
  { entidade: 'produto_unidade', quantidade: 1 },
  { entidade: 'preco', quantidade: 1 },
  { entidade: 'estoque', quantidade: 1 },
  { entidade: 'cliente', quantidade: 1 },
  { entidade: 'cliente_endereco', quantidade: 1 },
];

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — zerar inativa o espelho do FDV (T-0086, 0053)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const zerarSql = (plano: unknown, req = 'req-zerar-0053'): string =>
    `${sessaoSql(sessao)}SELECT cadastros.portal_zerar('${A.id}', '${JSON.stringify(plano)}'::jsonb, '${req}');`;
  const zerar = (plano: unknown, req?: string): unknown =>
    JSON.parse(linhas(rodarComo(banco.conexao, zerarSql(plano, req), { papel: CONFIG }))[0] ?? 'null');
  const recusaZerar = (codigo: string, detalhe: string, dica: string): void => {
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(zerarSql(PLANO)), { papel: CONFIG }));
    expect({
      codigo: e.saida.includes(codigo),
      detalhe: /DETAIL:\s+(\S+)/.exec(e.saida)?.[1],
      dica: /HINT:\s+(\S+)/.exec(e.saida)?.[1],
    }).toEqual({ codigo: true, detalhe, dica });
  };
  const inativarSql = (entidades: string, ids: string): string =>
    `SELECT integracao_fdv.portal_inativar_espelho('${A.id}', ${entidades}, ${ids});`;
  /** Retrato (contagem e hash do conteúdo) das tabelas do tenant. */
  const retrato = (t: string): Record<string, string> => {
    const com = tabelasDos(banco.conexao, SCHEMAS)
      .map((x) => `${x.esquema}.${x.tabela}`)
      .filter(
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
  const linhaEspelho = (chave: string) =>
    um<Record<string, unknown>>(
      `SELECT ativo, pendente, erp_id, deleted_at IS NOT NULL AS saiu, payload, hash = integracao_fdv.hash_registro(payload) AS hash_novo,
              hash_confirmado = '${CONFIRMADO}' AS confirmado, alterado_em > '2026-11-21T12:00:00.123Z' AS alterado,
              fonte_ocorrido_em > '2026-11-21T12:00:00.123Z' AS fonte_avancou, fonte_refs
         FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}' AND registro_external_id = '${chave}'`,
    );
  const ERP = (): Record<string, number> =>
    Object.fromEntries(
      (
        [
          ['filial', X.filial],
          ['vendedor', X.vendedor],
          ['condicao_pagamento', X.condicao],
          ['produto', X.produto],
          ['produto_unidade', X.unidade],
          ['tabela_preco_item', X.item],
          ['estoque_saldo', X.saldo],
          ['cliente', X.cliente],
          ['cliente_endereco', X.endereco],
        ] as const
      ).map(([t, id]) => [
        t,
        um<{ n: number }>(`SELECT count(*)::int AS n FROM cadastros.${t} WHERE id = '${id}'`).n,
      ]),
    );

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
    // B com o espelho publicado das mesmas chaves do Hub de A: não muda
    executar(
      banco.conexao,
      massa(B) +
        espelho(B.id, 'produto', 'P2', B.produto, { sku: 'P2' }) +
        espelho(B.id, 'filial', 'F2', B.filial, {}),
    );
    executar(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0053@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) as quatro novas são internas (SECURITY DEFINER, search_path fixo, comentadas, sem EXECUTE para ninguém); o zerar segue só do config', () => {
    for (const f of [...INTERNAS, ZERAR]) {
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
        config: f === ZERAR,
      });
    }
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura', CONFIG]) {
      recusaDetalhada(
        banco.conexao,
        `${sessaoSql(sessao)}${inativarSql(`ARRAY['produto']`, `'{}'::jsonb`)}`,
        '42501',
        /permission denied/,
        {
          papel,
          tenant: A.id,
        },
      );
    }
  });

  it('(b) hash_registro = hashRegistro do domain (JSON canônico, sem alterado_em; valores do canonico.ts real)', () => {
    // hashes gerados com modules/integracao-fdv/domain/canonico.ts (hashRegistro) sobre os mesmos objetos
    const casos: [unknown, string][] = [
      [
        {
          external_id: 'P2',
          ativo: false,
          sku: 'P2',
          nome: 'Suco "1 L"\n\tç ä 😀 \u0001\\/',
          unidade: 'UN',
          alterado_em: 'x',
        },
        '9342a7216d378188ec83581d3ec7887d5350a27a129073f18b0e702d40c608d8',
      ],
      [
        { B: 1, a: [3, 1.5, -0.25, 0.0001, { z: null, y: true }], aa: 'x', ä: 2, '': 0, fator: 12 },
        'f9526f5dad5b56fb87d1e5899b97c224335af670b282639881ff65cc7bd92c7a',
      ],
    ];
    for (const [p, h] of casos) {
      const lit = JSON.stringify(p).replace(/'/g, "''");
      expect(um<{ h: string }>(`SELECT integracao_fdv.hash_registro('${lit}'::jsonb) AS h`).h).toBe(h);
    }
  });

  it('(c) alvos fora do formato = 23514; lista vazia não trava nem muda nada', () => {
    const antes = retrato(A.id);
    for (const [ents, ids] of [
      [`ARRAY['produto']`, 'NULL'],
      [`ARRAY['produto']`, `'[]'::jsonb`],
      [`ARRAY['produto']`, `'{"cliente": []}'::jsonb`],
      [`ARRAY['produto']`, `'{"produto": "x"}'::jsonb`],
      [`ARRAY['produto']`, `'{"produto": [1]}'::jsonb`],
      [`ARRAY['produto']`, `'{"produto": [{}]}'::jsonb`],
      [`ARRAY['produto']`, `'{"produto": ["nao-uuid"]}'::jsonb`],
      [`ARRAY['estoque']`, `'{"estoque": [{"deposito_id": "${randomUUID()}"}]}'::jsonb`],
      [`ARRAY['estoque']`, `'{"estoque": [{"filial_id": 1}]}'::jsonb`],
      [`ARRAY['titulo']`, `'{}'::jsonb`],
    ]) {
      const e = falhaDetalhada(() => executar(banco.conexao, verboso(inativarSql(ents!, ids!))));
      expect({ ents, ids, ok: e.saida.includes('23514') }).toEqual({ ents, ids, ok: true });
    }
    expect(
      um<{ r: unknown }>(`${inativarSql(`'{}'::text[]`, `'{}'::jsonb`).replace(';', '')} AS r`).r,
    ).toEqual({ inativacao_fdv: [] });
    expect(retrato(A.id)).toEqual(antes);
  });

  it('(d) lote em voo numa entidade tocada = MXI03 lote_em_voo; nada muda', () => {
    const antes = retrato(A.id);
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, corpo, estado)
       SELECT tenant_id, 'estoque', id, 'delta', repeat('e', 64), '{}', 'montado' FROM integracao_fdv.credencial WHERE tenant_id = '${A.id}';`,
    );
    recusaZerar('MXI03', 'lote_em_voo', 'estoque');
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.lote_envio SET deleted_at = now() WHERE tenant_id = '${A.id}' AND estado = 'montado';`,
    );
    const depois = retrato(A.id);
    for (const k of Object.keys(antes).filter((x) => x !== 'integracao_fdv.lote_envio')) {
      expect({ k, h: depois[k] }).toEqual({ k, h: antes[k] });
    }
  });

  it('(e) a gravação no espelho falha: nada é apagado no ERP e o espelho não muda', () => {
    const antes = retrato(A.id);
    executar(
      banco.conexao,
      `CREATE FUNCTION public.falha_espelho_0053() RETURNS trigger LANGUAGE plpgsql
         AS $$ BEGIN RAISE EXCEPTION 'falha simulada do espelho'; END $$;
       CREATE TRIGGER falha_0053 BEFORE UPDATE ON integracao_fdv.registro_publicado FOR EACH ROW
           WHEN (NEW.tenant_id = '${A.id}') EXECUTE FUNCTION public.falha_espelho_0053();`,
    );
    try {
      const e = falhaDetalhada(() => executar(banco.conexao, zerarSql(PLANO), { papel: CONFIG }));
      expect(e.mensagem).toMatch(/falha simulada do espelho/);
    } finally {
      executar(
        banco.conexao,
        `DROP TRIGGER falha_0053 ON integracao_fdv.registro_publicado; DROP FUNCTION public.falha_espelho_0053();`,
      );
    }
    expect(Object.values(ERP()).every((n) => n === 1)).toBe(true);
    expect(retrato(A.id)).toEqual(antes);
  });

  it('(f) zerar com a integração ligada: inativa no espelho e apaga no ERP na mesma transação; mantidos, cursor e B intactos', () => {
    // ligada: todas as entidades da F2 habilitadas na credencial ativa
    expect(
      um<{ l: boolean }>(
        `SELECT integracao_fdv.portal_entidades_f2() <@ entidades_habilitadas::text[] AS l
           FROM integracao_fdv.credencial WHERE tenant_id = '${A.id}' AND substituida_em IS NULL AND deleted_at IS NULL`,
      ).l,
    ).toBe(true);
    const antesB = retrato(B.id);
    const mantidos = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT to_jsonb(r) - 'updated_at' AS r FROM integracao_fdv.registro_publicado r
          WHERE tenant_id = '${A.id}' AND registro_external_id IN ('P1', 'E1', 'FA', 'PA', '${A.cliente}') ORDER BY registro_external_id`,
      );
    const mantidosAntes = mantidos();
    const cursor = (): unknown =>
      um(
        `SELECT cursor_alterado_em, cursor_external_id FROM integracao_fdv.cursor_entidade
          WHERE tenant_id = '${A.id}' AND entidade = 'cliente'`,
      );
    const cursorAntes = cursor();

    expect(zerar(PLANO, 'req-zerar-0053-a')).toEqual({
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
        { tabela: 'vendedor', quantidade: 2 },
        { tabela: 'filial', quantidade: 1 },
      ],
      anulados: [],
      inativacao_fdv: INATIVACAO,
    });
    // apagou no ERP
    expect(Object.values(ERP()).every((n) => n === 0)).toBe(true);
    // espelho: inativo e pendente, com o payload de sempre (ativo = false) e o hash novo; sem o UUID antigo
    for (const chave of ['F2', 'V2', 'PX', 'FX', 'P2', 'U2', 'PR2', 'E2', 'C2', 'CE2']) {
      const l = linhaEspelho(chave);
      expect({ chave, ...l, payload: undefined, fonte_refs: undefined }).toEqual({
        chave,
        ativo: false,
        pendente: true,
        erp_id: null,
        saiu: false,
        payload: undefined,
        hash_novo: true,
        confirmado: true,
        alterado: true,
        fonte_avancou: true,
        fonte_refs: undefined,
      });
      expect({ chave, ativo: (l.payload as { ativo: boolean }).ativo }).toEqual({ chave, ativo: false });
      // a origem zerar no Log do conector (registro_publicado.fonte_refs.inativado_por, R-20261124-181938)
      expect({ chave, por: (l.fonte_refs as Record<string, unknown>).inativado_por }).toEqual({
        chave,
        por: 'zerar',
      });
    }
    expect(linhaEspelho('P2').payload as Record<string, unknown>).toEqual({
      external_id: 'P2',
      ativo: false,
      sku: 'P2',
      nome: 'Suco 1 L',
      unidade: 'UN',
    });
    // a marca soma às refs, sem perder as chaves de busca
    expect(linhaEspelho('PR2').fonte_refs).toEqual({
      tabela_preco_id: X.tabela,
      produto_id: X.produto,
      filial_id: A.filial,
      inativado_por: 'zerar',
    });
    // nunca publicado: sai do espelho, sem inativação nem marca
    expect(linhaEspelho('V3')).toMatchObject({
      saiu: true,
      erp_id: null,
      ativo: true,
      fonte_refs: { filial_id: A.filial },
    });
    // mantidos (em pedido), a forma ainda usada e o outro estoque não mudam
    expect(mantidos()).toEqual(mantidosAntes);
    // o espelho não foi limpo e o cursor não voltou ao início; a agenda foi antecipada
    expect(cursor()).toEqual(cursorAntes);
    expect(
      um<{ n: number }>(
        `SELECT count(*)::int AS n FROM integracao_fdv.cursor_entidade
          WHERE tenant_id = '${A.id}' AND entidade::text = ANY (ARRAY['produto', 'estoque', 'cliente']) AND proximo_em <= now()`,
      ).n,
    ).toBe(3);
    expect(retrato(B.id)).toEqual(antesB);
    // auditoria: só as contagens, mais a inativacao_fdv
    const [a] = consultar<{ depois: Record<string, unknown> }>(
      banco.conexao,
      `SELECT depois FROM plataforma.auditoria WHERE request_id = 'req-zerar-0053-a' AND acao = 'cadastros.dados.zerar'`,
    );
    expect(Object.keys(a!.depois).sort()).toEqual(['anulados', 'apagados', 'inativacao_fdv']);
    expect(a!.depois.inativacao_fdv).toEqual(INATIVACAO);
    const texto = JSON.stringify(a!.depois);
    for (const proibido of ['Suco', 'Cliente', 'P2', 'PR2', ...Object.values(X), A.cliente, A.produto]) {
      expect({ proibido, tem: texto.includes(proibido) }).toEqual({ proibido, tem: false });
    }
    // nada a inativar: a resposta e a auditoria ficam sem a inativacao_fdv
    expect(zerar({}, 'req-zerar-0053-vazio')).toEqual({ apagados: [], anulados: [] });
  });

  it('(g) reexecutar a 0053 não muda dado nem privilégio', () => {
    const priv = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT p.oid::regprocedure::text AS f, p.prosecdef, p.proconfig, p.proacl::text AS acl FROM pg_proc p
          WHERE p.oid = ANY (ARRAY[${[...INTERNAS, ZERAR].map((f) => `'${f}'::regprocedure`).join(', ')}]::oid[]) ORDER BY 1`,
      );
    const antes = [retrato(A.id), retrato(B.id), priv()];
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect([retrato(A.id), retrato(B.id), priv()]).toEqual(antes);
  });
});
