/**
 * T-0056 (v0.3.4), migração 0038: integração FDV gravada pelo portal /config (ADR 0013, seção 2 e a linha "2 | banco-dados"
 * da seção 8; decisão do PO, 12h43). As funções SECURITY DEFINER do schema integracao_fdv reproduzem as rotas de
 * modules/integracao-fdv/api/rotas.ts (PUT /credencial, PUT /configuracao, POST /credencial/testar, POST
 * /entidades/:e/carga-completa e /retomar) para o macuxierp_config, com auditoria de superadmin e sem a chave, o prefixo
 * nem o cifrado na auditoria. O portal_ler devolve os insumos crus (a falha sai do falhaEnvioFdv do SDK, no módulo).
 * A 0039 troca o 23514 de empresa fora de ativo e de módulo desligado por MXI04 (DETAIL empresa_inativa | modulo_desligado).
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
  verboso,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0038_integracao_fdv_portal.sql', import.meta.url));
/** 0039 (T-0056). */
const MIGRACAO_0039 = fileURLToPath(new URL('../migrations/0039_integracao_fdv_portal_mxi04.sql', import.meta.url));
/** 0042 (T-0058): credencial nova vazia; portal_configurar com o evento de carga inicial. */
const MIGRACAO_0042 = fileURLToPath(new URL('../migrations/0042_integracao_fdv_credencial_vazia.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
const A = novoTenant('ifdv-0038-a');
const B = novoTenant('ifdv-0038-b');
/** Sem a licença do integracao-fdv. */
const C = novoTenant('ifdv-0038-c');
/** Licenciada, mas suspensa. */
const D = novoTenant('ifdv-0038-d');
/** Licenciada, mas excluída. */
const E = novoTenant('ifdv-0038-e');
const SA = '5a000000-0000-4000-8000-000000000381';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const CIFRADA = `decode(repeat('ab', 40), 'hex')`;
const PREFIXO = 'pfx0038';
const EVENTO = 'integracao-fdv.carga_inicial.solicitada@1';
/** ENTIDADES_ENVIO_FDV do SDK, na ordem de carga (o teste do db não importa o SDK: trava a cópia aqui). */
const F2 = ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'estoque', 'cliente', 'cliente_endereco'];

/** Funções do portal: EXECUTE só do macuxierp_config (lista fechada da ADR 0013). */
const PORTAL = [
  'integracao_fdv.portal_ler(uuid)',
  'integracao_fdv.portal_credencial_definir(uuid, uuid, text, text, bytea, text, integer, boolean, jsonb, text, text[], integer)',
  'integracao_fdv.portal_configurar(uuid, text[], integer, text, jsonb, text[])', // 0042: + p_evento_carga_inicial e p_antes DEFAULT NULL
  'integracao_fdv.portal_testar(uuid, text)',
  'integracao_fdv.portal_carga_completa(uuid, text, text)',
  'integracao_fdv.portal_retomar(uuid, text, text)',
] as const;
const INTERNAS = [
  'integracao_fdv.portal_entidades_f2()',
  'integracao_fdv.portal_modulo_licenciado(uuid)',
  'integracao_fdv.portal_empresa(uuid, boolean)',
  'integracao_fdv.portal_conferir_config(text[], integer)',
  'integracao_fdv.portal_conferir_evento(jsonb)',
  'integracao_fdv.portal_antecipar(uuid, text[])',
  'integracao_fdv.portal_credencial_ativa(uuid, boolean, boolean)',
  'integracao_fdv.portal_resumo(integracao_fdv.credencial)',
  'integracao_fdv.portal_lote_em_voo(uuid, integracao_fdv.entidade_hub)',
  'integracao_fdv.portal_estado(uuid)',
] as const;
// da 0043 (zerar dados por cadastro): têm teste próprio em cadastros-zerar-0043.db.test.ts; aqui só entram na contagem
const DA_0043 = [
  'integracao_fdv.portal_conferir_entidades(text[])',
  'integracao_fdv.portal_estado_entidades(uuid, text[])',
  'integracao_fdv.portal_zerar_espelho(uuid, text[], text)',
] as const;
/** Da 0055 (T-0086): Monitor, Log e Reprocessar do /config; teste próprio em integracao-fdv-portal-operacao-0055.db.test.ts. */
const DA_0055 = ['integracao_fdv.portal_monitor(uuid)', 'integracao_fdv.portal_log(uuid, text)', 'integracao_fdv.portal_reprocessar(uuid, text, text)'] as const;
/** Internas da 0053 (T-0086): a inativação do espelho no zerar. */
const DA_0053 = ['integracao_fdv.portal_inativar_espelho(uuid, text[], jsonb)', 'integracao_fdv.portal_inativar_linhas(uuid, uuid[])'] as const;
const CHAVES_TOPO = ['cadastros', 'credencial', 'empresa_id', 'entidades_habilitadas', 'limite_registros_lote', 'modulo_licenciado', 'sinal'];
const CHAVES_CREDENCIAL = ['ambiente', 'chave_prefixo', 'conector_id', 'criada_em', 'id', 'ultimo_uso_em'];
const CHAVES_CADASTRO = ['entidade', 'erros_abertos', 'habilitada', 'ligada', 'lote_em_voo', 'pausada_motivo', 'ultimo_envio_em', 'ultimo_lote'];

interface Cadastro {
  entidade: string;
  habilitada: boolean;
  ligada: boolean;
  pausada_motivo: string | null;
  lote_em_voo: boolean;
  ultimo_envio_em: string | null;
  ultimo_lote: { estado: string; erro_codigo: string | null; em: string } | null;
  erros_abertos: number;
}
interface Estado {
  empresa_id: string;
  modulo_licenciado: boolean;
  credencial: { id: string; conector_id: string; ambiente: string; chave_prefixo: string; criada_em: string; ultimo_uso_em: string | null } | null;
  entidades_habilitadas: string[];
  limite_registros_lote: number | null;
  sinal: Record<string, unknown> | null;
  cadastros: Cadastro[];
}
const cadastroVazio = (entidade: string, habilitada: boolean, ligada = habilitada): Cadastro => ({
  entidade,
  habilitada,
  ligada,
  pausada_motivo: null,
  lote_em_voo: false,
  ultimo_envio_em: null,
  ultimo_lote: null,
  erros_abertos: 0,
});

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — integração FDV pelo portal /config (T-0056, 0038)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const jsonConfig = <T>(sql: string): T => JSON.parse(comoConfig(sql)[0] ?? 'null') as T;
  const ler = (t: string): Estado => jsonConfig<Estado>(`SELECT integracao_fdv.portal_ler('${t}');`);
  const recusaConfig = (sql: string, codigo: string, padrao: RegExp, s: string | null = sessao): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: CONFIG });
  /** MXI04 (0039) com o motivo exato no DETAIL e a mensagem curta. */
  const recusaMxi04 = (sql: string, detalhe: 'empresa_inativa' | 'modulo_desligado'): void => {
    const e = falhaDetalhada(() => executar(banco.conexao, verboso(`${sessaoSql(sessao)}${sql}`), { papel: CONFIG }));
    expect({ sql, saida: e.saida }).toMatchObject({ sql, saida: expect.stringContaining('MXI04') });
    expect({ sql, detalhe: /DETAIL:\s+(\S+)/.exec(e.saida)?.[1] }).toEqual({ sql, detalhe });
    expect({ sql, mensagem: e.mensagem }).toMatchObject({
      sql,
      mensagem: expect.stringMatching(detalhe === 'empresa_inativa' ? /empresa fora de ativo/ : /módulo integracao-fdv desligado/),
    });
  };
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  /** Linhas de auditoria da integração (a fixture já audita outras coisas). */
  const nAuditoria = (t: string): number => um<{ n: number }>(`SELECT count(*)::int AS n FROM plataforma.auditoria WHERE tenant_id = '${t}' AND acao LIKE 'integracao-fdv.%'`).n;
  const ativa = (t: string): { id: string } | undefined =>
    consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM integracao_fdv.credencial WHERE tenant_id = '${t}' AND substituida_em IS NULL AND deleted_at IS NULL`,
    )[0];
  /** Sem p_entidades e p_limite: vale o DEFAULT (os padrões da F2). */
  const definir = (
    t: string,
    anterior: string | null,
    o: { conector?: string; ambiente?: string; zerar?: boolean; evento?: boolean; req?: string; extra?: string } = {},
  ): string =>
    `SELECT integracao_fdv.portal_credencial_definir('${t}', ${anterior ? `'${anterior}'` : 'NULL'}, '${o.conector ?? 'conector-a'}',
       '${o.ambiente ?? 'teste'}', ${CIFRADA}, '${PREFIXO}', 1, ${o.zerar ?? false},
       ${o.evento ? `'{"entidades":["filial","produto"]}'::jsonb` : 'NULL'}, '${o.req ?? 'req-def'}'${o.extra ?? ''});`;
  /** As cinco escritas, com argumentos válidos (para as barreiras de sessão, empresa e licença). */
  const escritas = (t: string): string[] => [
    definir(t, null),
    `SELECT integracao_fdv.portal_configurar('${t}', ARRAY['filial'], 10, 'r');`,
    `SELECT integracao_fdv.portal_testar('${t}', 'r');`,
    `SELECT integracao_fdv.portal_carga_completa('${t}', 'filial', 'r');`,
    `SELECT integracao_fdv.portal_retomar('${t}', 'filial', 'r');`,
  ];
  /** Retrato de tudo do tenant nas tabelas que as funções tocam (isolamento). */
  const retrato = (t: string): unknown =>
    consultar(
      banco.conexao,
      `SELECT t, l FROM (SELECT 'credencial' AS t, to_jsonb(c) - 'chave_cifrada' AS l FROM integracao_fdv.credencial c WHERE tenant_id = '${t}'
       UNION ALL SELECT 'cursor', to_jsonb(k) FROM integracao_fdv.cursor_entidade k WHERE tenant_id = '${t}'
       UNION ALL SELECT 'sinal', to_jsonb(s) FROM integracao_fdv.sinal s WHERE tenant_id = '${t}'
       UNION ALL SELECT 'registro', to_jsonb(r) FROM integracao_fdv.registro_publicado r WHERE tenant_id = '${t}'
       UNION ALL SELECT 'evento', to_jsonb(e) FROM plataforma.evento e WHERE tenant_id = '${t}'
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
      `${fixturePlataforma(A)}${fixturePlataforma(B)}${fixturePlataforma(C)}${fixturePlataforma(D)}${fixturePlataforma(E)}
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo)
  VALUES ('${A.id}', 'integracao-fdv'), ('${B.id}', 'integracao-fdv'), ('${D.id}', 'integracao-fdv'), ('${E.id}', 'integracao-fdv');
UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${D.id}';
UPDATE plataforma.tenant SET deleted_at = now() WHERE id = '${E.id}';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0038@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) EXECUTE só do config nas do portal; internas de ninguém; o app e o worker não executam; SECURITY DEFINER, search_path fixo, sem PUBLIC', () => {
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
    // app, worker e leitura recebem 42501 mesmo com tenant, em todas; o config segue sem ler as tabelas do módulo
    for (const papel of ['macuxierp_app', 'macuxierp_worker', 'macuxierp_leitura']) {
      for (const sql of [`SELECT integracao_fdv.portal_ler('${A.id}');`, ...escritas(A.id)]) {
        recusaDetalhada(banco.conexao, sql, '42501', /permission denied/, { papel, tenant: A.id });
      }
    }
    recusaConfig('SELECT count(*) FROM integracao_fdv.credencial;', '42501', /permission denied/);
    // a lista da F2 é o espelho de ENTIDADES_ENVIO_FDV; o DEFAULT do definir: vazia desde a 0042 (R-20261123-150400) e
    // o LIMITE_REGISTROS_LOTE_FDV
    expect(um(`SELECT integracao_fdv.portal_entidades_f2() AS f2`)).toEqual({ f2: F2 });
    expect(
      um<{ d: string }>(
        `SELECT pg_get_function_arguments('${PORTAL[1]}'::regprocedure) AS d`,
      ).d,
    ).toContain(`p_entidades text[] DEFAULT '{}'::text[], p_limite integer DEFAULT 5000`);
  });

  it('(b) sem sessão de superadmin = MXS01 em todas; empresa de referência, excluída ou inexistente = P0002', () => {
    for (const sql of [`SELECT integracao_fdv.portal_ler('${A.id}');`, ...escritas(A.id)]) {
      recusaConfig(sql, 'MXS01', /sessão de superadmin inválida/, null);
    }
    const inexistente = randomUUID();
    for (const t of [REFERENCIA, inexistente, E.id]) {
      for (const sql of [`SELECT integracao_fdv.portal_ler('${t}');`, ...escritas(t)]) recusaConfig(sql, 'P0002', /empresa não encontrada/);
    }
    expect(nAuditoria(A.id)).toBe(0);
  });

  it('(c) módulo desligado ou empresa suspensa = MXI04 (0039) com DETAIL modulo_desligado / empresa_inativa nas cinco escritas; a leitura segue (modulo_licenciado false)', () => {
    for (const sql of escritas(C.id)) recusaMxi04(sql, 'modulo_desligado');
    for (const sql of escritas(D.id)) recusaMxi04(sql, 'empresa_inativa');
    expect(ler(C.id).modulo_licenciado).toBe(false);
    // licença inativa ou vencida também é módulo desligado
    executar(banco.conexao, `INSERT INTO plataforma.tenant_modulo (tenant_id, modulo, ativo) VALUES ('${C.id}', 'integracao-fdv', false);`);
    recusaMxi04(definir(C.id, null), 'modulo_desligado');
    executar(banco.conexao, `UPDATE plataforma.tenant_modulo SET ativo = true, valido_ate = now() - interval '1 day' WHERE tenant_id = '${C.id}' AND modulo = 'integracao-fdv';`);
    recusaMxi04(definir(C.id, null), 'modulo_desligado');
    expect(ler(C.id).modulo_licenciado).toBe(false);
    expect(ler(D.id).modulo_licenciado).toBe(true);
    expect([nAuditoria(C.id), nAuditoria(D.id)]).toEqual([0, 0]);
    expect(um(`SELECT count(*)::int AS n FROM integracao_fdv.credencial WHERE tenant_id IN ('${C.id}', '${D.id}')`)).toEqual({ n: 0 });
  });

  it('(d) sem credencial: portal_ler com os 10 cadastros desligados; configurar, testar e carga completa = MXI01; anterior não nulo = MXI02', () => {
    expect(ler(B.id)).toEqual({
      empresa_id: B.id,
      modulo_licenciado: true,
      credencial: null,
      entidades_habilitadas: [],
      limite_registros_lote: null,
      sinal: null,
      cadastros: F2.map((e) => cadastroVazio(e, false)),
    });
    recusaConfig(`SELECT integracao_fdv.portal_configurar('${B.id}', ARRAY['filial'], 10, 'r');`, 'MXI01', /cadastre a credencial/);
    recusaConfig(`SELECT integracao_fdv.portal_testar('${B.id}', 'r');`, 'MXI01', /cadastre a credencial/);
    recusaConfig(`SELECT integracao_fdv.portal_carga_completa('${B.id}', 'filial', 'r');`, 'MXI01', /cadastre a credencial/);
    recusaConfig(definir(B.id, randomUUID()), 'MXI02', /a credencial mudou; recarregue/);
    expect(nAuditoria(B.id)).toBe(0);
  });

  it('(e) primeira credencial (anterior NULL, F2 explícita; o DEFAULT vazio é da 0042): devolve o portal_ler, sinal criado, carga inicial na outbox e auditoria sem chave', () => {
    const antesB = retrato(B.id);
    const f2 = `, ARRAY[${F2.map((e) => `'${e}'`).join(', ')}]::text[]`;
    const r = jsonConfig<Estado>(definir(A.id, null, { evento: true, req: 'req-criar', extra: f2 }));
    expect(Object.keys(r).sort()).toEqual(CHAVES_TOPO);
    expect(Object.keys(r.credencial!).sort()).toEqual(CHAVES_CREDENCIAL);
    expect(r.credencial).toMatchObject({ conector_id: 'conector-a', ambiente: 'teste', chave_prefixo: PREFIXO, ultimo_uso_em: null });
    expect(r.credencial!.criada_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r).toMatchObject({ empresa_id: A.id, modulo_licenciado: true, entidades_habilitadas: F2, limite_registros_lote: 5000 });
    expect(r.cadastros).toEqual(F2.map((e) => cadastroVazio(e, true)));
    expect(r.sinal).toEqual({ ultimo_envio_em: null, ultimo_aceito_em: null, ultimo_http: null, parado_por_versao: false });
    expect(ler(A.id)).toEqual(r);
    const c = r.credencial!;
    expect(um(`SELECT criada_por, chave_cifrada = ${CIFRADA} AS cifrada FROM integracao_fdv.credencial WHERE id = '${c.id}'`)).toEqual({
      criada_por: null,
      cifrada: true,
    });
    expect(
      um(`SELECT count(*)::int AS n, bool_and(proximo_sinal_em <= now()) AS ja,
            bool_and(proxima_reconciliacao_em > now()) AS rec FROM integracao_fdv.sinal WHERE tenant_id = '${A.id}'`),
    ).toEqual({ n: 1, ja: true, rec: true });
    expect(
      consultar(banco.conexao, `SELECT nome, agregado_id, versao::int AS versao, payload FROM plataforma.evento WHERE tenant_id = '${A.id}' AND nome LIKE 'integracao-fdv.%'`),
    ).toEqual([{ nome: EVENTO, agregado_id: c.id, versao: 1, payload: { ator: 'sistema', request_id: 'req-criar', payload: { entidades: ['filial', 'produto'] } } }]);
    const aud = consultar<Record<string, unknown>>(
      banco.conexao,
      `SELECT acao, entidade, entidade_id, usuario_id, superadmin_id, antes, depois FROM plataforma.auditoria
        WHERE tenant_id = '${A.id}' AND request_id = 'req-criar'`,
    );
    expect(aud).toEqual([
      {
        acao: 'integracao-fdv.credencial.criar',
        entidade: 'credencial',
        entidade_id: c.id,
        usuario_id: null,
        superadmin_id: SA,
        antes: null,
        depois: { conector_id: 'conector-a', ambiente: 'teste', zerou_espelho: false },
      },
    ]);
    expect(JSON.stringify(aud)).not.toMatch(new RegExp(`${PREFIXO}|chave|abab`));
    // evento fora do formato; p_entidades e p_limite (só conferidos na primeira, 0042: B ainda não tem credencial) fora
    // da F2, repetidos, com nulo ou fora de 1..5000 = 23514
    recusaConfig(
      `SELECT integracao_fdv.portal_credencial_definir('${A.id}', '${c.id}', 'x', 'teste', ${CIFRADA}, 'p', 1, false, '{"entidades":[]}', 'r');`,
      '23514',
      /evento de carga inicial/,
    );
    for (const [extra, padrao] of [
      [`, ARRAY['titulo']`, /fora da F2 ou repetidas/],
      [`, ARRAY['filial','filial']`, /fora da F2 ou repetidas/],
      [`, ARRAY[NULL]::text[]`, /fora da F2 ou repetidas/],
      [`, ARRAY['filial'], 0`, /fora de 1 a 5000/],
      [`, ARRAY['filial'], 5001`, /fora de 1 a 5000/],
      [`, ARRAY['filial'], NULL`, /fora de 1 a 5000/],
    ] as const) {
      recusaConfig(definir(B.id, null, { extra }), '23514', padrao);
    }
    expect(retrato(B.id)).toEqual(antesB);
  });

  it('(f) troca com o anterior certo: anterior substituída (chave só anulável, como na 0007), configuração copiada; anterior velho = MXI02', () => {
    const anterior = ativa(A.id)!.id;
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.credencial SET entidades_habilitadas = ARRAY['filial','cliente']::integracao_fdv.entidade_hub[], limite_registros_lote = 300 WHERE id = '${anterior}';`,
    );
    const n = nAuditoria(A.id);
    recusaConfig(definir(A.id, null), 'MXI02', /a credencial mudou; recarregue/);
    recusaConfig(definir(A.id, randomUUID()), 'MXI02', /a credencial mudou; recarregue/);
    expect(nAuditoria(A.id)).toBe(n);
    const r = jsonConfig<Estado>(definir(A.id, anterior, { req: 'req-trocar', extra: `, ARRAY['estoque'], 7` }));
    expect(r.credencial!.id).not.toBe(anterior);
    // na troca valem as da ativa (p_entidades e p_limite só na primeira)
    expect(r).toMatchObject({ entidades_habilitadas: ['filial', 'cliente'], limite_registros_lote: 300 });
    expect(r.cadastros.filter((x) => x.ligada).map((x) => x.entidade)).toEqual(['filial', 'cliente']);
    expect(um(`SELECT substituida_em IS NOT NULL AS sub, chave_cifrada IS NOT NULL AS chave FROM integracao_fdv.credencial WHERE id = '${anterior}'`)).toEqual({
      sub: true,
      chave: true,
    });
    recusaDetalhada(banco.conexao, `UPDATE integracao_fdv.credencial SET chave_cifrada = decode(repeat('cd', 40), 'hex') WHERE id = '${anterior}';`, '42501', /só pode ser anulada/);
    executar(banco.conexao, `UPDATE integracao_fdv.credencial SET chave_cifrada = NULL WHERE id = '${anterior}';`);
    recusaConfig(definir(A.id, anterior), 'MXI02', /a credencial mudou; recarregue/);
    expect(um(`SELECT acao, superadmin_id, antes, depois FROM plataforma.auditoria WHERE tenant_id = '${A.id}' AND request_id = 'req-trocar'`)).toEqual({
      acao: 'integracao-fdv.credencial.trocar',
      superadmin_id: SA,
      antes: { conector_id: 'conector-a', ambiente: 'teste' },
      depois: { conector_id: 'conector-a', ambiente: 'teste', zerou_espelho: false },
    });
    // sem evento pedido, nada novo na outbox
    expect(um(`SELECT count(*)::int AS n FROM plataforma.evento WHERE tenant_id = '${A.id}' AND nome = '${EVENTO}'`)).toEqual({ n: 1 });
  });

  it('(g) zerar espelho zera cursores e confirmações sem apagar linha; a pausa de credencial sai, com auditoria', () => {
    const cred = ativa(A.id)!.id;
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.cursor_entidade (tenant_id, entidade, cursor_alterado_em, cursor_external_id, sessao_aberta_id, proximo_em, pausada_motivo, pausada_em)
         VALUES ('${A.id}', 'filial', now(), 'x1', gen_random_uuid(), now() + interval '1 day', 'credencial', now()),
                ('${A.id}', 'cliente', now(), 'x2', NULL, now() + interval '1 day', 'versao', now());
       INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, ativo, pendente, hash_confirmado, confirmado_em)
         VALUES ('${A.id}', 'filial', 'r1', '{}', repeat('a', 64), now(), now(), true, false, repeat('a', 64), now()),
                ('${A.id}', 'filial', 'r2', NULL, repeat('b', 64), now(), now(), false, false, repeat('b', 64), now());`,
    );
    const antes = um<{ k: number; r: number }>(
      `SELECT (SELECT count(*)::int FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}') AS k,
              (SELECT count(*)::int FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}') AS r`,
    );
    const r = jsonConfig<Estado>(definir(A.id, cred, { ambiente: 'producao', zerar: true, evento: true, req: 'req-zerar' }));
    expect(r.cadastros.find((x) => x.entidade === 'cliente')!.pausada_motivo).toBe('versao');
    expect(r.cadastros.find((x) => x.entidade === 'filial')!.pausada_motivo).toBeNull();
    expect(
      consultar(
        banco.conexao,
        `SELECT entidade::text AS e, cursor_alterado_em IS NULL AND cursor_external_id IS NULL AND sessao_aberta_id IS NULL AS zerado,
           proximo_em <= now() AS antecipado, pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' ORDER BY 1`,
      ),
    ).toEqual([
      { e: 'cliente', zerado: true, antecipado: true, pausada_motivo: 'versao' },
      { e: 'filial', zerado: true, antecipado: true, pausada_motivo: null },
    ]);
    expect(
      consultar(banco.conexao, `SELECT registro_external_id AS id, hash_confirmado IS NULL AS limpo FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}' ORDER BY 1`),
    ).toEqual([
      { id: 'r1', limpo: true },
      { id: 'r2', limpo: false },
    ]);
    expect(
      um(`SELECT (SELECT count(*)::int FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}') AS k,
                 (SELECT count(*)::int FROM integracao_fdv.registro_publicado WHERE tenant_id = '${A.id}') AS r`),
    ).toEqual(antes);
    expect(
      consultar(banco.conexao, `SELECT acao, superadmin_id, antes, depois FROM plataforma.auditoria WHERE tenant_id = '${A.id}' AND request_id = 'req-zerar' ORDER BY acao`),
    ).toEqual([
      { acao: 'integracao-fdv.credencial.liberar_pausa', superadmin_id: SA, antes: { pausada_motivo: 'credencial', entidades: ['filial'] }, depois: { pausada_motivo: null } },
      {
        acao: 'integracao-fdv.credencial.trocar',
        superadmin_id: SA,
        antes: { conector_id: 'conector-a', ambiente: 'teste' },
        depois: { conector_id: 'conector-a', ambiente: 'producao', zerou_espelho: true },
      },
    ]);
    expect(um(`SELECT count(*)::int AS n FROM plataforma.evento WHERE agregado_id = '${r.credencial!.id}' AND nome = '${EVENTO}'`)).toEqual({ n: 1 });
    // nenhuma auditoria do tenant leva a chave, o prefixo ou o cifrado
    expect(JSON.stringify(consultar(banco.conexao, `SELECT antes, depois FROM plataforma.auditoria WHERE tenant_id = '${A.id}'`))).not.toMatch(
      new RegExp(`${PREFIXO}|chave|abab`),
    );
  });

  it('(h) configurar: grava, antecipa as que ligaram, audita e devolve o portal_ler; fora da F2, repetida ou limite fora de 1..5000 = 23514', () => {
    const cred = ativa(A.id)!.id;
    executar(banco.conexao, `UPDATE integracao_fdv.cursor_entidade SET proximo_em = now() + interval '1 day' WHERE tenant_id = '${A.id}';`);
    const r = jsonConfig<Estado>(`SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['produto','filial'], 100, 'req-conf');`);
    expect(r).toMatchObject({ entidades_habilitadas: ['produto', 'filial'], limite_registros_lote: 100 });
    expect(r.cadastros.filter((x) => x.ligada).map((x) => x.entidade)).toEqual(['filial', 'produto']);
    expect(r.cadastros.map((x) => x.entidade)).toEqual(F2);
    expect(um(`SELECT entidades_habilitadas::text[] AS e, limite_registros_lote AS l FROM integracao_fdv.credencial WHERE id = '${cred}'`)).toEqual({
      e: ['produto', 'filial'],
      l: 100,
    });
    expect(
      consultar(banco.conexao, `SELECT entidade::text AS e, proximo_em <= now() AS ja FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' ORDER BY 1`),
    ).toEqual([
      { e: 'cliente', ja: false },
      { e: 'filial', ja: false },
      { e: 'produto', ja: true },
    ]);
    expect(um(`SELECT acao, superadmin_id, entidade_id, antes, depois FROM plataforma.auditoria WHERE request_id = 'req-conf'`)).toEqual({
      acao: 'integracao-fdv.configuracao.alterar',
      superadmin_id: SA,
      entidade_id: cred,
      antes: { entidades_habilitadas: ['filial', 'cliente'], limite_registros_lote: 300 },
      depois: { entidades_habilitadas: ['produto', 'filial'], limite_registros_lote: 100 },
    });
    const n = nAuditoria(A.id);
    for (const [args, padrao] of [
      [`ARRAY['filial','filial'], 10`, /fora da F2 ou repetidas/],
      [`ARRAY['titulo'], 10`, /fora da F2 ou repetidas/],
      [`ARRAY['nao_existe'], 10`, /fora da F2 ou repetidas/],
      [`NULL, 10`, /fora da F2 ou repetidas/],
      [`ARRAY['filial'], 0`, /fora de 1 a 5000/],
      [`ARRAY['filial'], 5001`, /fora de 1 a 5000/],
    ] as const) {
      recusaConfig(`SELECT integracao_fdv.portal_configurar('${A.id}', ${args}, 'r');`, '23514', padrao);
    }
    expect(nAuditoria(A.id)).toBe(n);
    // lista vazia = nada sai (vale)
    expect(jsonConfig<Estado>(`SELECT integracao_fdv.portal_configurar('${A.id}', '{}', 100, 'req-vazia');`).cadastros.some((x) => x.ligada)).toBe(false);
    jsonConfig(`SELECT integracao_fdv.portal_configurar('${A.id}', ARRAY['produto','filial'], 100, 'req-volta');`);
  });

  it('(i) testar devolve pedido_em, antecipa o sinal e audita com superadmin_id', () => {
    executar(banco.conexao, `UPDATE integracao_fdv.sinal SET proximo_sinal_em = now() + interval '1 hour' WHERE tenant_id = '${A.id}';`);
    const [pedido] = comoConfig(`SELECT to_char(integracao_fdv.portal_testar('${A.id}', 'req-testar') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS');`);
    expect(pedido).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(um(`SELECT proximo_sinal_em <= now() AS ja FROM integracao_fdv.sinal WHERE tenant_id = '${A.id}'`)).toEqual({ ja: true });
    expect(um(`SELECT acao, superadmin_id, usuario_id, depois FROM plataforma.auditoria WHERE request_id = 'req-testar'`)).toEqual({
      acao: 'integracao-fdv.credencial.testar',
      superadmin_id: SA,
      usuario_id: null,
      depois: { conector_id: 'conector-a', ambiente: 'producao' },
    });
  });

  it('(j) carga completa: zera o cursor sem sessão, abre sessão, antecipa e audita; desligado ou lote em voo = MXI03; fora da F2 = 23514', () => {
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.cursor_entidade SET cursor_alterado_em = now(), cursor_external_id = 'z', sessao_aberta_id = NULL, proximo_em = now() + interval '1 day'
        WHERE tenant_id = '${A.id}' AND entidade = 'filial';`,
    );
    expect(jsonConfig(`SELECT integracao_fdv.portal_carga_completa('${A.id}', 'filial', 'req-carga');`)).toEqual({ aceito: true });
    const k = um<{ id: string; zerado: boolean; sessao: boolean; ja: boolean }>(
      `SELECT id, cursor_alterado_em IS NULL AS zerado, sessao_aberta_id IS NOT NULL AS sessao, proximo_em <= now() AS ja
         FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' AND entidade = 'filial'`,
    );
    expect(k).toMatchObject({ zerado: true, sessao: true, ja: true });
    expect(um(`SELECT acao, superadmin_id, usuario_id, entidade, entidade_id, depois FROM plataforma.auditoria WHERE request_id = 'req-carga'`)).toEqual({
      acao: 'integracao-fdv.entidade.carga_completa',
      superadmin_id: SA,
      usuario_id: null,
      entidade: 'cursor_entidade',
      entidade_id: k.id,
      depois: { entidade: 'filial' },
    });
    // sessão aberta continua (a segunda carga não zera de novo nem troca a sessão)
    const s1 = um<{ s: string }>(`SELECT sessao_aberta_id AS s FROM integracao_fdv.cursor_entidade WHERE id = '${k.id}'`).s;
    jsonConfig(`SELECT integracao_fdv.portal_carga_completa('${A.id}', 'filial', 'req-carga-2');`);
    expect(um<{ s: string }>(`SELECT sessao_aberta_id AS s FROM integracao_fdv.cursor_entidade WHERE id = '${k.id}'`).s).toBe(s1);
    const n = nAuditoria(A.id);
    // desligado (não habilitado): MXI03 e o upsert é desfeito (nenhum cursor novo, nenhuma auditoria)
    recusaConfig(`SELECT integracao_fdv.portal_carga_completa('${A.id}', 'estoque', 'r');`, 'MXI03', /o estado mudou; recarregue/);
    expect(um(`SELECT count(*)::int AS n FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' AND entidade = 'estoque'`)).toEqual({ n: 0 });
    // lote em voo depois da leitura
    const cred = ativa(A.id)!.id;
    expect(ler(A.id).cadastros.find((e) => e.entidade === 'produto')!.lote_em_voo).toBe(false);
    executar(
      banco.conexao,
      `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, corpo, estado)
       VALUES ('${A.id}', 'produto', '${cred}', 'delta', repeat('c', 64), '{}', 'montado');`,
    );
    recusaConfig(`SELECT integracao_fdv.portal_carga_completa('${A.id}', 'produto', 'r');`, 'MXI03', /o estado mudou; recarregue/);
    for (const e of ['titulo', 'nao_existe']) {
      recusaConfig(`SELECT integracao_fdv.portal_carga_completa('${A.id}', '${e}', 'r');`, '23514', /cadastro fora da F2/);
    }
    expect(nAuditoria(A.id)).toBe(n);
  });

  it('(k) retomar limpa a pausa, antecipa e audita com superadmin_id; sem pausa ou sem cursor = MXI03 sem auditoria; não exige habilitado', () => {
    // cliente está pausado por versao e não habilitado (a configuração atual é produto e filial)
    executar(banco.conexao, `UPDATE integracao_fdv.cursor_entidade SET proximo_em = now() + interval '1 day' WHERE tenant_id = '${A.id}' AND entidade = 'cliente';`);
    expect(jsonConfig(`SELECT integracao_fdv.portal_retomar('${A.id}', 'cliente', 'req-retomar');`)).toEqual({ retomada: true });
    expect(
      um(`SELECT pausada_motivo, pausada_em, proximo_em <= now() AS ja FROM integracao_fdv.cursor_entidade WHERE tenant_id = '${A.id}' AND entidade = 'cliente'`),
    ).toEqual({ pausada_motivo: null, pausada_em: null, ja: true });
    expect(um(`SELECT acao, superadmin_id, usuario_id, antes, depois FROM plataforma.auditoria WHERE request_id = 'req-retomar'`)).toEqual({
      acao: 'integracao-fdv.entidade.retomar',
      superadmin_id: SA,
      usuario_id: null,
      antes: { entidade: 'cliente', pausada_motivo: 'versao' },
      depois: { entidade: 'cliente', pausada_motivo: null },
    });
    const n = nAuditoria(A.id);
    recusaConfig(`SELECT integracao_fdv.portal_retomar('${A.id}', 'cliente', 'r');`, 'MXI03', /o estado mudou; recarregue/);
    recusaConfig(`SELECT integracao_fdv.portal_retomar('${A.id}', 'estoque', 'r');`, 'MXI03', /o estado mudou; recarregue/);
    recusaConfig(`SELECT integracao_fdv.portal_retomar('${A.id}', 'nota', 'r');`, '23514', /cadastro fora da F2/);
    expect(nAuditoria(A.id)).toBe(n);
  });

  it('(l) portal_ler: os 10 cadastros na ordem de carga com ligada, pausa, lote em voo, último envio, último lote e erros abertos; sem politica_versao', () => {
    const cred = ativa(A.id)!.id;
    executar(
      banco.conexao,
      `UPDATE integracao_fdv.sinal SET ultimo_http = 401, politica_versao = '{"minima":"v9"}' WHERE tenant_id = '${A.id}';
       UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'licenca_fdv', pausada_em = now() WHERE tenant_id = '${A.id}' AND entidade = 'filial';
       WITH l AS (
         INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, ultimo_erro_codigo, enviado_em, concluido_em, created_at)
         VALUES ('${A.id}', 'cliente', '${cred}', 'delta', repeat('d', 64), 'falhou', 'hub_fora', '2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z', '2026-11-01T09:59:00Z'),
                ('${A.id}', 'cliente', '${cred}', 'delta', repeat('e', 64), 'falhou', 'hub_fora', '2026-10-01T10:00:00Z', '2026-10-01T10:05:00Z', '2026-10-01T09:59:00Z')
         RETURNING id, chave_idempotencia)
       INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, codigo, resolvido_em)
       SELECT '${A.id}', l.id, i, 'erp', 'cliente', 'campo_invalido', CASE WHEN i = 2 THEN now() END
         FROM l CROSS JOIN generate_series(0, 2) i WHERE l.chave_idempotencia = repeat('d', 64);`,
    );
    const l = ler(A.id);
    expect(Object.keys(l).sort()).toEqual(CHAVES_TOPO);
    expect(Object.keys(l.credencial!).sort()).toEqual(CHAVES_CREDENCIAL);
    expect(l.credencial!.id).toBe(cred);
    expect(l.sinal).toEqual({ ultimo_envio_em: null, ultimo_aceito_em: null, ultimo_http: 401, parado_por_versao: false });
    expect(l.cadastros.map((x) => x.entidade)).toEqual(F2);
    for (const x of l.cadastros) expect(Object.keys(x).sort()).toEqual(CHAVES_CADASTRO);
    const por = Object.fromEntries(l.cadastros.map((x) => [x.entidade, x]));
    expect(por.filial).toEqual({ ...cadastroVazio('filial', true), pausada_motivo: 'licenca_fdv' });
    expect(por.produto).toMatchObject({ habilitada: true, ligada: true, lote_em_voo: true, ultimo_envio_em: null, ultimo_lote: { estado: 'montado', erro_codigo: null } });
    expect(por.cliente).toEqual({
      ...cadastroVazio('cliente', false),
      ultimo_envio_em: '2026-11-01T10:00:00.000Z',
      ultimo_lote: { estado: 'falhou', erro_codigo: 'hub_fora', em: '2026-11-01T10:05:00.000Z' },
      erros_abertos: 2,
    });
    expect(por.estoque).toEqual(cadastroVazio('estoque', false));
    expect(JSON.stringify(l)).not.toMatch(/politica_versao|chave_cifrada|chave_mestra|v9/);
  });

  it('(m) isolamento: nada muda no outro tenant; reexecutar a 0038 não muda dado nem privilégio', () => {
    const antesB = retrato(B.id);
    const antesA = retrato(A.id);
    ler(A.id);
    expect(retrato(B.id)).toEqual(antesB);
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    // a 0039 e a 0042 vêm depois da 0038 e voltam o estado final (MXI04; DEFAULT vazio e o configurar de 5 argumentos)
    rodarScript(banco.conexao, readFileSync(MIGRACAO_0039, 'utf8'), { transacao: true });
    rodarScript(banco.conexao, readFileSync(MIGRACAO_0042, 'utf8'), { transacao: true });
    expect(retrato(A.id)).toEqual(antesA);
    expect(retrato(B.id)).toEqual(antesB);
    expect(
      um(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'integracao_fdv' AND p.proname LIKE 'portal\\_%'`),
    ).toEqual({ n: PORTAL.length + INTERNAS.length + DA_0043.length + DA_0053.length + DA_0055.length });
    for (const f of PORTAL) {
      expect({ f, ok: um<{ ok: boolean }>(`SELECT has_function_privilege('${CONFIG}', '${f}'::regprocedure, 'EXECUTE') AS ok`).ok }).toEqual({ f, ok: true });
    }
  });
  it('(n) reexecutar a 0039 não muda dado nem privilégio; portal_empresa segue interna, SECURITY DEFINER, search_path fixo; MXI04 com o DETAIL certo', () => {
    const antes = [A.id, B.id, C.id, D.id].map(retrato);
    const privilegios = (): unknown =>
      consultar(
        banco.conexao,
        `SELECT p.proname, pg_get_userbyid(p.proowner) AS dono, p.prosecdef, p.proconfig, p.proacl::text AS acl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'integracao_fdv' AND p.proname LIKE 'portal\\_%' ORDER BY p.oid`,
      );
    const privAntes = privilegios();
    rodarScript(banco.conexao, readFileSync(MIGRACAO_0039, 'utf8'), { transacao: true });
    expect([A.id, B.id, C.id, D.id].map(retrato)).toEqual(antes);
    expect(privilegios()).toEqual(privAntes);
    // empresa suspensa E sem módulo: a empresa vem antes (ordem da 0038)
    for (const situacao of ['encerrado']) {
      executar(banco.conexao, `UPDATE plataforma.tenant SET situacao = '${situacao}' WHERE id = '${C.id}';`);
      recusaMxi04(definir(C.id, null), 'empresa_inativa');
    }
    // os demais seguem como na 0038: P0002 para inexistente; 23514 para fora da F2
    recusaConfig(`SELECT integracao_fdv.portal_testar('${randomUUID()}', 'r');`, 'P0002', /empresa não encontrada/);
    recusaConfig(`SELECT integracao_fdv.portal_carga_completa('${A.id}', 'nota', 'r');`, '23514', /cadastro fora da F2/);
    expect([nAuditoria(C.id), nAuditoria(D.id)]).toEqual([0, 0]);
  });
});
