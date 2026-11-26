/**
 * T-0093 (v0.3.13), migração 0064 (RN-CAD-10): zerar pedidos não faturados pelo portal /config. O banco dá os fatos
 * (pedido.portal_zeragem_fatos e faturamento.portal_pedidos_com_uso) e aplica o plano do domain (pedido.portal_zerar):
 * o pedido com nota ou título fica, o sem nota e sem título sai com itens, eventos e decisão; a prévia bate com o zerar;
 * a auditoria só tem contagens; o outro tenant, a nota, o XML, o evento fiscal e o pedido recebido do FDV não mudam.
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
  linhas,
  PG_DISPONIVEL,
  permitirSetRole,
  recusaComDetalhe,
  recusaCompleta,
  recusaDetalhada,
  retratoDoTenant,
  rodarComo,
  rodarScript,
  sessaoSql,
  tabelasDos,
} from './apoio.ts';
import {
  cnfDoTenant,
  fixtureFaturamento,
  fixtureIntegracao,
  fixtureModulos,
  fixturePedido,
  fixturePlataforma,
  novoTenant,
  sqlDePedido,
  sqlNotaAutorizada,
  type Tenant,
} from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0064_pedido_portal_zerar.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const A = novoTenant('zerar-0064-a');
const B = novoTenant('zerar-0064-b');
/** Ativa, sem a licença do módulo pedido. */
const C = novoTenant('zerar-0064-c');
const SA = '5a000000-0000-4000-8000-000000000641';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';

const FATOS = 'pedido.portal_zeragem_fatos(uuid)';
const USOS = 'faturamento.portal_pedidos_com_uso(uuid, uuid[])';
const ZERAR = 'pedido.portal_zerar(uuid, jsonb, text)';
const PORTAL = [FATOS, USOS, ZERAR];
const INTERNAS = [
  'plataforma.portal_empresa_licenciada(uuid, text)',
  'faturamento.pedidos_com_uso(uuid, uuid[])',
  'pedido.somente_insercao_salvo_zerar()',
];

// Pedidos extras do tenant A (dados fictícios). A massa já tem A.pedido (FDV, aprovado, na fila do faturamento sem
// nota) e A.pedidoBko (manual, aprovado, com a decisão automática).
const P = {
  /** Com nota autorizada (XML guardado). */
  nota: randomUUID(),
  /** Com nota e título. */
  titulo: randomUUID(),
  /** Faturado sem nota achada: o domain mantém pelo status. */
  faturado: randomUUID(),
  /** Recusado, com decisão humana: sai. */
  recusado: randomUUID(),
  /** Recebido do FDV: sai. */
  recebidoFdv: randomUUID(),
  /** Excluído (deleted_at): fora dos fatos e do zerar. */
  excluido: randomUUID(),
};
/** Pedido de B com nota: a porta do faturamento pela empresa A não o vê. */
const PB_NOTA = randomUUID();

/** Nota autorizada do pedido, com título se pedido. */
const notaDoPedido = (t: Tenant, pedido: string, cnf: number, titulo = false): string =>
  sqlNotaAutorizada(t, randomUUID(), 'homologacao', cnf, { pedido, titulo }).sql;

function extrasDeA(t: Tenant): string {
  const { pedidoSql, itemSql } = sqlDePedido(t.id, 10);
  const ev = (pedido: string, de: string | null, para: string): string =>
    `INSERT INTO pedido.pedido_evento (tenant_id, pedido_id, de, para, ator_tipo) VALUES ('${t.id}', '${pedido}', ${
      de === null ? 'NULL' : `'${de}'`
    }, '${para}', 'sistema');`;
  const cnf = cnfDoTenant(t);
  return `
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${t.id}', 'pedido'), ('${t.id}', 'faturamento');
${pedidoSql({ id: P.nota })} ${itemSql(P.nota, 1)}
UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${P.nota}';
${pedidoSql({ id: P.titulo })} ${itemSql(P.titulo, 1)}
UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${P.titulo}';
${pedidoSql({ id: P.faturado })} ${itemSql(P.faturado, 1, { faturada: 10000 })}
UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${P.faturado}';
UPDATE pedido.pedido SET status = 'faturado' WHERE id = '${P.faturado}';
${pedidoSql({ id: P.recusado })} ${itemSql(P.recusado, 1)} ${itemSql(P.recusado, 2)}
UPDATE pedido.pedido SET status = 'em_analise' WHERE id = '${P.recusado}';
UPDATE pedido.pedido SET status = 'recusado' WHERE id = '${P.recusado}';
${ev(P.recusado, null, 'recebido')} ${ev(P.recusado, 'recebido', 'em_analise')} ${ev(P.recusado, 'em_analise', 'recusado')}
INSERT INTO pedido.aprovacao (tenant_id, pedido_id, decisao, automatica, decidido_por, perfil, motivo_codigo)
  VALUES ('${t.id}', '${P.recusado}', 'recusado', false, '${t.usuario}', 'gerente', 'sem_credito');
${pedidoSql({ id: P.recebidoFdv, origem: 'fdv', externalId: randomUUID() })} ${itemSql(P.recebidoFdv, 1)}
${ev(P.recebidoFdv, null, 'recebido')}
${pedidoSql({ id: P.excluido })} ${itemSql(P.excluido, 1)}
UPDATE pedido.pedido SET deleted_at = now() WHERE id = '${P.excluido}';
${notaDoPedido(t, P.nota, cnf + 1)}
${notaDoPedido(t, P.titulo, cnf + 2, true)}
`;
}

/** O que o domain decide (planoZeragemPedidos): sai o sem nota, sem título e fora de faturado/faturado parcial. */
const SAEM = (): string[] => [A.pedido, A.pedidoBko, P.recusado, P.recebidoFdv].sort();
const FICAM = (): string[] => [P.nota, P.titulo, P.faturado].sort();

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — zerar pedidos não faturados (T-0093, 0064)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const comoConfig = (sql: string): unknown =>
    JSON.parse(
      linhas(rodarComo(banco.conexao, `${sessaoSql(sessao)}${sql}`, { papel: CONFIG }))[0] ?? 'null',
    );
  const fatos = (t = A.id): { pedidos: { id: string; status: string; origem: string }[] } =>
    comoConfig(`SELECT pedido.portal_zeragem_fatos('${t}');`) as never;
  const usos = (t: string, ids: string[]): { com_nota: string[]; com_titulo: string[] } =>
    comoConfig(`SELECT faturamento.portal_pedidos_com_uso('${t}', '{${ids.join(',')}}'::uuid[]);`) as never;
  const zerarSql = (plano: unknown, req = 'req-zerar-0064'): string =>
    `${sessaoSql(sessao)}SELECT pedido.portal_zerar('${A.id}', '${JSON.stringify(plano)}'::jsonb, '${req}');`;
  const zerar = (plano: unknown, req?: string): { apagados: { tabela: string; quantidade: number }[] } =>
    JSON.parse(linhas(rodarComo(banco.conexao, zerarSql(plano, req), { papel: CONFIG }))[0] ?? 'null');
  const recusaZerar = (plano: unknown, detalhe: 'sumiu' | 'em_uso'): void =>
    recusaCompleta(
      banco.conexao,
      zerarSql(plano),
      { codigo: 'MXC03', detalhe, mensagem: /o estado mudou/, dica: 'pedido' },
      { papel: CONFIG },
    );
  const retrato = (t: string, schemas: string[]): Record<string, string> =>
    retratoDoTenant(banco.conexao, t, tabelasDos(banco.conexao, schemas));
  const recebidoFdv = `SELECT estado, pedido_id, hash, deleted_at FROM integracao_fdv.pedido_recebido
    WHERE tenant_id = '${A.id}' AND pedido_uuid = '${A.pedidoFdv}'`;
  const TODOS = ['pedido', 'faturamento', 'fiscal', 'integracao_fdv', 'cadastros', 'core', 'plataforma'];
  const contar = (tabela: string, ids: string[]): number =>
    um<{ n: number }>(
      `SELECT count(*)::int AS n FROM pedido.${tabela} WHERE tenant_id = '${A.id}' AND ${
        tabela === 'pedido' ? 'id' : 'pedido_id'
      } = ANY ('{${ids.join(',')}}'::uuid[])`,
    ).n;

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
    const { pedidoSql } = sqlDePedido(B.id, 10);
    executar(
      banco.conexao,
      massa(B) +
        `INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${B.id}', 'pedido');
${pedidoSql({ id: PB_NOTA })}
UPDATE pedido.pedido SET status = 'aprovado' WHERE id = '${PB_NOTA}';
${notaDoPedido(B, PB_NOTA, cnfDoTenant(B) + 1)}`,
    );
    executar(banco.conexao, fixturePlataforma(C));
    executar(
      banco.conexao,
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0064@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) as três do portal são SECURITY DEFINER, com search_path fixo, comentadas e só do config; as internas sem EXECUTE', () => {
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
        // o gatilho roda como quem apaga (o dono só passa pelo portal_zerar)
        definer: f !== 'pedido.somente_insercao_salvo_zerar()',
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        app: false,
        worker: false,
        leitura: false,
        config: PORTAL.includes(f),
      });
    }
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      recusaDetalhada(
        banco.conexao,
        `${sessaoSql(sessao)}SELECT pedido.portal_zeragem_fatos('${A.id}');`,
        '42501',
        /permission denied/,
        {
          papel,
          tenant: A.id,
        },
      );
    }
  });

  it('(b) barreiras: sem sessão MXS01; empresa inexistente P0002; sem licença do pedido MXC04 modulo_desligado', () => {
    recusaDetalhada(
      banco.conexao,
      `SELECT pedido.portal_zeragem_fatos('${A.id}');`,
      'MXS01',
      /sessão de superadmin/,
      { papel: CONFIG },
    );
    for (const sql of [
      `SELECT pedido.portal_zeragem_fatos('${randomUUID()}');`,
      `SELECT faturamento.portal_pedidos_com_uso('${randomUUID()}', '{}'::uuid[]);`,
    ]) {
      recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}${sql}`, 'P0002', /.+/, { papel: CONFIG });
    }
    recusaCompleta(
      banco.conexao,
      `${sessaoSql(sessao)}SELECT pedido.portal_zeragem_fatos('${C.id}');`,
      { codigo: 'MXC04', detalhe: 'modulo_desligado', mensagem: /módulo pedido desligado na empresa/ },
      { papel: CONFIG },
    );
    recusaComDetalhe(
      banco.conexao,
      `${sessaoSql(sessao)}SELECT pedido.portal_zerar('${C.id}', '{"apagar": []}'::jsonb, 'r');`,
      'MXC04',
      'modulo_desligado',
      { papel: CONFIG },
    );
  });

  it('(c) fatos: os pedidos não excluídos da empresa, só id, status e origem; nada do outro tenant', () => {
    const f = fatos();
    expect(f.pedidos.map((p) => p.id)).toEqual([...SAEM(), ...FICAM()].sort());
    expect(f.pedidos.every((p) => Object.keys(p).sort().join() === 'id,origem,status')).toBe(true);
    const por = Object.fromEntries(f.pedidos.map((p) => [p.id, `${p.origem}:${p.status}`]));
    expect(por).toMatchObject({
      [A.pedido]: 'fdv:aprovado',
      [A.pedidoBko]: 'bko:aprovado',
      [P.recusado]: 'bko:recusado',
      [P.recebidoFdv]: 'fdv:recebido',
      [P.faturado]: 'bko:faturado',
    });
    expect(fatos(B.id).pedidos.map((p) => p.id)).not.toContain(A.pedido);
  });

  it('(d) usos do faturamento: nota e título pelo pedido; o pedido de B não aparece pela empresa A', () => {
    const todos = fatos().pedidos.map((p) => p.id);
    expect(usos(A.id, todos)).toEqual({ com_nota: [P.nota, P.titulo].sort(), com_titulo: [P.titulo] });
    expect(usos(A.id, [PB_NOTA])).toEqual({ com_nota: [], com_titulo: [] });
    expect(usos(B.id, [PB_NOTA])).toEqual({ com_nota: [PB_NOTA], com_titulo: [] });
    expect(usos(A.id, [])).toEqual({ com_nota: [], com_titulo: [] });
    recusaDetalhada(
      banco.conexao,
      `${sessaoSql(sessao)}SELECT faturamento.portal_pedidos_com_uso('${A.id}', ARRAY[NULL]::uuid[]);`,
      '23514',
      /nula ou com nulo/,
      { papel: CONFIG },
    );
  });

  it('(e) plano fora do formato = 23514; mantido, sumido ou de outro tenant = MXC03; nada muda', () => {
    const antes = retrato(A.id, TODOS);
    for (const plano of [
      null,
      [],
      { apagar: ['nao-uuid'] },
      { apagar: [1] },
      { outro: [] },
      { apagar: 'x' },
    ]) {
      recusaDetalhada(banco.conexao, zerarSql(plano), '23514', /fora do formato/, { papel: CONFIG });
    }
    recusaZerar({ apagar: [A.pedido, P.nota] }, 'em_uso');
    recusaZerar({ apagar: [P.titulo] }, 'em_uso');
    recusaZerar({ apagar: [P.faturado] }, 'em_uso');
    recusaZerar({ apagar: [A.pedido, randomUUID()] }, 'sumiu');
    recusaZerar({ apagar: [P.excluido] }, 'sumiu');
    recusaZerar({ apagar: [B.pedido] }, 'sumiu');
    expect(retrato(A.id, TODOS)).toEqual(antes);
  });

  it('(f) o gatilho só de inserção segue recusando o UPDATE e o DELETE fora do zerar, dono incluso', () => {
    for (const t of ['pedido_evento', 'aprovacao']) {
      expect(
        falha(() => executar(banco.conexao, `DELETE FROM pedido.${t} WHERE tenant_id = '${A.id}';`)),
      ).toMatch(/só de inserção/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `SELECT set_config('macuxierp.pedido_zerar', 'on', true); UPDATE pedido.${t} SET deleted_at = now() WHERE tenant_id = '${A.id}';`,
          ),
        ),
      ).toMatch(/só de inserção/);
      expect(
        falha(() =>
          executar(
            banco.conexao,
            `SELECT set_config('macuxierp.pedido_zerar', 'on', true); DELETE FROM pedido.${t} WHERE tenant_id = '${A.id}';`,
            { papel: 'macuxierp_worker', tenant: A.id },
          ),
        ),
      ).toMatch(/permission denied/);
    }
  });

  it('(g) zerar: a prévia bate com o efeito; sai o sem nota e sem título com itens, eventos e decisão; o resto fica', () => {
    const antesFat = retrato(A.id, ['faturamento', 'fiscal']);
    const antesB = retrato(B.id, TODOS);
    const recebido = um<Record<string, unknown>>(recebidoFdv);
    // prévia: fatos + usos -> o plano do domain
    const f = fatos();
    const u = usos(
      A.id,
      f.pedidos.map((p) => p.id),
    );
    const apagar = f.pedidos
      .filter(
        (p) =>
          !u.com_nota.includes(p.id) &&
          !u.com_titulo.includes(p.id) &&
          !['faturado', 'faturado_parcial'].includes(p.status),
      )
      .map((p) => p.id);
    expect(apagar.sort()).toEqual(SAEM());
    const esperado = [
      { tabela: 'pedido', quantidade: apagar.length },
      { tabela: 'pedido_item', quantidade: contar('pedido_item', apagar) },
      { tabela: 'pedido_evento', quantidade: contar('pedido_evento', apagar) },
      { tabela: 'aprovacao', quantidade: contar('aprovacao', apagar) },
    ];
    expect(esperado.map((x) => x.quantidade)).toEqual([4, 5, 8, 2]);

    // na mesma transação do zerar: a marca fica vazia e o DELETE direto do dono volta a cair no gatilho (42501)
    const saida = linhas(
      rodarComo(
        banco.conexao,
        `${zerarSql({ apagar })}
SELECT 'marca=' || coalesce(current_setting('macuxierp.pedido_zerar', true), '');
RESET ROLE;
DO $$ BEGIN
  DELETE FROM pedido.pedido_evento WHERE tenant_id = '${B.id}';
  RAISE EXCEPTION 'o DELETE direto passou';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT 'delete=42501';`,
        { papel: CONFIG },
      ),
    );
    expect(JSON.parse(saida[0] ?? 'null')).toEqual({ apagados: esperado });
    expect(saida.slice(1)).toEqual(['marca=', 'delete=42501']);

    for (const t of ['pedido', 'pedido_item', 'pedido_evento', 'aprovacao'])
      expect(contar(t, apagar)).toBe(0);
    expect(fatos().pedidos.map((p) => p.id)).toEqual(FICAM());
    expect(contar('pedido', [P.excluido])).toBe(1);
    expect(contar('pedido_item', FICAM())).toBe(3);
    // nota, XML, evento fiscal, título e fila do faturamento intactos
    expect(retrato(A.id, ['faturamento', 'fiscal'])).toEqual(antesFat);
    // o pedido recebido do FDV fica entregue: o mesmo pedido_uuid não volta sozinho (o reenvio cai como repetido)
    expect(um<Record<string, unknown>>(recebidoFdv)).toEqual(recebido);
    // o outro tenant não muda
    expect(retrato(B.id, TODOS)).toEqual(antesB);
  });

  it('(h) auditoria pedido.dados.zerar só com as contagens, sem id nem dado do pedido', () => {
    const r = consultar<{
      superadmin_id: string;
      usuario_id: string | null;
      entidade: string;
      antes: unknown;
      depois: unknown;
      request_id: string;
    }>(
      banco.conexao,
      `SELECT superadmin_id, usuario_id, entidade, antes, depois, request_id FROM plataforma.auditoria
        WHERE tenant_id = '${A.id}' AND acao = 'pedido.dados.zerar' AND request_id = 'req-zerar-0064'`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      superadmin_id: SA,
      usuario_id: null,
      entidade: 'empresa',
      antes: null,
      depois: {
        apagados: [
          { tabela: 'pedido', quantidade: 4 },
          { tabela: 'pedido_item', quantidade: 5 },
          { tabela: 'pedido_evento', quantidade: 8 },
          { tabela: 'aprovacao', quantidade: 2 },
        ],
        apagados_fdv: 2,
      },
      request_id: 'req-zerar-0064',
    });
    const texto = JSON.stringify(r[0]!.depois);
    for (const id of [...SAEM(), A.cliente, A.pedidoFdv]) expect(texto).not.toContain(id);
  });

  it('(i) reexecução: o mesmo plano cai em MXC03 sumiu; o plano vazio não apaga nada; a migração de novo não muda nada', () => {
    const antes = retrato(A.id, ['pedido', 'faturamento', 'fiscal', 'integracao_fdv']);
    recusaZerar({ apagar: SAEM() }, 'sumiu');
    expect(zerar({ apagar: [] }, 'req-vazio')).toEqual({
      apagados: [
        { tabela: 'pedido', quantidade: 0 },
        { tabela: 'pedido_item', quantidade: 0 },
        { tabela: 'pedido_evento', quantidade: 0 },
        { tabela: 'aprovacao', quantidade: 0 },
      ],
    });
    const gatilhos = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT tgrelid::regclass::text AS t, tgname, tgfoid::regproc::text AS f FROM pg_trigger
          WHERE tgrelid IN ('pedido.pedido_evento'::regclass, 'pedido.aprovacao'::regclass) AND NOT tgisinternal ORDER BY 1, 2`,
      );
    const g = gatilhos();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(gatilhos()).toEqual(g);
    expect(retrato(A.id, ['pedido', 'faturamento', 'fiscal', 'integracao_fdv'])).toEqual(antes);
  });
});
