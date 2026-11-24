/**
 * T-0086 (v0.3.12), migração 0055: funções do portal /config para o Monitor, o Log e o Reprocessar da Integração FDV
 * (docs/desenho/T-0086.md §2 a §4; ADR 0013; R-20261124-181938-gerente-projetos). Conferem os privilégios, a barreira de
 * sessão e de empresa, o formato que o repositorioPortalSql do módulo valida (InsumosMonitorPortal, InsumosLogPortal e
 * ResultadoReprocessarPortal), o isolamento entre tenants, a ausência de external_id, nome, documento e payload no Log,
 * o Reprocessar só de falha e pendente (nunca o integrado), a idempotência por request_id, o bloqueio com lote em voo e a
 * paridade com o planejarReprocessar do domain (tabela de casos, abaixo).
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
  recusaComDetalhe,
  recusaDetalhada,
  rodarComo,
  rodarScript,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0055_integracao_fdv_portal_operacao.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const A = novoTenant('ifdv-0055-a');
const B = novoTenant('ifdv-0055-b');
/** Sem a licença do integracao-fdv. */
const C = novoTenant('ifdv-0055-c');
/** Licenciada, sem credencial. */
const D = novoTenant('ifdv-0055-d');
/** Paridade com o domain. */
const P = novoTenant('ifdv-0055-p');
const SA = '5a000000-0000-4000-8000-000000000551';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const CIFRADA = `decode(repeat('ab', 40), 'hex')`;
const FUNCOES = [
  'integracao_fdv.portal_monitor(uuid)',
  'integracao_fdv.portal_log(uuid, text)',
  'integracao_fdv.portal_reprocessar(uuid, text, text)',
] as const;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Dados que nunca podem sair no Log do /config (nome, documento, external_id, payload, fonte_refs). */
const PROIBIDOS = ['Fulano Ficticio', 'Razao Ficticia', '12345678000199', '"S1"', 'PA-', 'PB-', 'payload', 'fonte_refs', 'registro_external_id', 'inativado_por'];

interface Monitor {
  credencial_ativa: boolean;
  conector_id: string | null;
  habilitadas: number;
  ultimo_sinal_aceito_em: string | null;
  fila: { lotes: number; linhas: number };
}
interface Envio {
  em: string;
  estado: string;
  registros: number;
  com_erro: number;
  origem: string;
}
interface Log {
  envios: Envio[];
  erros: { codigo: string; campo: string | null; quantidade: number }[];
  total_erros: number;
  pausada_motivo: string | null;
}
interface Reprocessar {
  falhas: number;
  pendentes: number;
  pedido_em: string;
}

/**
 * Paridade (pedido do engenheiro): o resultado esperado da regra do domain, `planejarReprocessar` /
 * `situacaoRegistro` de modules/integracao-fdv/domain/operacao.ts (PR #527, RN-INF-03), fixado como tabela de casos:
 * erro aberto = falha; senão pendente ou hash_confirmado !== hash = pendente; senão integrado (fica fora). A importação
 * direta do domain fica para depois do merge do #527, se a fronteira de db/testes permitir. As linhas sem payload e as
 * excluídas nunca chegam ao domain (o SELECT de reprocessarCadastro as tira); entram aqui para provar o mesmo corte.
 */
const CASOS: readonly {
  id: string;
  pendente: boolean;
  hash: string;
  confirmado: string | null;
  erro: 'aberto' | 'resolvido' | null;
  extra?: 'sem_payload' | 'excluido';
  esperado: 'falha' | 'pendente' | 'integrado' | 'fora';
}[] = [
  { id: 'integrado', pendente: false, hash: 'a', confirmado: 'a', erro: null, esperado: 'integrado' },
  { id: 'integrado-erro-resolvido', pendente: false, hash: 'a', confirmado: 'a', erro: 'resolvido', esperado: 'integrado' },
  { id: 'pendente-nunca-confirmado', pendente: true, hash: 'a', confirmado: null, erro: null, esperado: 'pendente' },
  { id: 'pendente-marcado-confirmado', pendente: true, hash: 'a', confirmado: 'a', erro: null, esperado: 'pendente' },
  { id: 'hash-mudou', pendente: false, hash: 'b', confirmado: 'a', erro: null, esperado: 'pendente' },
  { id: 'pendente-hash-mudou', pendente: true, hash: 'b', confirmado: 'a', erro: null, esperado: 'pendente' },
  { id: 'falha-confirmado', pendente: false, hash: 'a', confirmado: 'a', erro: 'aberto', esperado: 'falha' },
  { id: 'falha-pendente', pendente: true, hash: 'a', confirmado: null, erro: 'aberto', esperado: 'falha' },
  { id: 'falha-hash-mudou', pendente: false, hash: 'b', confirmado: 'a', erro: 'aberto', esperado: 'falha' },
  { id: 'pendente-erro-resolvido', pendente: true, hash: 'a', confirmado: null, erro: 'resolvido', esperado: 'pendente' },
  { id: 'sem-payload-com-erro', pendente: false, hash: 'a', confirmado: 'a', erro: 'aberto', extra: 'sem_payload', esperado: 'fora' },
  { id: 'excluido-pendente', pendente: true, hash: 'a', confirmado: null, erro: null, extra: 'excluido', esperado: 'fora' },
];

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — Monitor, Log e Reprocessar da Integração FDV pelo portal /config (T-0086, 0055)', () => {
  let banco: BancoDeTeste;
  let sessao: string;
  const cred: Record<string, string> = {};

  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const jsonConfig = <T>(sql: string): T => JSON.parse(comoConfig(sql)[0] ?? 'null') as T;
  const monitor = (t: string): Monitor => jsonConfig<Monitor>(`SELECT integracao_fdv.portal_monitor('${t}');`);
  const log = (t: string, e: string): Log => jsonConfig<Log>(`SELECT integracao_fdv.portal_log('${t}', '${e}');`);
  const reprocessarSql = (t: string, e: string, req: string): string => `SELECT integracao_fdv.portal_reprocessar('${t}', '${e}', '${req}');`;
  const reprocessar = (t: string, e: string, req: string): Reprocessar => jsonConfig<Reprocessar>(reprocessarSql(t, e, req));
  const recusaConfig = (sql: string, codigo: string, padrao: RegExp, s: string | null = sessao): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: CONFIG });
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  /** INSERT ... RETURNING id (o consultar embrulha num SELECT e não aceita escrita). */
  const inserirId = (sql: string): string => linhas(rodarComo(banco.conexao, sql))[0] ?? '';
  const nAuditoria = (t: string): number =>
    um<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE tenant_id = '${t}' AND acao = 'integracao-fdv.entidade.reprocessar'`).n;
  /** Tudo do tenant nas tabelas que as funções leem ou tocam. */
  const retrato = (t: string): unknown =>
    consultar(
      banco.conexao,
      `SELECT t, l FROM (SELECT 'credencial' AS t, to_jsonb(c) - 'chave_cifrada' AS l FROM integracao_fdv.credencial c WHERE tenant_id = '${t}'
       UNION ALL SELECT 'cursor', to_jsonb(k) FROM integracao_fdv.cursor_entidade k WHERE tenant_id = '${t}'
       UNION ALL SELECT 'sinal', to_jsonb(s) FROM integracao_fdv.sinal s WHERE tenant_id = '${t}'
       UNION ALL SELECT 'lote', to_jsonb(l) FROM integracao_fdv.lote_envio l WHERE tenant_id = '${t}'
       UNION ALL SELECT 'erro', to_jsonb(e) FROM integracao_fdv.lote_erro e WHERE tenant_id = '${t}'
       UNION ALL SELECT 'registro', to_jsonb(r) FROM integracao_fdv.registro_publicado r WHERE tenant_id = '${t}'
       UNION ALL SELECT 'auditoria', to_jsonb(a) FROM plataforma.auditoria a WHERE tenant_id = '${t}'
      ) x ORDER BY t, l::text`,
    );
  const registros = (t: string, e = 'produto'): Record<string, { pendente: boolean; reenvio: string | null; hash: string; ativo: boolean }> =>
    Object.fromEntries(
      consultar<{ x: string; pendente: boolean; reenvio: string | null; hash: string; ativo: boolean }>(
        banco.conexao,
        `SELECT registro_external_id AS x, pendente, fonte_refs ->> 'reenvio' AS reenvio, hash, ativo FROM integracao_fdv.registro_publicado
          WHERE tenant_id = '${t}' AND entidade = '${e}' AND deleted_at IS NULL ORDER BY 1`,
      ).map(({ x, ...r }) => [x, r]),
    );
  /** Lote em voo (montado) no cadastro; devolve o id para concluir depois. */
  const loteEmVoo = (t: string, e: string): string =>
    inserirId(
      `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, corpo, estado)
       VALUES ('${t}', '${e}', '${cred[t]}', 'delta', encode(sha256(convert_to('${randomUUID()}', 'UTF8')), 'hex'), '{}', 'montado') RETURNING id;`,
    );
  const concluir = (id: string): void =>
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.lote_envio SET estado = 'concluido', hub_lote_id = gen_random_uuid(), concluido_em = now() WHERE id = '${id}';`,
    );

  /**
   * Massa do cadastro produto (o mesmo desenho em A e B, com valores distintos): 1 integrado, 1 integrado com erro resolvido,
   * 2 pendentes (nunca confirmado; hash mudou), 2 falhas (erro aberto), 1 anulado com erro aberto, 1 excluído pendente e
   * 1 cliente pendente (outro cadastro). Lotes: 4 encerrados (origens reprocessar, zerar, nenhuma e desconhecida).
   */
  // hora-fixa-ok: instante do lote ou do sinal só gravado e devolvido em ISO, nunca comparado ao relógio
  const massa = (t: string, p: 'PA' | 'PB'): string => `
INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em,
  fonte_ocorrido_em, fonte_refs, ativo, pendente, hash_confirmado, confirmado_em, deleted_at) VALUES
  ('${t}', 'produto', '${p}-INT', '{"nome": "Fulano Ficticio", "sku": "S1"}', repeat('1', 64), now(), now(), '{"produto_id": "x"}', true, false, repeat('1', 64), now(), NULL),
  ('${t}', 'produto', '${p}-INT2', '{"razao_social": "Razao Ficticia"}', repeat('2', 64), now(), now(), '{}', true, false, repeat('2', 64), now(), NULL),
  ('${t}', 'produto', '${p}-PEN', '{"documento": "12345678000199"}', repeat('3', 64), now(), now(), '{}', true, true, NULL, NULL, NULL),
  ('${t}', 'produto', '${p}-MUD', '{"nome": "Fulano Ficticio"}', repeat('4', 64), now(), now(), '{}', true, false, repeat('9', 64), now(), NULL),
  ('${t}', 'produto', '${p}-F1', '{"nome": "Fulano Ficticio"}', repeat('5', 64), now(), now(), '{"inativado_por": "zerar"}', true, false, repeat('5', 64), now(), NULL),
  ('${t}', 'produto', '${p}-F2', '{"descricao": "Razao Ficticia"}', repeat('6', 64), now(), now(), '{}', true, true, NULL, NULL, NULL),
  ('${t}', 'produto', '${p}-ANU', NULL, repeat('7', 64), now(), now(), '{}', false, false, repeat('7', 64), now(), NULL),
  ('${t}', 'produto', '${p}-EXC', '{"nome": "Fulano Ficticio"}', repeat('8', 64), now(), now(), '{}', true, true, NULL, NULL, now()),
  ('${t}', 'cliente', '${p}-CLI', '{"nome": "Fulano Ficticio"}', repeat('a', 64), now(), now(), '{}', true, true, NULL, NULL, NULL);
WITH l AS (
  INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, hub_lote_id,
    contagens, ultimo_erro_codigo, enviado_em, concluido_em, created_at) VALUES
    ('${t}', 'produto', '${cred[t]}', 'delta', repeat('${p === 'PA' ? 'a' : 'b'}1', 32), 'concluido_com_erros', gen_random_uuid(),
     '{"registros": 3, "invalidas": 1, "origem": "reprocessar"}', NULL, '2026-11-20T10:00:00Z', '2026-11-20T10:01:00Z', '2026-11-20T09:59:00Z'),
    ('${t}', 'produto', '${cred[t]}', 'delta', repeat('${p === 'PA' ? 'a' : 'b'}2', 32), 'concluido', gen_random_uuid(),
     '{"registros": 2, "origem": "zerar"}', NULL, '2026-11-19T10:00:00Z', '2026-11-19T10:01:00Z', '2026-11-19T09:59:00Z'),
    ('${t}', 'produto', '${cred[t]}', 'delta', repeat('${p === 'PA' ? 'a' : 'b'}3', 32), 'falhou', NULL,
     '{}', 'hub_fora', NULL, '2026-11-18T10:01:00Z', '2026-11-18T09:59:00Z'),
    ('${t}', 'produto', '${cred[t]}', 'delta', repeat('${p === 'PA' ? 'a' : 'b'}4', 32), 'concluido', gen_random_uuid(),
     '{"registros": 1, "origem": "outra"}', NULL, '2026-11-17T10:00:00Z', '2026-11-17T10:01:00Z', '2026-11-17T09:59:00Z')
  RETURNING id, chave_idempotencia)
INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo, resolvido_em)
SELECT '${t}', l.id, v.i, 'hub', 'produto', v.x, v.codigo, v.campo, v.resolvido
  FROM l JOIN (VALUES
    (repeat('${p === 'PA' ? 'a' : 'b'}1', 32), 0, '${p}-F1', 'campo_invalido', 'nome', NULL::timestamptz),
    (repeat('${p === 'PA' ? 'a' : 'b'}1', 32), 1, '${p}-F2', 'campo_invalido', 'nome', NULL),
    (repeat('${p === 'PA' ? 'a' : 'b'}1', 32), 2, '${p}-F2', 'referencia_ausente', NULL, NULL),
    (repeat('${p === 'PA' ? 'a' : 'b'}1', 32), 3, '${p}-ANU', 'campo_invalido', 'nome', NULL),
    (repeat('${p === 'PA' ? 'a' : 'b'}1', 32), 4, NULL, 'lote_invalido', NULL, NULL),
    (repeat('${p === 'PA' ? 'a' : 'b'}2', 32), 0, '${p}-F1', 'campo_invalido', 'nome', NULL),
    (repeat('${p === 'PA' ? 'a' : 'b'}2', 32), 1, '${p}-INT2', 'campo_invalido', 'preco', now())
  ) AS v(chave, i, x, codigo, campo, resolvido) ON v.chave = l.chave_idempotencia;
INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, proximo_em) VALUES ('${t}', 'produto', now() + interval '1 day');
`;

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      `${[A, B, C, D, P].map(fixturePlataforma).join('')}
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo)
  VALUES ('${A.id}', 'integracao-fdv'), ('${B.id}', 'integracao-fdv'), ('${D.id}', 'integracao-fdv'), ('${P.id}', 'integracao-fdv');
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0055@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    // credencial pela função do portal (a 0038 cria o sinal junto); A habilita 2 cadastros, B e P 1
    for (const [t, conector, entidades] of [
      [A.id, 'conector-a', `ARRAY['produto', 'cliente']`],
      [B.id, 'conector-b', `ARRAY['produto']`],
      [P.id, 'conector-p', `ARRAY['produto']`],
    ] as const) {
      comoConfig(
        `SELECT integracao_fdv.portal_credencial_definir('${t}', NULL, '${conector}', 'teste', ${CIFRADA}, 'pfx0055', 1, false, NULL, 'req-def', ${entidades}::text[]);`,
      );
      cred[t] = um<{ id: string }>(`SELECT id FROM integracao_fdv.credencial WHERE tenant_id = '${t}' AND substituida_em IS NULL`).id;
    }
    executar(
      banco.conexao,
      // hora-fixa-ok: instante do lote ou do sinal só gravado e devolvido em ISO, nunca comparado ao relógio
      `${massa(A.id, 'PA')}${massa(B.id, 'PB')}
UPDATE integracao_fdv.sinal SET ultimo_aceito_em = '2026-11-24T20:00:00.123Z' WHERE tenant_id = '${A.id}';
UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'versao', pausada_em = now() WHERE tenant_id = '${B.id}' AND entidade = 'produto';`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) EXECUTE só do config; SECURITY DEFINER, search_path fixo, comentadas, sem PUBLIC; o app, o worker e a leitura não executam', () => {
    for (const f of FUNCOES) {
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
        config: true,
      });
    }
    // o config segue sem ler as tabelas do módulo (RLS e grants intactos)
    for (const tabela of ['registro_publicado', 'lote_erro', 'lote_envio', 'cursor_entidade']) {
      recusaConfig(`SELECT count(*) FROM integracao_fdv.${tabela};`, '42501', /permission denied/);
    }
  });

  it('(b) barreiras: sem sessão MXS01; empresa inexistente P0002; fora da F2 23514; reprocessar sem licença MXI04 e sem credencial MXI01', () => {
    const antes = [A.id, C.id, D.id].map(retrato);
    for (const sql of [
      `SELECT integracao_fdv.portal_monitor('${A.id}');`,
      `SELECT integracao_fdv.portal_log('${A.id}', 'produto');`,
      reprocessarSql(A.id, 'produto', 'r-sem-sessao'),
    ]) {
      recusaConfig(sql, 'MXS01', /sessão de superadmin inválida/, null);
    }
    const x = randomUUID();
    recusaConfig(`SELECT integracao_fdv.portal_monitor('${x}');`, 'P0002', /empresa não encontrada/);
    recusaConfig(`SELECT integracao_fdv.portal_log('${x}', 'produto');`, 'P0002', /empresa não encontrada/);
    recusaConfig(reprocessarSql(x, 'produto', 'r'), 'P0002', /empresa não encontrada/);
    for (const e of ['titulo', 'nao_existe']) {
      recusaConfig(`SELECT integracao_fdv.portal_log('${A.id}', '${e}');`, '23514', /cadastro fora da F2/);
      recusaConfig(reprocessarSql(A.id, e, 'r'), '23514', /cadastro fora da F2/);
    }
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${reprocessarSql(C.id, 'produto', 'r')}`, 'MXI04', 'modulo_desligado', { papel: CONFIG });
    recusaConfig(reprocessarSql(D.id, 'produto', 'r'), 'MXI01', /cadastre a credencial/);
    expect([A.id, C.id, D.id].map(retrato)).toEqual(antes);
  });

  it('(c) portal_monitor: o formato do InsumosMonitorPortal, por tenant; sem credencial = desligado', () => {
    const a = monitor(A.id);
    expect(Object.keys(a).sort()).toEqual(['conector_id', 'credencial_ativa', 'fila', 'habilitadas', 'ultimo_sinal_aceito_em']);
    // fila: nenhum lote em voo; pendentes não excluídos de todos os cadastros (PEN, F2 e CLI)
    expect(a).toEqual({
      credencial_ativa: true,
      conector_id: 'conector-a',
      habilitadas: 2,
      ultimo_sinal_aceito_em: '2026-11-24T20:00:00.123Z', // hora-fixa-ok: idem
      fila: { lotes: 0, linhas: 3 },
    });
    const voo = loteEmVoo(B.id, 'cliente');
    expect(monitor(B.id)).toEqual({ credencial_ativa: true, conector_id: 'conector-b', habilitadas: 1, ultimo_sinal_aceito_em: null, fila: { lotes: 1, linhas: 3 } });
    expect(monitor(A.id)).toEqual(a);
    concluir(voo);
    // sem licença, a leitura vale (empresa visível); sem credencial: tudo zerado
    for (const t of [C.id, D.id]) {
      expect(monitor(t)).toEqual({ credencial_ativa: false, conector_id: null, habilitadas: 0, ultimo_sinal_aceito_em: null, fila: { lotes: 0, linhas: 0 } });
    }
    expect(nAuditoria(A.id)).toBe(0);
  });

  it('(d) portal_log: envios recentes e erros agrupados por código e campo, sem external_id, nome, documento nem payload; isolado por tenant', () => {
    const antes = [A.id, B.id].map(retrato);
    const saida = comoConfig(`SELECT integracao_fdv.portal_log('${A.id}', 'produto');`)[0] ?? '';
    for (const p of PROIBIDOS) expect({ p, achou: saida.includes(p) }).toEqual({ p, achou: false });
    const a = JSON.parse(saida) as Log;
    expect(Object.keys(a).sort()).toEqual(['envios', 'erros', 'pausada_motivo', 'total_erros']);
    expect(a.envios).toEqual([
      { em: '2026-11-20T10:00:00.000Z', estado: 'concluido_com_erros', registros: 4, com_erro: 5, origem: 'reprocessar' }, // hora-fixa-ok: idem
      { em: '2026-11-19T10:00:00.000Z', estado: 'concluido', registros: 2, com_erro: 2, origem: 'zerar' }, // hora-fixa-ok: idem
      // sem enviado_em: o created_at
      { em: '2026-11-18T09:59:00.000Z', estado: 'falhou', registros: 0, com_erro: 0, origem: 'ciclo' }, // hora-fixa-ok: idem
      // origem desconhecida sai como ciclo (o Zod do plugin só aceita as três)
      { em: '2026-11-17T10:00:00.000Z', estado: 'concluido', registros: 1, com_erro: 0, origem: 'ciclo' }, // hora-fixa-ok: idem
    ]);
    // F1 em dois lotes conta uma vez; o resolvido e o sem registro ficam fora; o anulado (ANU) conta, como no lerInsumosLog
    expect(a.erros).toEqual([
      { codigo: 'campo_invalido', campo: 'nome', quantidade: 3 },
      { codigo: 'referencia_ausente', campo: null, quantidade: 1 },
    ]);
    for (const g of a.erros) expect(Object.keys(g).sort()).toEqual(['campo', 'codigo', 'quantidade']);
    expect(a.total_erros).toBe(4);
    expect(a.pausada_motivo).toBeNull();
    // B tem a mesma massa e a pausa: A não vê nada de B nem B de A
    const b = log(B.id, 'produto');
    expect(b).toEqual({ ...a, pausada_motivo: 'versao' });
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo)
       SELECT tenant_id, id, 9, 'erp', 'produto', 'PB-INT', 'campo_obrigatorio', 'sku' FROM integracao_fdv.lote_envio
        WHERE tenant_id = '${B.id}' AND chave_idempotencia = repeat('b1', 32);`,
    );
    expect(log(A.id, 'produto')).toEqual(a);
    expect(log(B.id, 'produto')).toMatchObject({ total_erros: 5, erros: expect.arrayContaining([{ codigo: 'campo_obrigatorio', campo: 'sku', quantidade: 1 }]) });
    executar(banco.conexao, `DELETE FROM integracao_fdv.lote_erro WHERE tenant_id = '${B.id}' AND indice = 9;`);
    // cadastro sem nada e empresa sem licença: vazio
    expect(log(A.id, 'filial')).toEqual({ envios: [], erros: [], total_erros: 0, pausada_motivo: null });
    expect(log(C.id, 'produto')).toEqual({ envios: [], erros: [], total_erros: 0, pausada_motivo: null });
    expect([A.id, B.id].map(retrato)).toEqual(antes);
  });

  it('(e) portal_reprocessar com lote em voo: MXI03 lote_em_voo, nada muda e não audita', () => {
    const voo = loteEmVoo(A.id, 'produto');
    const antes = [A.id, B.id].map(retrato);
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${reprocessarSql(A.id, 'produto', 'req-voo')}`, 'MXI03', 'lote_em_voo', { papel: CONFIG });
    expect([A.id, B.id].map(retrato)).toEqual(antes);
    expect(nAuditoria(A.id)).toBe(0);
    concluir(voo);
  });

  it('(f) portal_reprocessar marca só falha e pendente (nunca o integrado), com a marca reenvio; antecipa o cursor; B intacto; audita', () => {
    const antesB = retrato(B.id);
    const antesA = registros(A.id);
    const antesCliente = registros(A.id, 'cliente');
    const r = reprocessar(A.id, 'produto', 'req-1');
    expect(Object.keys(r).sort()).toEqual(['falhas', 'pedido_em', 'pendentes']);
    expect(r).toMatchObject({ falhas: 2, pendentes: 2 });
    expect(r.pedido_em).toMatch(ISO);
    const depois = registros(A.id);
    expect(depois).toEqual({
      ...antesA,
      'PA-PEN': { ...antesA['PA-PEN']!, pendente: true, reenvio: 'reprocessar' },
      'PA-MUD': { ...antesA['PA-MUD']!, pendente: true, reenvio: 'reprocessar' },
      'PA-F1': { ...antesA['PA-F1']!, pendente: true, reenvio: 'reprocessar' },
      'PA-F2': { ...antesA['PA-F2']!, pendente: true, reenvio: 'reprocessar' },
    });
    // o integrado (com ou sem erro resolvido), o anulado e o excluído não mudam; o hash e o ativo de ninguém mudam
    expect([depois['PA-INT'], depois['PA-INT2'], depois['PA-ANU']]).toEqual([antesA['PA-INT'], antesA['PA-INT2'], antesA['PA-ANU']]);
    expect(
      um(`SELECT fonte_refs FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}' AND registro_external_id = 'PA-F1'`),
    ).toEqual({ fonte_refs: { inativado_por: 'zerar', reenvio: 'reprocessar' } });
    expect(um(`SELECT pendente, fonte_refs FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}' AND registro_external_id = 'PA-EXC'`)).toEqual({
      pendente: true,
      fonte_refs: {},
    });
    expect(registros(A.id, 'cliente')).toEqual(antesCliente);
    // sem carga completa: o cursor só é antecipado (nada de sessão nem cursor zerado)
    expect(
      um(`SELECT proximo_em <= now() AS ja, sessao_aberta_id IS NULL AS sem_sessao, cursor_alterado_em IS NULL AS sem_cursor
            FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' AND entidade = 'produto'`),
    ).toEqual({ ja: true, sem_sessao: true, sem_cursor: true });
    expect(retrato(B.id)).toEqual(antesB);
    expect(
      consultar(
        banco.conexao,
        `SELECT usuario_id, superadmin_id, entidade, antes, depois - 'pedido_em' AS depois, request_id FROM plataforma.auditoria
          WHERE tenant_id = '${A.id}' AND acao = 'integracao-fdv.entidade.reprocessar'`,
      ),
    ).toEqual([
      { usuario_id: null, superadmin_id: SA, entidade: 'cursor_entidade', antes: null, depois: { entidade: 'produto', falhas: 2, pendentes: 2 }, request_id: 'req-1' },
    ]);
  });

  it('(g) idempotente por request_id: a repetição devolve o mesmo resultado sem efeito novo, até com lote em voo; outro request_id recusa', () => {
    const primeiro = um<{ depois: Reprocessar & { entidade: string } }>(
      `SELECT depois FROM plataforma.auditoria WHERE tenant_id = '${A.id}' AND request_id = 'req-1'`,
    ).depois;
    // o ciclo confirmou um pendente entre as chamadas: a repetição não o remarca
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.registro_publicado SET pendente = false, hash_confirmado = hash, confirmado_em = now()
        WHERE tenant_id = '${A.id}' AND registro_external_id = 'PA-MUD';`,
    );
    const antes = retrato(A.id);
    const r = reprocessar(A.id, 'produto', 'req-1');
    expect(r).toEqual({ falhas: 2, pendentes: 2, pedido_em: primeiro.pedido_em });
    expect(retrato(A.id)).toEqual(antes);
    const voo = loteEmVoo(A.id, 'produto');
    const comVoo = retrato(A.id);
    expect(reprocessar(A.id, 'produto', 'req-1')).toEqual(r);
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${reprocessarSql(A.id, 'produto', 'req-2')}`, 'MXI03', 'lote_em_voo', { papel: CONFIG });
    expect(retrato(A.id)).toEqual(comVoo);
    concluir(voo);
    // o mesmo request_id em outro cadastro não é repetição
    expect(reprocessar(A.id, 'cliente', 'req-1')).toMatchObject({ falhas: 0, pendentes: 1 });
    // pedido novo: só o que segue em falha ou pendente (PA-MUD confirmado saiu)
    expect(reprocessar(A.id, 'produto', 'req-3')).toMatchObject({ falhas: 2, pendentes: 1 });
    expect(nAuditoria(A.id)).toBe(3);
  });

  it('(h) paridade com o planejarReprocessar do domain (tabela de casos): o mesmo conjunto e as mesmas contagens', () => {
    const lote = inserirId(
      `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, hub_lote_id, concluido_em)
       VALUES ('${P.id}', 'produto', '${cred[P.id]}', 'delta', repeat('c', 64), 'concluido_com_erros', gen_random_uuid(), now()) RETURNING id;`,
    );
    executar(
      banco.conexao,
      CASOS.map(
        (c, i) => `
INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em,
  ativo, pendente, hash_confirmado, confirmado_em, deleted_at)
  VALUES ('${P.id}', 'produto', '${c.id}', ${c.extra === 'sem_payload' ? 'NULL' : `'{}'`}, repeat('${c.hash}', 64), now(), now(),
    ${c.extra !== 'sem_payload'}, ${c.pendente}, ${c.confirmado === null ? 'NULL' : `repeat('${c.confirmado}', 64)`},
    ${c.confirmado === null ? 'NULL' : 'now()'}, ${c.extra === 'excluido' ? 'now()' : 'NULL'});
${
  c.erro === null
    ? ''
    : `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, resolvido_em)
  VALUES ('${P.id}', '${lote}', ${i}, 'hub', 'produto', '${c.id}', 'campo_invalido', ${c.erro === 'resolvido' ? 'now()' : 'NULL'});`
}`,
      ).join(''),
    );
    const r = reprocessar(P.id, 'produto', 'req-paridade');
    const marcados = consultar<{ x: string }>(
      banco.conexao,
      `SELECT registro_external_id AS x FROM integracao_fdv.registro_publicado
        WHERE tenant_id = '${P.id}' AND fonte_refs ->> 'reenvio' = 'reprocessar' ORDER BY 1`,
    ).map((l) => l.x);
    const esperados = CASOS.filter((c) => c.esperado === 'falha' || c.esperado === 'pendente').map((c) => c.id).sort();
    expect(marcados).toEqual(esperados);
    expect({ falhas: r.falhas, pendentes: r.pendentes }).toEqual({
      falhas: CASOS.filter((c) => c.esperado === 'falha').length,
      pendentes: CASOS.filter((c) => c.esperado === 'pendente').length,
    });
    // todo marcado ficou pendente; o integrado não voltou a pendente
    expect(
      consultar<{ x: string; pendente: boolean }>(
        banco.conexao,
        `SELECT registro_external_id AS x, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = '${P.id}' ORDER BY 1`,
      ),
    ).toEqual(
      [...CASOS]
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map((c) => ({ x: c.id, pendente: c.esperado === 'falha' || c.esperado === 'pendente' ? true : c.pendente })),
    );
  });

  it('(i) reexecutar a 0055 não muda dado nem privilégio', () => {
    const antes = [A.id, B.id, P.id].map(retrato);
    const privilegios = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT p.oid::regprocedure::text AS f, pg_get_userbyid(p.proowner) AS dono, p.prosecdef, p.proconfig, p.proacl::text AS acl
           FROM pg_proc p WHERE p.oid = ANY (ARRAY[${FUNCOES.map((f) => `'${f}'::regprocedure`).join(', ')}]::oid[]) ORDER BY 1`,
      );
    const privAntes = privilegios();
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect([A.id, B.id, P.id].map(retrato)).toEqual(antes);
    expect(privilegios()).toEqual(privAntes);
  });
});
