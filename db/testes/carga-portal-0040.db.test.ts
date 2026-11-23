/**
 * T-0058 (v0.3.5a), migração 0040: carga de cadastros SÍNCRONA pelo portal /config (contrato
 * packages/platform-sdk/src/portal-cargas.ts). tx1 portal_carga_iniciar e tx3 portal_carga_concluir como
 * macuxierp_config (sessão de superadmin, auditoria com superadmin_id, MXC01/MXC03/MXC04 com DETAIL); a aba lê
 * portal_carga_situacao. A inativação do Substituir tudo é do domain do cadastros (sem função no banco); a 0040 só dá
 * os índices parciais dos ativos, a lista dos cadastros num lugar só (CHECK) e a interna plataforma.modulo_licenciado.
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
  privilegiosDe,
  recusaComDetalhe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0040_cadastros_carga_portal.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
/** Com a massa completa de cadastros. */
const A = novoTenant('carga-0040-a');
const B = novoTenant('carga-0040-b');
/** Sem a licença do cadastros. */
const C = novoTenant('carga-0040-c');
/** Licenciada, mas suspensa. */
const D = novoTenant('carga-0040-d');
/** Licenciada, ativa e vazia (dependências). */
const V = novoTenant('carga-0040-v');
/** Para a concorrência (MXC01) e a abandonada. */
const W = novoTenant('carga-0040-w');
const SA = '5a000000-0000-4000-8000-000000000401';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
/** CADASTROS_CARGA_PORTAL do SDK, na ordem (o teste do db não importa o SDK: trava a cópia aqui). */
const CADASTROS = ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco'];
const DEPENDE_DE: Record<string, string[]> = {
  filial: [],
  vendedor: ['filial'],
  forma_pagamento: [],
  prazo_pagamento: ['forma_pagamento'],
  produto: [],
  produto_unidade: ['produto'],
  preco: ['produto', 'filial'],
  estoque: ['produto', 'filial'],
  cliente: ['filial', 'vendedor', 'prazo_pagamento', 'preco'],
  cliente_endereco: ['cliente'],
};

const PORTAL = [
  'cadastros.portal_carga_iniciar(uuid, text, text, text)',
  'cadastros.portal_carga_concluir(uuid, uuid, text, integer, integer, integer, text)',
  'cadastros.portal_carga_situacao(uuid)',
] as const;
const INTERNAS = [
  'cadastros.portal_carga_cadastros()',
  'cadastros.portal_carga_dependencias(text)',
  'plataforma.modulo_licenciado(uuid, text)',
  'cadastros.portal_carga_ativos(uuid, text)',
  'cadastros.portal_carga_ultima(uuid, text)',
] as const;

interface Linha {
  cadastro: string;
  ativos: number;
  erros: number;
  ultima_carga: { em: string; quantidade: number } | null;
}
interface Situacao {
  empresa_id: string;
  modulo_licenciado: boolean;
  cadastros: Linha[];
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — carga de cadastros pelo portal /config (T-0058, 0040)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const recusaConfig = (sql: string, codigo: string, padrao: RegExp, s: string | null = sessao): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: CONFIG });
  /** Recusa com o SQLSTATE e o DETAIL exatos. */
  const recusaDetalhe = (sql: string, codigo: string, detalhe: string): void =>
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, detalhe, { papel: CONFIG });
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const iniciarSql = (t: string, cadastro: string, modo = 'adicionar', req = 'req-ini'): string =>
    `SELECT cadastros.portal_carga_iniciar('${t}', '${cadastro}', '${modo}', '${req}');`;
  const iniciar = (t: string, cadastro: string, modo = 'adicionar', req = 'req-ini'): string =>
    comoConfig(iniciarSql(t, cadastro, modo, req))[0] as string;
  const concluirSql = (t: string, id: string, resultado: string, g: number, e: number, i: number | null, req = 'req-fim'): string =>
    `SELECT cadastros.portal_carga_concluir('${t}', '${id}', '${resultado}', ${g}, ${e}, ${i === null ? 'NULL' : i}, '${req}');`;
  const concluir = (t: string, id: string, resultado: string, g: number, e: number, i: number | null, req = 'req-fim'): void =>
    void comoConfig(concluirSql(t, id, resultado, g, e, i, req));
  const situacao = (t: string): Situacao =>
    JSON.parse(comoConfig(`SELECT cadastros.portal_carga_situacao('${t}');`)[0] ?? 'null') as Situacao;
  const nAuditoria = (t: string): number =>
    um<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE tenant_id = '${t}' AND acao LIKE 'cadastros.carga.%'`).n;
  /** Tudo do tenant nas tabelas que as funções tocam (isolamento e reexecução). */
  const retrato = (t: string): unknown =>
    consultar(
      banco.conexao,
      `SELECT t, l FROM (SELECT 'carga' AS t, to_jsonb(c) AS l FROM cadastros.carga_portal c WHERE tenant_id = '${t}'
       UNION ALL SELECT 'vendedor', to_jsonb(v) FROM cadastros.vendedor v WHERE tenant_id = '${t}'
       UNION ALL SELECT 'condicao', to_jsonb(p) FROM cadastros.condicao_pagamento p WHERE tenant_id = '${t}'
       UNION ALL SELECT 'auditoria', to_jsonb(a) FROM plataforma.auditoria a WHERE tenant_id = '${t}'
      ) x ORDER BY t, l::text`,
    );

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}${fixtureModulos(A)}${fixturePlataforma(B)}${fixtureModulos(B)}
${fixturePlataforma(C)}${fixturePlataforma(D)}${fixturePlataforma(V)}${fixturePlataforma(W)}
UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = '${C.id}' AND modulo = 'cadastros';
UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${D.id}';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0040@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) EXECUTE: portal só do config, internas de ninguém (todas DEFINER); search_path fixo; tabela sem privilégio', () => {
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
        config: (PORTAL as readonly string[]).includes(f),
      });
    }
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura', CONFIG]) {
      expect({ papel, p: privilegiosDe(banco.conexao, papel, 'cadastros.carga_portal') }).toEqual({ papel, p: '-' });
    }
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      for (const sql of [iniciarSql(A.id, 'filial'), concluirSql(A.id, randomUUID(), 'concluida', 1, 0, null), `SELECT cadastros.portal_carga_situacao('${A.id}');`]) {
        recusaDetalhada(banco.conexao, sql, '42501', /permission denied/, { papel, tenant: A.id });
      }
    }
    recusaConfig('SELECT count(*) FROM cadastros.carga_portal;', '42501', /permission denied/);
    recusaConfig('SELECT count(*) FROM cadastros.filial;', '42501', /permission denied/);
    // a lista e as dependências são o espelho de CADASTROS_CARGA_PORTAL
    expect(um(`SELECT cadastros.portal_carga_cadastros() AS c`)).toEqual({ c: CADASTROS });
    for (const c of CADASTROS) expect({ c, d: um<{ d: string[] }>(`SELECT cadastros.portal_carga_dependencias('${c}') AS d`).d }).toEqual({ c, d: DEPENDE_DE[c] });
    // nenhuma função da 0040 cita schema de outro módulo (plataforma é a base: sessão, empresa, licença e auditoria)
    const citam = consultar<{ f: string }>(
      banco.conexao,
      `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
        WHERE p.oid = ANY (ARRAY[${[...PORTAL, ...INTERNAS].map((f) => `'${f}'::regprocedure`).join(', ')}]::oid[])
          AND p.prosrc ~ '(^|[^a-z_])(core|pedido|faturamento|fiscal|integracao_fdv|sefaz_simulador)\\.'`,
    );
    expect(citam).toEqual([]);
  });

  it('(b) sem sessão = MXS01; empresa de referência ou inexistente = P0002; sem auditoria', () => {
    for (const sql of [iniciarSql(A.id, 'filial'), concluirSql(A.id, randomUUID(), 'concluida', 1, 0, null), `SELECT cadastros.portal_carga_situacao('${A.id}');`]) {
      recusaConfig(sql, 'MXS01', /sessão de superadmin inválida/, null);
    }
    for (const t of [REFERENCIA, randomUUID()]) {
      recusaConfig(iniciarSql(t, 'filial'), 'P0002', /empresa não encontrada/);
      recusaConfig(`SELECT cadastros.portal_carga_situacao('${t}');`, 'P0002', /empresa não encontrada/);
    }
    expect(nAuditoria(A.id)).toBe(0);
  });

  it('(c) MXC04: empresa suspensa (empresa_inativa) e cadastros sem licença ativa ou vigente (modulo_desligado); a situação segue', () => {
    recusaDetalhe(iniciarSql(D.id, 'filial'), 'MXC04', 'empresa_inativa');
    recusaDetalhe(iniciarSql(C.id, 'filial'), 'MXC04', 'modulo_desligado');
    expect(situacao(C.id).modulo_licenciado).toBe(false);
    executar(banco.conexao, `UPDATE plataforma.tenant_modulo SET ativo = true, valido_ate = now() - interval '1 day' WHERE tenant_id = '${C.id}' AND modulo = 'cadastros';`);
    recusaDetalhe(iniciarSql(C.id, 'filial'), 'MXC04', 'modulo_desligado');
    expect(situacao(C.id).modulo_licenciado).toBe(false);
    expect(situacao(D.id).modulo_licenciado).toBe(true);
    expect([nAuditoria(C.id), nAuditoria(D.id)]).toEqual([0, 0]);
    expect(um(`SELECT count(*)::int AS n FROM cadastros.carga_portal WHERE tenant_id IN ('${C.id}', '${D.id}')`)).toEqual({ n: 0 });
  });

  it('(d) cadastro ou modo fora do contrato = 23514', () => {
    recusaConfig(iniciarSql(V.id, 'titulo'), '23514', /cadastro fora da carga/);
    recusaConfig(`SELECT cadastros.portal_carga_iniciar('${V.id}', NULL, 'adicionar', 'r');`, '23514', /cadastro fora da carga/);
    recusaConfig(iniciarSql(V.id, 'filial', 'zerar'), '23514', /modo fora do contrato/);
    expect(nAuditoria(V.id)).toBe(0);
  });

  it('(e) MXC03 com a dependência nao_carregado; libera com registro ativo ou com erro na última carga (o dependenciaPendente do SDK)', () => {
    recusaDetalhe(iniciarSql(V.id, 'vendedor'), 'MXC03', 'dependencia_pendente');
    recusaDetalhe(iniciarSql(V.id, 'cliente_endereco'), 'MXC03', 'dependencia_pendente');
    // a forma de pagamento sem ativo, mas com erro na última carga concluída: o prazo fica liberado
    const forma = iniciar(V.id, 'forma_pagamento');
    concluir(V.id, forma, 'concluida', 0, 3, null);
    const prazo = iniciar(V.id, 'prazo_pagamento');
    concluir(V.id, prazo, 'falhou', 0, 0, null);
    // a filial ativa (gravada como o BKO) libera o vendedor
    recusaDetalhe(iniciarSql(V.id, 'vendedor'), 'MXC03', 'dependencia_pendente');
    executar(
      banco.conexao,
      `INSERT INTO cadastros.filial (tenant_id, cnpj, razao_social, crt, logradouro, numero, bairro, municipio_ibge, uf, cep)
         VALUES ('${V.id}', '12345678000195', 'Filial V', '3', 'Rua A', '1', 'Centro', '1302603', 'AM', '69000000');`,
    );
    const vend = iniciar(V.id, 'vendedor');
    concluir(V.id, vend, 'concluida', 1, 0, null);
  });

  it('(f) MXC01 com execução aberta há menos de 15 min (qualquer cadastro); a de 15 min ou mais vira abandonada e libera', () => {
    const primeira = iniciar(W.id, 'filial');
    recusaDetalhe(iniciarSql(W.id, 'produto'), 'MXC01', 'carga_em_andamento');
    recusaDetalhe(iniciarSql(W.id, 'filial'), 'MXC01', 'carga_em_andamento');
    // outra empresa não é barrada
    const deB = iniciar(B.id, 'produto');
    concluir(B.id, deB, 'falhou', 0, 0, null);
    executar(banco.conexao, `UPDATE cadastros.carga_portal SET iniciada_em = now() - interval '14 minutes' WHERE id = '${primeira}';`);
    recusaDetalhe(iniciarSql(W.id, 'produto'), 'MXC01', 'carga_em_andamento');
    executar(banco.conexao, `UPDATE cadastros.carga_portal SET iniciada_em = now() - interval '15 minutes' WHERE id = '${primeira}';`);
    const segunda = iniciar(W.id, 'produto');
    expect(um(`SELECT resultado, concluida_em IS NOT NULL AS fechada, gravadas, com_erro, inativadas FROM cadastros.carga_portal WHERE id = '${primeira}'`)).toEqual({
      resultado: 'abandonada',
      fechada: true,
      gravadas: null,
      com_erro: null,
      inativadas: null,
    });
    // a abandonada não fecha mais
    recusaDetalhe(concluirSql(W.id, primeira, 'concluida', 1, 0, null), '23514', 'execucao_invalida');
    concluir(W.id, segunda, 'concluida', 2, 0, null);
  });

  it('(g) iniciar -> concluir grava as contagens e as duas auditorias com superadmin_id, sem dado pessoal; concluir inválido = 23514', () => {
    const id = iniciar(A.id, 'vendedor', 'substituir_tudo', 'req-g1');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // de outra empresa, resultado ou contagens fora do contrato, inativadas ausente no Substituir tudo
    for (const sql of [
      concluirSql(B.id, id, 'concluida', 1, 0, 0),
      concluirSql(A.id, randomUUID(), 'concluida', 1, 0, 0),
      concluirSql(A.id, id, 'abandonada', 1, 0, 0),
      concluirSql(A.id, id, 'concluida', -1, 0, 0),
      concluirSql(A.id, id, 'concluida', 1, -1, 0),
      concluirSql(A.id, id, 'concluida', 1, 0, -1),
      concluirSql(A.id, id, 'concluida', 1, 0, null),
      `SELECT cadastros.portal_carga_concluir('${A.id}', '${id}', 'concluida', NULL, 0, 0, 'r');`,
    ]) {
      recusaDetalhe(sql, '23514', 'execucao_invalida');
    }
    concluir(A.id, id, 'concluida', 5, 2, 1, 'req-g2');
    expect(
      um(`SELECT cadastro, modo, superadmin_id, request_id, resultado, gravadas, com_erro, inativadas,
                 concluida_em >= iniciada_em AS ordem FROM cadastros.carga_portal WHERE id = '${id}'`),
    ).toEqual({ cadastro: 'vendedor', modo: 'substituir_tudo', superadmin_id: SA, request_id: 'req-g1', resultado: 'concluida', gravadas: 5, com_erro: 2, inativadas: 1, ordem: true });
    recusaDetalhe(concluirSql(A.id, id, 'concluida', 5, 2, 1), '23514', 'execucao_invalida');
    const aud = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT acao, entidade, entidade_id, usuario_id, superadmin_id, request_id, antes, depois FROM plataforma.auditoria
        WHERE tenant_id = '${A.id}' AND entidade_id = '${id}' ORDER BY ocorrido_em, acao DESC`,
    );
    expect(aud).toEqual([
      { acao: 'cadastros.carga.iniciar', entidade: 'carga_portal', entidade_id: id, usuario_id: null, superadmin_id: SA, request_id: 'req-g1', antes: null, depois: { cadastro: 'vendedor', modo: 'substituir_tudo' } },
      {
        acao: 'cadastros.carga.concluir',
        entidade: 'carga_portal',
        entidade_id: id,
        usuario_id: null,
        superadmin_id: SA,
        request_id: 'req-g2',
        antes: null,
        depois: { cadastro: 'vendedor', modo: 'substituir_tudo', resultado: 'concluida', gravadas: 5, com_erro: 2, inativadas: 1 },
      },
    ]);
    expect(JSON.stringify(aud)).not.toMatch(/sa0040|Ficticio|@|argon/);
    // adicionar não leva inativadas
    const ad = iniciar(A.id, 'filial');
    recusaDetalhe(concluirSql(A.id, ad, 'concluida', 1, 0, 0), '23514', 'execucao_invalida');
    concluir(A.id, ad, 'concluida', 1, 0, null);
  });

  it('(h) situação: os 10 cadastros na ordem, ativos do tenant, erros e última carga da última execução concluída', () => {
    const p1 = iniciar(A.id, 'produto');
    concluir(A.id, p1, 'concluida', 7, 4, null);
    const p2 = iniciar(A.id, 'produto');
    concluir(A.id, p2, 'concluida', 3, 0, null);
    const p3 = iniciar(A.id, 'produto');
    concluir(A.id, p3, 'falhou', 0, 9, null);
    const s = situacao(A.id);
    expect(Object.keys(s).sort()).toEqual(['cadastros', 'empresa_id', 'modulo_licenciado']);
    expect(s.empresa_id).toBe(A.id);
    expect(s.modulo_licenciado).toBe(true);
    expect(s.cadastros.map((c) => c.cadastro)).toEqual(CADASTROS);
    for (const c of s.cadastros) expect(Object.keys(c).sort()).toEqual(['ativos', 'cadastro', 'erros', 'ultima_carga']);
    const por = Object.fromEntries(s.cadastros.map((c) => [c.cadastro, c]));
    // a massa: um de cada; a condição da fixture não tem forma_external_id (forma = 0)
    expect(Object.fromEntries(s.cadastros.map((c) => [c.cadastro, c.ativos]))).toEqual({
      filial: 1, vendedor: 1, forma_pagamento: 0, prazo_pagamento: 1, produto: 1, produto_unidade: 1, preco: 1, estoque: 1, cliente: 1, cliente_endereco: 1,
    });
    // a última concluída do produto é a p2 (a p3 falhou): 3 gravadas, 0 erro
    const [p2em] = linhas(rodarScript(banco.conexao, `SELECT plataforma.instante_iso(concluida_em) FROM cadastros.carga_portal WHERE id = '${p2}';`));
    expect(por.produto).toEqual({ cadastro: 'produto', ativos: 1, erros: 0, ultima_carga: { em: p2em, quantidade: 3 } });
    expect(por.produto!.ultima_carga!.em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(por.vendedor).toMatchObject({ erros: 2, ultima_carga: { quantidade: 5 } });
    expect(por.cliente).toEqual({ cadastro: 'cliente', ativos: 1, erros: 0, ultima_carga: null });
    // isolamento: B só vê o seu (a execução falhada de B não conta)
    expect(situacao(B.id).cadastros.every((c) => c.ultima_carga === null && c.erros === 0)).toBe(true);
    // sem auditoria na leitura
    const antes = nAuditoria(A.id);
    situacao(A.id);
    expect(nAuditoria(A.id)).toBe(antes);
  });

  it('(i) a lista num lugar só (o CHECK usa portal_carga_cadastros), a licença genérica, os índices parciais e sem inativação no banco', () => {
    // RD-1171: o CHECK da tabela é a interna IMMUTABLE; cadastro fora dela = 23514 até para a dona
    expect(
      consultar<{ d: string }>(
        banco.conexao,
        `SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c
          WHERE c.conrelid = 'cadastros.carga_portal'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%cadastro %'`,
      ),
    ).toEqual([{ d: 'CHECK ((cadastro = ANY (cadastros.portal_carga_cadastros())))' }]);
    expect(um(`SELECT provolatile AS v FROM pg_proc WHERE oid = 'cadastros.portal_carga_cadastros()'::regprocedure`)).toEqual({ v: 'i' });
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.carga_portal (tenant_id, cadastro, modo, superadmin_id) VALUES ('${A.id}', 'titulo', 'adicionar', '${SA}');`,
      '23514',
      /carga_portal_cadastro_check/,
    );
    // RD-1172: a licença é a interna genérica de plataforma (a do cadastros foi embora); sem a inativação no banco (regra 2)
    expect(
      um(
        `SELECT plataforma.modulo_licenciado('${A.id}', 'cadastros') AS a, plataforma.modulo_licenciado('${C.id}', 'cadastros') AS c,
           plataforma.modulo_licenciado('${A.id}', 'modulo-inexistente') AS x,
           to_regprocedure('cadastros.portal_carga_licenciado(uuid)') IS NULL AS sem_licenciado,
           (SELECT count(*)::int FROM pg_proc WHERE proname = 'carga_inativar_ausentes') AS inativar`,
      ),
    ).toEqual({ a: true, c: false, x: false, sem_licenciado: true, inativar: 0 });
    // os índices parciais dos ativos (o inativarEmLote do módulo e a contagem da situação)
    const ix = consultar<{ i: string; d: string }>(
      banco.conexao,
      `SELECT c.relname AS i, pg_get_indexdef(c.oid) AS d FROM pg_class c
        WHERE c.relnamespace = 'cadastros'::regnamespace AND c.relkind = 'i' AND c.relname LIKE '%\\_carga\\_ativos\\_ix'`,
    );
    expect(ix.map((x) => x.i).sort()).toEqual(
      ['cliente', 'cliente_endereco', 'condicao_pagamento', 'condicao_pagamento_forma', 'estoque_saldo', 'filial', 'produto', 'produto_unidade', 'tabela_preco_item', 'vendedor'].map(
        (t) => `${t}_carga_ativos_ix`,
      ),
    );
    for (const { i, d } of ix) {
      const colunas = i.endsWith('estoque_saldo_carga_ativos_ix') ? '(tenant_id)' : i.endsWith('forma_carga_ativos_ix') ? '(tenant_id, forma_external_id)' : '(tenant_id, external_id)';
      expect({ i, d }).toEqual({ i, d: expect.stringContaining(`${colunas} WHERE (deleted_at IS NULL)`) });
    }
  });

  it('(j) reexecução da 0040 não muda dado', () => {
    const antes = [A, B, V, W].map((t) => retrato(t.id));
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect([A, B, V, W].map((t) => retrato(t.id))).toEqual(antes);
    expect(um(`SELECT cadastros.portal_carga_cadastros() AS c`)).toEqual({ c: CADASTROS });
  });
});
