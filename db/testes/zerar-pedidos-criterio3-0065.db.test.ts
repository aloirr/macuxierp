/**
 * T-0093, critério 3 (desenho docs/desenho/T-0093.md §2), migração 0065: na transação do zerar de pedidos, a porta
 * aposZerarPedidos chama integracao_fdv.portal_liberar_reenvio_pedidos (apaga o pedido_recebido e os retornos dos
 * pedidos zerados, para o reenvio do Hub recriá-los) e faturamento.portal_descartar_a_faturar (a_faturar órfão vira
 * cancelado). Lista fechada, só do macuxierp_config, idempotentes, auditoria só com contagens; nota, XML e título não
 * mudam (regra 7).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../src/migrar.ts';
import { rodarScriptAssincrono } from '../src/psql.ts';
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
  verboso,
} from './apoio.ts';
import {
  fixtureFaturamento,
  fixtureIntegracao,
  fixtureModulos,
  fixturePedido,
  fixturePlataforma,
  novoTenant,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0065_zerar_pedidos_reenvio_fdv_a_faturar.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const A = novoTenant('zerar-0065-a');
const B = novoTenant('zerar-0065-b');
const SA = '5a000000-0000-4000-8000-000000000651';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const LIBERAR = 'integracao_fdv.portal_liberar_reenvio_pedidos(uuid, uuid[])';
const DESCARTAR = 'faturamento.portal_descartar_a_faturar(uuid, uuid[])';
const INTERNA = 'plataforma.portal_lista_pedidos(uuid, uuid[])';
/** Tabelas fiscais e financeiras que as duas nunca tocam (regra 7). */
const FISCAIS = [
  'faturamento.nota',
  'faturamento.nota_item',
  'faturamento.nota_xml',
  'faturamento.nota_evento',
  'faturamento.titulo',
  'faturamento.titulo_baixa',
  'faturamento.inutilizacao',
];

// Pedidos zerados de A (ids fictícios): P1 do FDV com retornos, P2 do FDV sem retorno, P3 faturado (defesa).
const P1 = randomUUID();
const P2 = randomUUID();
const P3 = randomUUID();
const U1 = randomUUID();
const U2 = randomUUID();
const UB = randomUUID();

const recebido = (t: string, uuid: string, pedido: string): string => `
INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado, pedido_id)
  VALUES ('${t}', '${uuid}', NULL, repeat('1', 64), 'entregue', '${pedido}');`;
const aFaturar = (t: string, pedido: string, status: string): string => `
INSERT INTO faturamento.pedido_a_faturar (tenant_id, pedido_id, filial_id, cliente_id, payload, status)
  VALUES ('${t}', '${pedido}', gen_random_uuid(), gen_random_uuid(), '{"itens": []}', '${status}');`;

const extras = `
${recebido(A.id, U1, P1)}
${recebido(A.id, U2, P2)}
INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, numero_erp, corpo, hash, estado, enviado_em)
  VALUES ('${A.id}', '${U1}', 'integrado', 'PED-7', '{"status": "integrado"}', repeat('2', 64), 'enviado', now()),
         ('${A.id}', '${U1}', 'faturado_total', 'PED-7', '{"status": "faturado_total"}', repeat('3', 64), 'pendente', NULL);
${aFaturar(A.id, P1, 'a_faturar')}
${aFaturar(A.id, P2, 'a_faturar')}
${aFaturar(A.id, P3, 'faturado')}
-- B com o mesmo pedido_id de A: nada de B muda pela empresa A
${recebido(B.id, UB, P1)}
INSERT INTO integracao_fdv.retorno_enviado (tenant_id, pedido_uuid, status, numero_erp, corpo, hash)
  VALUES ('${B.id}', '${UB}', 'integrado', 'PED-8', '{"status": "integrado"}', repeat('4', 64));
${aFaturar(B.id, P1, 'a_faturar')}
`;

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — critério 3 do zerar de pedidos (T-0093, 0065)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const chamadaSql = (f: 'liberar' | 'descartar', t: string, ids: string): string =>
    `${sessaoSql(sessao)}SELECT ${f === 'liberar' ? 'integracao_fdv.portal_liberar_reenvio_pedidos' : 'faturamento.portal_descartar_a_faturar'}('${t}', ${ids});`;
  const lista = (ids: string[]): string => `ARRAY[${ids.map((i) => `'${i}'`).join(', ')}]::uuid[]`;
  const chamar = (f: 'liberar' | 'descartar', t: string, ids: string[]): unknown =>
    JSON.parse(linhas(rodarComo(banco.conexao, chamadaSql(f, t, lista(ids)), { papel: CONFIG }))[0] ?? 'null');
  const codigoDe = (sql: string): { codigo: string | undefined; detalhe: string | undefined } => {
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(sql), { papel: CONFIG }));
    return {
      codigo: /ERROR:\s+([0-9A-Z]{5}):/.exec(e.saida)?.[1],
      detalhe: /DETAIL:\s+(\S+)/.exec(e.saida)?.[1],
    };
  };
  /** Contagem e hash do conteúdo das tabelas, no tenant. */
  const retrato = (t: string, tabelas: string[]): Record<string, string> =>
    Object.fromEntries(
      consultar<{ t: string; h: string }>(
        banco.conexao,
        tabelas
          .map(
            (x) =>
              `SELECT '${x}' AS t, count(*) || ':' || md5(coalesce(string_agg(to_jsonb(z)::text, ',' ORDER BY to_jsonb(z)::text), '')) AS h
                 FROM ${x} z WHERE z.tenant_id = '${t}'`,
          )
          .join('\nUNION ALL\n'),
      ).map((x) => [x.t, x.h]),
    );
  const TUDO = ['integracao_fdv.pedido_recebido', 'integracao_fdv.retorno_enviado', 'faturamento.pedido_a_faturar', ...FISCAIS];
  const statusAFaturar = (t: string, pedido: string): string =>
    um<{ s: string }>(`SELECT status AS s FROM faturamento.pedido_a_faturar WHERE tenant_id = '${t}' AND pedido_id = '${pedido}'`).s;
  const recebidos = (t: string): string[] =>
    consultar<{ u: string }>(
      banco.conexao,
      `SELECT pedido_uuid::text AS u FROM integracao_fdv.pedido_recebido WHERE tenant_id = '${t}' ORDER BY 1`,
    ).map((x) => x.u);

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    for (const t of [A, B]) {
      executar(
        banco.conexao,
        fixturePlataforma(t) + fixtureModulos(t) + fixturePedido(t) + fixtureFaturamento(t) + fixtureIntegracao(t),
      );
    }
    executar(banco.conexao, extras);
    executar(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0065@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) SECURITY DEFINER, search_path fixo, comentadas; as duas só do config, a interna de ninguém', () => {
    for (const f of [LIBERAR, DESCARTAR, INTERNA]) {
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
        config: f !== INTERNA,
      });
    }
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      for (const f of ['liberar', 'descartar'] as const) {
        recusaDetalhada(banco.conexao, chamadaSql(f, A.id, lista([P1])), '42501', /permission denied/, { papel, tenant: A.id });
      }
    }
  });

  it('(b) barreiras: sem sessão MXS01; nulo ou fora do formato 23514; empresa inexistente P0002; nada muda', () => {
    const antes = [retrato(A.id, TUDO), retrato(B.id, TUDO)];
    for (const f of ['liberar', 'descartar'] as const) {
      const sem = chamadaSql(f, A.id, lista([P1])).replace(sessaoSql(sessao), '');
      expect({ f, ...codigoDe(sem) }).toEqual({ f, codigo: 'MXS01', detalhe: undefined });
      for (const ids of ['NULL::uuid[]', `ARRAY['${P1}', NULL]::uuid[]`, `ARRAY[ARRAY['${P1}'::uuid], ARRAY['${P2}'::uuid]]`]) {
        expect({ f, ids, ...codigoDe(chamadaSql(f, A.id, ids)) }).toEqual({ f, ids, codigo: '23514', detalhe: undefined });
      }
      expect({ f, ...codigoDe(chamadaSql(f, A.id, lista([P1])).replace(`'${A.id}'`, 'NULL')) }).toEqual({
        f,
        codigo: '23514',
        detalhe: undefined,
      });
      expect({ f, ...codigoDe(chamadaSql(f, randomUUID(), lista([P1]))) }).toEqual({ f, codigo: 'P0002', detalhe: undefined });
    }
    expect([retrato(A.id, TUDO), retrato(B.id, TUDO)]).toEqual(antes);
  });

  it('(c) descartar: faturado na lista = MXC03 em_uso e nada muda', () => {
    const antes = retrato(A.id, TUDO);
    expect(codigoDe(chamadaSql('descartar', A.id, lista([P2, P3])))).toEqual({ codigo: 'MXC03', detalhe: 'em_uso' });
    expect(retrato(A.id, TUDO)).toEqual(antes);
  });

  it('(d) outro tenant: a empresa B com os ids de A não muda nada (nem em A)', () => {
    const antes = [retrato(A.id, TUDO), retrato(B.id, TUDO)];
    // P2 só existe em A: pela empresa B, nada sai (o P1 de B com o mesmo id de A fica para o (g), pela empresa A)
    expect(chamar('liberar', B.id, [P2])).toEqual({ pedidos_liberados: 0, retornos_descartados: 0 });
    expect(chamar('descartar', B.id, [P2])).toEqual({ a_faturar_cancelados: 0 });
    expect([retrato(A.id, TUDO), retrato(B.id, TUDO)]).toEqual(antes);
  });

  it('(e) trava: com o pedido_recebido preso por outra transação, a liberação espera (lock_timeout) e nada muda', async () => {
    const antes = retrato(A.id, TUDO);
    const segura = rodarScriptAssincrono(
      banco.conexao,
      `BEGIN;\nSELECT 1 FROM integracao_fdv.pedido_recebido WHERE tenant_id = '${A.id}' AND pedido_uuid = '${U2}' FOR UPDATE;\nSELECT pg_sleep(1.5);\nCOMMIT;\n`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(codigoDe(`SET LOCAL lock_timeout = '200ms';\n${chamadaSql('liberar', A.id, lista([P1, P2]))}`).codigo).toBe('55P03');
    await segura;
    expect(retrato(A.id, TUDO)).toEqual(antes);
  });

  it('(f) descartar trava com FOR UPDATE até a linha que não muda (cancelado): outra transação não a pega', async () => {
    executar(banco.conexao, aFaturar(A.id, randomUUID(), 'a_faturar'));
    const pc = randomUUID();
    executar(banco.conexao, aFaturar(A.id, pc, 'cancelado'));
    const config = rodarScriptAssincrono(
      banco.conexao,
      `SET ROLE ${CONFIG};\nBEGIN;\n${chamadaSql('descartar', A.id, lista([pc]))}\nSELECT pg_sleep(1.5);\nCOMMIT;\n`,
    );
    await new Promise((r) => setTimeout(r, 400));
    const e = falhaDetalhada(() =>
      executar(
        banco.conexao,
        verboso(`SELECT 1 FROM faturamento.pedido_a_faturar WHERE tenant_id = '${A.id}' AND pedido_id = '${pc}' FOR UPDATE NOWAIT;`),
      ),
    );
    expect(e.saida).toContain('55P03');
    expect(linhas(await config)).toContain('{"a_faturar_cancelados": 0}');
  });

  it('(g) efeito: P1 e P2 liberados com os retornos de P1; a_faturar cancelado; B, nota, XML e título intactos; de novo = 0', () => {
    const antesB = retrato(B.id, TUDO);
    const fiscaisA = retrato(A.id, FISCAIS);
    expect(chamar('liberar', A.id, [P1, P2, P1])).toEqual({ pedidos_liberados: 2, retornos_descartados: 2 });
    expect(recebidos(A.id)).toEqual([A.pedidoFdv]);
    expect(
      um<{ n: number }>(`SELECT count(*)::int AS n FROM integracao_fdv.retorno_enviado WHERE tenant_id = '${A.id}' AND pedido_uuid = '${U1}'`).n,
    ).toBe(0);
    expect(chamar('descartar', A.id, [P1, P2])).toEqual({ a_faturar_cancelados: 2 });
    expect([statusAFaturar(A.id, P1), statusAFaturar(A.id, P2), statusAFaturar(A.id, P3), statusAFaturar(A.id, A.pedido)]).toEqual([
      'cancelado',
      'cancelado',
      'faturado',
      'a_faturar',
    ]);
    // o reenvio do Hub (INSERT ... ON CONFLICT do recebimento) volta a criar a linha como recebida
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, tentativas)
         VALUES ('${A.id}', '${U1}', '{"itens": []}', repeat('5', 64), 1)
         ON CONFLICT (tenant_id, pedido_uuid) DO UPDATE SET recebido_em = now(), tentativas = integracao_fdv.pedido_recebido.tentativas + 1`,
    );
    expect(
      um<{ e: string; p: string | null }>(`SELECT estado AS e, pedido_id AS p FROM integracao_fdv.pedido_recebido WHERE tenant_id = '${A.id}' AND pedido_uuid = '${U1}'`),
    ).toEqual({ e: 'recebido', p: null });
    expect(retrato(B.id, TUDO)).toEqual(antesB);
    expect(retrato(A.id, FISCAIS)).toEqual(fiscaisA);
    // idempotentes: de novo = 0 e nada muda
    const antes = retrato(A.id, TUDO);
    expect(chamar('liberar', A.id, [P1, P2])).toEqual({ pedidos_liberados: 0, retornos_descartados: 0 });
    expect(chamar('descartar', A.id, [P1, P2])).toEqual({ a_faturar_cancelados: 0 });
    expect(chamar('liberar', A.id, [])).toEqual({ pedidos_liberados: 0, retornos_descartados: 0 });
    expect(retrato(A.id, TUDO)).toEqual(antes);
  });

  it('(h) auditoria: uma linha por chamada, do superadmin, só com as contagens (sem id nem dado do pedido)', () => {
    const r = consultar<{ acao: string; sa: string; ent: string; depois: Record<string, unknown> }>(
      banco.conexao,
      `SELECT acao, superadmin_id::text AS sa, entidade_id::text AS ent, depois FROM plataforma.auditoria
        WHERE tenant_id = '${A.id}' AND acao IN ('integracao-fdv.pedido_recebido.liberar_reenvio', 'faturamento.pedido_a_faturar.descartar')
        ORDER BY ocorrido_em, id`,
    );
    expect(r.length).toBeGreaterThanOrEqual(5);
    for (const l of r) {
      expect(l.sa).toBe(SA);
      expect(l.ent).toBe(A.id);
      expect(Object.keys(l.depois).sort()).toEqual(
        l.acao.startsWith('faturamento') ? ['a_faturar_cancelados'] : ['pedidos_liberados', 'retornos_descartados'],
      );
      const texto = JSON.stringify(l.depois);
      for (const proibido of [P1, P2, P3, U1, U2, 'PED-7']) {
        expect({ proibido, tem: texto.includes(proibido) }).toEqual({ proibido, tem: false });
      }
    }
    expect(r.map((l) => l.depois)).toContainEqual({ pedidos_liberados: 2, retornos_descartados: 2 });
    expect(r.map((l) => l.depois)).toContainEqual({ a_faturar_cancelados: 2 });
  });

  it('(i) reexecutar a 0065 não muda dado nem privilégio', () => {
    const priv = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT p.oid::regprocedure::text AS f, p.prosecdef, p.proconfig, p.proacl::text AS acl FROM pg_proc p
          WHERE p.oid = ANY (ARRAY[${[LIBERAR, DESCARTAR, INTERNA].map((f) => `'${f}'::regprocedure`).join(', ')}]::oid[]) ORDER BY 1`,
      );
    const antes = [retrato(A.id, TUDO), retrato(B.id, TUDO), priv()];
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect([retrato(A.id, TUDO), retrato(B.id, TUDO), priv()]).toEqual(antes);
  });
});
