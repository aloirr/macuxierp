/**
 * T-0057 (v0.3.11), migração 0045: entrada de dados do cenário B (ADR 0014 §3, §4, §8 e a emenda §13–15).
 * Cobre a §8: isolamento por tenant; entrada_autenticar sem tenant devolvendo só a própria credencial; o HMAC nunca no
 * portal_entrada_ler; a idempotência do lote (idempotency_key e hash_corpo); o corpo zerado no estado final; a sessão
 * incompleta que não inativa (MXE03); a trava de 30% (aguardando_confirmacao e portal_entrada_confirmar_inativacao);
 * a auditoria com superadmin_id, sem chave, HMAC nem prefixo; no máximo uma credencial ativa por tenant e tipo; os
 * privilégios (entrada_autenticar só do macuxierp_app; portal_entrada_* só do macuxierp_config). Mais o dono por
 * entidade (§14), a fila de descida (§13) e a expiração (LGPD).
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
import { verificarVazamento } from './vazamento.ts';

const MIGRACAO = fileURLToPath(new URL('../migrations/0045_cadastros_entrada_cenario_b.sql', import.meta.url));
const CONFIG = 'macuxierp_config';
const APP = 'macuxierp_app';
const WORKER = 'macuxierp_worker';
const REFERENCIA = '00000000-0000-0000-0000-000000000000';
const A = novoTenant('entrada-0045-a');
const B = novoTenant('entrada-0045-b');
/** Sem a licença do cadastros. */
const C = novoTenant('entrada-0045-c');
/** Suspensa. */
const D = novoTenant('entrada-0045-d');
const SA = '5a000000-0000-4000-8000-000000000451';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
/** ENTIDADES_ENVIO_FDV do SDK, na ordem (o teste do db não importa o SDK: trava a cópia aqui). */
const ENTIDADES = ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco',
  'estoque', 'cliente', 'cliente_endereco'];
/** HMACs fictícios (32 bytes, sem segredo) e prefixos. */
const HMAC_API = 'cd'.repeat(32);
const HMAC_TROCA = 'ef'.repeat(32);
const PREFIXO_API = 'ApiPre_1';
const PREFIXO_TROCA = 'Troca-02';

const PORTAL = [
  'cadastros.portal_entrada_ler(uuid)',
  'cadastros.portal_entrada_credencial_definir(uuid, text, uuid, text, bytea, text, text)',
  'cadastros.portal_entrada_confirmar_inativacao(uuid, uuid, text)',
  'cadastros.portal_entrada_dono_definir(uuid, text, text, text)',
] as const;
const DO_APP = ['cadastros.entrada_autenticar(text)'] as const;
const DO_WORKER = ['cadastros.entrada_lote_expirar()', 'cadastros.entrada_sessao_completa(uuid, uuid, integer)'] as const;
/** A lista dos CHECKs: EXECUTE do app e do worker, que gravam. */
const LISTA = 'cadastros.entrada_entidades()';
const INTERNAS = [
  LISTA,
  'cadastros.entrada_dono_principal(text)',
  'cadastros.entrada_portal_empresa(uuid, boolean)',
  'cadastros.entrada_portal_estado(uuid)',
  'cadastros.entrada_lote_antes()',
  'cadastros.entrada_descida_antes()',
] as const;
const TABELAS = ['entrada_credencial', 'entrada_lote', 'entrada_lote_erro', 'entrada_cursor', 'entrada_sinal',
  'entrada_dono', 'entrada_descida'].map((t) => `cadastros.${t}`);

interface Base {
  tipo: string;
  credencial: { id: string; conector_id: string; chave_prefixo: string } | null;
  sinal: { ultimo_sinal_em: string; versao: string | null } | null;
}
interface BaseEntidade {
  tipo: string;
  ultimo_lote: { id: string; estado: string } | null;
  erros_abertos: number;
  confirmacao_pendente: { lote_id: string; ativos_antes: number; inativacao_prevista: number } | null;
}
interface Estado {
  empresa_id: string;
  modulo_licenciado: boolean;
  faturamento_licenciado: boolean;
  bases: Base[];
  entidades: { entidade: string; dono: string; carga_completa_pedida_em: string | null; bases: BaseEntidade[] }[];
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — entrada do cenário B (T-0057, 0045)', () => {
  let banco: BancoDeTeste;
  let sessao: string;
  /** Credencial "via Conector" da massa de A (fixtureEntrada). */
  let credA: string;
  let credB: string;

  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const jsonConfig = <T>(sql: string): T => JSON.parse(comoConfig(sql)[0] ?? 'null') as T;
  const recusaConfig = (sql: string, codigo: string, padrao: RegExp, s: string | null = sessao): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: CONFIG });
  const recusaDetalhe = (sql: string, codigo: string, detalhe: string): void =>
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${sql}`, codigo, detalhe, { papel: CONFIG });
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const n = (de: string): number => um<{ n: number }>(`SELECT count(*)::int AS n FROM ${de}`).n;
  const ler = (t: string): Estado => jsonConfig<Estado>(`SELECT cadastros.portal_entrada_ler('${t}');`);
  const definirSql = (t: string, tipo: string, anterior: string | null, conector: string, hmac: string, prefixo: string,
    req = 'req-cred'): string =>
    `SELECT cadastros.portal_entrada_credencial_definir('${t}', '${tipo}', ${anterior === null ? 'NULL' : `'${anterior}'`},
       '${conector}', decode('${hmac}', 'hex'), '${prefixo}', '${req}');`;
  const confirmarSql = (t: string, lote: string): string =>
    `SELECT cadastros.portal_entrada_confirmar_inativacao('${t}', '${lote}', 'req-conf');`;
  const donoSql = (t: string, entidade: string, dono: string): string =>
    `SELECT cadastros.portal_entrada_dono_definir('${t}', '${entidade}', '${dono}', 'req-dono');`;
  const autenticar = (conector: string | null): { tenant_id: string; credencial_id: string; tipo: string; hmac: string }[] =>
    consultar(
      banco.conexao,
      `SELECT tenant_id, credencial_id, tipo, encode(chave_hmac, 'hex') AS hmac
         FROM cadastros.entrada_autenticar(${conector === null ? 'NULL' : `'${conector.replaceAll("'", "''")}'`})`,
      { papel: APP, tenant: null },
    );
  /** Lote novo de A como o app (POST /lotes): devolve o id. */
  const receber = (campos: { cred?: string; entidade?: string; chave?: string; hash?: string; sessao?: string;
    parte?: number; ultima?: boolean } = {}): string => {
    const completo = campos.sessao !== undefined;
    const out = linhas(rodarComo(
      banco.conexao,
      `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, corpo,
         registros, sessao_id, sessao_parte, sessao_ultima)
       VALUES ('${A.id}', '${campos.cred ?? credA}', '${campos.entidade ?? 'produto'}', '${completo ? 'completo' : 'delta'}',
         '${campos.chave ?? `chave-${randomUUID()}`}', '${campos.hash ?? 'a'.repeat(64)}', '{"registros": [{"x": 1}]}', 1,
         ${completo ? `'${campos.sessao}', ${campos.parte ?? 1}, ${campos.ultima ?? true}` : 'NULL, NULL, NULL'})
       RETURNING id;`,
      { papel: APP, tenant: A.id },
    ));
    return out.find((l) => /^[0-9a-f-]{36}$/.test(l)) as string;
  };
  const comoWorker = (sql: string): void => executar(banco.conexao, sql, { papel: WORKER, tenant: A.id });
  const recusaWorker = (sql: string, codigo: string, padrao: RegExp): void =>
    recusaDetalhada(banco.conexao, sql, codigo, padrao, { papel: WORKER, tenant: A.id });
  const concluir = (lote: string): void =>
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'concluido', corpo = NULL, concluido_em = now() WHERE id = '${lote}';`);
  const lote = (id: string): Record<string, unknown> =>
    um(`SELECT estado, corpo, erro_codigo, confirmada_em IS NOT NULL AS confirmada, confirmada_por, inativados
          FROM cadastros.entrada_lote WHERE id = '${id}'`);

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      `${fixturePlataforma(A)}${fixtureModulos(A)}${fixturePlataforma(B)}${fixtureModulos(B)}
${fixturePlataforma(C)}${fixturePlataforma(D)}
UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = '${C.id}' AND modulo = 'cadastros';
UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${D.id}';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0045@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    credA = um<{ id: string }>(`SELECT id FROM cadastros.entrada_credencial WHERE tenant_id = '${A.id}'`).id;
    credB = um<{ id: string }>(`SELECT id FROM cadastros.entrada_credencial WHERE tenant_id = '${B.id}'`).id;
  });

  afterAll(() => banco?.remover());

  it('(a) privilégios: autenticar só do app, portal_entrada_* só do config, worker só nas dele; tabelas sem DELETE nem config', () => {
    for (const f of [...PORTAL, ...DO_APP, ...DO_WORKER, ...INTERNAS]) {
      const r = um<Record<string, unknown>>(
        `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
           obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
           EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
           has_function_privilege('${APP}', p.oid, 'EXECUTE') AS app,
           has_function_privilege('${WORKER}', p.oid, 'EXECUTE') AS worker,
           has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
           has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
         FROM pg_proc p WHERE p.oid = '${f}'::regprocedure`,
      );
      const invoker = f.endsWith('_antes()') || f.startsWith('cadastros.entrada_sessao_completa');
      expect({ f, ...r }).toEqual({
        f,
        definer: !invoker,
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        app: (DO_APP as readonly string[]).includes(f) || f === LISTA,
        worker: (DO_WORKER as readonly string[]).includes(f) || f === LISTA,
        leitura: false,
        config: (PORTAL as readonly string[]).includes(f),
      });
    }
    for (const t of TABELAS) {
      expect({ t, p: privilegiosDe(banco.conexao, CONFIG, t) }).toEqual({ t, p: '-' });
      for (const papel of [APP, WORKER, 'macuxierp_leitura']) {
        expect({ t, papel, del: um(`SELECT has_table_privilege('${papel}', '${t}', 'DELETE') AS d`) }).toEqual({ t, papel, del: { d: false } });
      }
      expect({ t, rls: um(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = '${t}'::regclass`) }).toEqual({ t, rls: { r: true } });
      // regra 5
      const cols = consultar<{ c: string }>(banco.conexao,
        `SELECT attname AS c FROM pg_attribute WHERE attrelid = '${t}'::regclass AND attnum > 0 AND NOT attisdropped`).map((x) => x.c);
      expect({ t, faltam: ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'external_id'].filter((c) => !cols.includes(c)) })
        .toEqual({ t, faltam: [] });
    }
    // o HMAC, o corpo, os vistos e o payload ficam fora de quem não precisa
    const col = (papel: string, t: string, c: string): boolean =>
      um<{ p: boolean }>(`SELECT has_column_privilege('${papel}', '${t}', '${c}', 'SELECT') AS p`).p;
    for (const papel of [APP, WORKER, 'macuxierp_leitura']) expect({ papel, hmac: col(papel, 'cadastros.entrada_credencial', 'chave_hmac') }).toEqual({ papel, hmac: false });
    for (const papel of [APP, 'macuxierp_leitura']) {
      expect({ papel, corpo: col(papel, 'cadastros.entrada_lote', 'corpo'), vistos: col(papel, 'cadastros.entrada_lote', 'vistos') })
        .toEqual({ papel, corpo: false, vistos: false });
    }
    expect(col('macuxierp_leitura', 'cadastros.entrada_descida', 'payload')).toBe(false);
    recusaDetalhada(banco.conexao, `SELECT chave_hmac FROM cadastros.entrada_credencial;`, '42501', /permission denied/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `SELECT corpo FROM cadastros.entrada_lote;`, '42501', /permission denied/, { papel: APP, tenant: A.id });
    // a credencial só muda pelo portal: o app só toca ultimo_uso_em
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_credencial SET substituida_em = now();`, '42501', /permission denied/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_credencial (tenant_id, tipo, conector_id, chave_hmac, chave_prefixo)
      VALUES ('${A.id}', 'api', 'x-app', decode('${HMAC_API}', 'hex'), '${PREFIXO_API}');`, '42501', /permission denied/, { papel: APP, tenant: A.id });
    executar(banco.conexao, `UPDATE cadastros.entrada_credencial SET ultimo_uso_em = now() WHERE id = '${credA}';`, { papel: APP, tenant: A.id });
    // os outros papéis não chamam o que não é deles
    for (const papel of [WORKER, 'macuxierp_leitura']) {
      recusaDetalhada(banco.conexao, `SELECT * FROM cadastros.entrada_autenticar('conector-${A.slug}');`, '42501', /permission denied/, { papel });
    }
    recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}SELECT * FROM cadastros.entrada_autenticar('conector-${A.slug}');`, '42501', /permission denied/, { papel: CONFIG });
    for (const papel of [APP, WORKER, 'macuxierp_leitura']) {
      recusaDetalhada(banco.conexao, `SELECT cadastros.portal_entrada_ler('${A.id}');`, '42501', /permission denied/, { papel, tenant: A.id });
    }
    expect(um(`SELECT cadastros.entrada_entidades() AS e`)).toEqual({ e: ENTIDADES });
  });

  it('(b) isolamento: nenhuma tabela da entrada vaza entre tenants, para nenhum papel', () => {
    expect(verificarVazamento(banco.conexao, ['cadastros'], A.id, B.id)).toEqual([]);
    expect(n(`cadastros.entrada_lote`)).toBeGreaterThanOrEqual(2);
    expect(consultar(banco.conexao, `SELECT DISTINCT tenant_id FROM cadastros.entrada_lote`, { papel: APP, tenant: A.id }))
      .toEqual([{ tenant_id: A.id }]);
  });

  it('(c) entrada_autenticar sem tenant devolve só a credencial ativa do próprio conector_id; formato inválido = nada', () => {
    expect(autenticar(`conector-${A.slug}`)).toEqual([{ tenant_id: A.id, credencial_id: credA, tipo: 'conector', hmac: 'ab'.repeat(32) }]);
    expect(autenticar(`conector-${B.slug}`)).toEqual([{ tenant_id: B.id, credencial_id: credB, tipo: 'conector', hmac: 'ab'.repeat(32) }]);
    for (const c of ['inexistente', "x' OR '1'='1", 'a'.repeat(101), '', null]) expect({ c, r: autenticar(c) }).toEqual({ c, r: [] });
    // só as quatro colunas
    expect(consultar<{ c: string }>(banco.conexao,
      `SELECT unnest(proargnames) AS c FROM pg_proc WHERE oid = 'cadastros.entrada_autenticar(text)'::regprocedure`).map((x) => x.c))
      .toEqual(['p_conector_id', 'tenant_id', 'credencial_id', 'tipo', 'chave_hmac']);
  });

  it('(d) portal_entrada_ler: MXS01 sem sessão, P0002 fora das visíveis; sem HMAC nem corpo; 2 bases e 10 cadastros', () => {
    recusaConfig(`SELECT cadastros.portal_entrada_ler('${A.id}');`, 'MXS01', /sessão de superadmin inválida/, null);
    for (const t of [REFERENCIA, randomUUID()]) recusaConfig(`SELECT cadastros.portal_entrada_ler('${t}');`, 'P0002', /empresa não encontrada/);
    const bruto = comoConfig(`SELECT cadastros.portal_entrada_ler('${A.id}');`)[0] as string;
    expect(bruto).not.toMatch(/hmac|abababab|corpo|vistos|203\.0\.113|CLI-1|registros/i);
    const e = JSON.parse(bruto) as Estado;
    expect(e.empresa_id).toBe(A.id);
    expect(e.modulo_licenciado).toBe(true);
    expect(e.faturamento_licenciado).toBe(false);
    expect(e.bases.map((b) => [b.tipo, b.credencial?.conector_id ?? null, b.credencial?.chave_prefixo ?? null])).toEqual([
      ['conector', `conector-${A.slug}`, 'AbCd_-12'], ['api', null, null]]);
    expect(e.bases[0]?.sinal?.versao).toBe('1.5.0');
    expect(e.entidades.map((x) => x.entidade)).toEqual(ENTIDADES);
    expect(e.entidades.every((x) => x.dono === 'erp' && x.bases.map((b) => b.tipo).join() === 'conector,api')).toBe(true);
    const cliente = e.entidades.find((x) => x.entidade === 'cliente');
    expect(cliente?.bases[0]?.ultimo_lote?.estado).toBe('recebido');
    // a leitura do C (sem licença) e do D (suspensa) vale; sem auditoria
    expect(ler(C.id).modulo_licenciado).toBe(false);
    expect(ler(D.id).empresa_id).toBe(D.id);
    expect(n(`plataforma.auditoria WHERE acao LIKE 'cadastros.entrada.%'`)).toBe(0);
  });

  it('(e) credencial: criar e trocar; uma ativa por tenant e tipo; conector_id único; formatos; MXC04; a troca invalida a anterior na hora', () => {
    const criada = jsonConfig<{ id: string; tipo: string; conector_id: string; chave_prefixo: string }>(
      definirSql(A.id, 'api', null, `api-${A.slug}`, HMAC_API, PREFIXO_API));
    expect(criada).toMatchObject({ tipo: 'api', conector_id: `api-${A.slug}`, chave_prefixo: PREFIXO_API });
    expect(JSON.stringify(criada)).not.toMatch(/hmac|cdcdcd/i);
    // a tela leu "sem credencial", mas já há uma: MXE01; anterior errado também
    recusaDetalhe(definirSql(A.id, 'api', null, `api-${A.slug}`, HMAC_TROCA, PREFIXO_TROCA), 'MXE01', 'credencial_mudou');
    recusaDetalhe(definirSql(A.id, 'api', randomUUID(), `api-${A.slug}`, HMAC_TROCA, PREFIXO_TROCA), 'MXE01', 'credencial_mudou');
    // conector_id de outra empresa ou ativo na outra base: MXE02
    recusaDetalhe(definirSql(A.id, 'api', criada.id, `conector-${B.slug}`, HMAC_TROCA, PREFIXO_TROCA), 'MXE02', 'conector_id_em_uso');
    recusaDetalhe(definirSql(A.id, 'api', criada.id, `conector-${A.slug}`, HMAC_TROCA, PREFIXO_TROCA), 'MXE02', 'conector_id_em_uso');
    // formatos
    for (const sql of [
      definirSql(A.id, 'outro', criada.id, `api-${A.slug}`, HMAC_TROCA, PREFIXO_TROCA),
      definirSql(A.id, 'api', criada.id, 'com espaço', HMAC_TROCA, PREFIXO_TROCA),
      definirSql(A.id, 'api', criada.id, 'x'.repeat(101), HMAC_TROCA, PREFIXO_TROCA),
      definirSql(A.id, 'api', criada.id, `api-${A.slug}`, 'ef'.repeat(31), PREFIXO_TROCA),
      definirSql(A.id, 'api', criada.id, `api-${A.slug}`, HMAC_TROCA, 'curto'),
    ]) recusaConfig(sql, '23514', /.+/);
    recusaDetalhe(definirSql(C.id, 'api', null, `api-${C.slug}`, HMAC_API, PREFIXO_API), 'MXC04', 'modulo_desligado');
    recusaDetalhe(definirSql(D.id, 'api', null, `api-${D.slug}`, HMAC_API, PREFIXO_API), 'MXC04', 'empresa_inativa');
    recusaConfig(definirSql(A.id, 'api', criada.id, `api-${A.slug}`, HMAC_TROCA, PREFIXO_TROCA), 'MXS01', /sessão/, null);
    // a troca: a anterior deixa de autenticar na hora
    expect(autenticar(`api-${A.slug}`)).toEqual([{ tenant_id: A.id, credencial_id: criada.id, tipo: 'api', hmac: HMAC_API }]);
    const trocada = jsonConfig<{ id: string }>(definirSql(A.id, 'api', criada.id, `api-${A.slug}`, HMAC_TROCA, PREFIXO_TROCA, 'req-troca'));
    expect(autenticar(`api-${A.slug}`)).toEqual([{ tenant_id: A.id, credencial_id: trocada.id, tipo: 'api', hmac: HMAC_TROCA }]);
    expect(um(`SELECT substituida_em IS NOT NULL AS s FROM cadastros.entrada_credencial WHERE id = '${criada.id}'`)).toEqual({ s: true });
    expect(n(`cadastros.entrada_credencial WHERE tenant_id = '${A.id}' AND tipo = 'api' AND substituida_em IS NULL`)).toBe(1);
    // o conector_id que A usou não vai para B, nem depois de trocado
    recusaDetalhe(definirSql(B.id, 'api', null, `api-${A.slug}`, HMAC_API, PREFIXO_API), 'MXE02', 'conector_id_em_uso');
    // o índice segura a segunda ativa mesmo fora da função
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_credencial (tenant_id, tipo, conector_id, chave_hmac, chave_prefixo)
      VALUES ('${A.id}', 'api', 'outra-${A.slug}', decode('${HMAC_API}', 'hex'), '${PREFIXO_API}');`, '23505', /entrada_credencial_ativa_uq/);
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_credencial (tenant_id, tipo, conector_id, chave_hmac, chave_prefixo)
      VALUES ('${C.id}', 'api', 'api-${A.slug}', decode('${HMAC_API}', 'hex'), '${PREFIXO_API}');`, '23505', /entrada_credencial_conector_uq/);
    expect(ler(A.id).bases[1]?.credencial).toMatchObject({ id: trocada.id, chave_prefixo: PREFIXO_TROCA });
  });

  it('(f) idempotência: a mesma Idempotency-Key acha o mesmo lote e o hash_corpo; outra credencial ou tenant não colide', () => {
    const chave = `idem-${randomUUID()}`;
    const id = receber({ chave, hash: 'b'.repeat(64) });
    const repetido = linhas(rodarComo(banco.conexao,
      `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, corpo, registros)
       VALUES ('${A.id}', '${credA}', 'produto', 'delta', '${chave}', '${'c'.repeat(64)}', '{}', 0)
       ON CONFLICT (tenant_id, credencial_id, idempotency_key) DO NOTHING RETURNING id;`, { papel: APP, tenant: A.id }));
    expect(repetido.some((l) => /^[0-9a-f-]{36}$/.test(l))).toBe(false);
    expect(consultar(banco.conexao, `SELECT id, hash_corpo FROM cadastros.entrada_lote WHERE credencial_id = '${credA}' AND idempotency_key = '${chave}'`,
      { papel: APP, tenant: A.id })).toEqual([{ id, hash_corpo: 'b'.repeat(64) }]);
    recusaDetalhada(banco.conexao,
      `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros)
       VALUES ('${A.id}', '${credA}', 'produto', 'delta', '${chave}', '${'c'.repeat(64)}', 0);`, '23505', /entrada_lote_idempotencia_uq/,
      { papel: APP, tenant: A.id });
    // B usa a mesma chave sem colidir
    executar(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros)
       VALUES ('${B.id}', '${credB}', 'produto', 'delta', '${chave}', '${'c'.repeat(64)}', 0);`, { papel: APP, tenant: B.id });
    // a chave: 8 a 128 caracteres visíveis
    for (const k of ['curta', 'com espaço no meio', 'x'.repeat(129)]) {
      recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros)
        VALUES ('${A.id}', '${credA}', 'produto', 'delta', '${k}', '${'c'.repeat(64)}', 0);`, '23514', /idempotency_key/, { papel: APP, tenant: A.id });
    }
    // o lote nasce recebido; entidade fora da F2 não entra; o app não grava a credencial de B
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros)
       VALUES ('${A.id}', '${credA}', 'titulo', 'delta', 'chave-titulo-1', '${'c'.repeat(64)}', 0);`, '23514', /entidade/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros)
       VALUES ('${A.id}', '${credB}', 'produto', 'delta', 'chave-cred-b', '${'c'.repeat(64)}', 0);`, '23503', /entrada_lote_credencial_fk/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key, hash_corpo, registros, estado)
       VALUES ('${A.id}', '${credA}', 'produto', 'delta', 'chave-estado', '${'c'.repeat(64)}', 0, 'concluido');`, '42501', /permission denied/, { papel: APP, tenant: A.id });
  });

  it('(g) corpo zerado no estado final, só anula; estado final não muda; identidade imutável; expirar zera em 24 h', () => {
    const id = receber();
    recusaWorker(`UPDATE cadastros.entrada_lote SET estado = 'concluido', concluido_em = now() WHERE id = '${id}';`, '23514', /entrada_lote_corpo_final/);
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'processando', iniciado_em = now() WHERE id = '${id}';`);
    recusaWorker(`UPDATE cadastros.entrada_lote SET corpo = '{"outro": 1}' WHERE id = '${id}';`, '42501', /só é zerado/);
    concluir(id);
    expect(lote(id)).toMatchObject({ estado: 'concluido', corpo: null });
    recusaWorker(`UPDATE cadastros.entrada_lote SET corpo = '{"x": 1}' WHERE id = '${id}';`, '42501', /só é zerado/);
    recusaWorker(`UPDATE cadastros.entrada_lote SET estado = 'processando', concluido_em = NULL WHERE id = '${id}';`, '23514', /estado final/);
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_lote SET hash_corpo = '${'e'.repeat(64)}' WHERE id = '${id}';`, '42501', /imutável/);
    // erros por linha: só inserção
    comoWorker(`INSERT INTO cadastros.entrada_lote_erro (tenant_id, lote_id, indice, registro_external_id, campo, codigo)
      VALUES ('${A.id}', '${id}', 3, 'P-3', 'ncm', 'formato_invalido');`);
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_lote_erro SET codigo = 'outro' WHERE lote_id = '${id}';`, '42501', /.+/);
    // expiração: corpo com 24 h ou mais (recebido ou processando vira falhou; final só zera)
    const velho = linhas(rodarScript(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo,
      idempotency_key, hash_corpo, corpo, registros, recebido_em) VALUES ('${A.id}', '${credA}', 'produto', 'delta', 'chave-velha-1',
      '${'a'.repeat(64)}', '{"registros": []}', 0, now() - interval '25 hours') RETURNING id;`)).find((l) => /^[0-9a-f-]{36}$/.test(l)) as string;
    const novo = receber();
    const r = JSON.parse(linhas(rodarComo(banco.conexao, 'SELECT cadastros.entrada_lote_expirar();', { papel: WORKER }))[0] as string) as Record<string, number>;
    expect(r).toMatchObject({ falhos: 1 });
    expect(lote(velho)).toMatchObject({ estado: 'falhou', corpo: null, erro_codigo: 'corpo_expirado' });
    expect(lote(novo)).toMatchObject({ estado: 'recebido', corpo: { registros: [{ x: 1 }] } });
  });

  it('(h) sessão incompleta não inativa (MXE03); a sessão tem uma entidade e uma credencial; nada depois da última', () => {
    const s = randomUUID();
    const p1 = receber({ sessao: s, parte: 1, ultima: false, entidade: 'vendedor' });
    const p2 = receber({ sessao: s, parte: 2, ultima: false, entidade: 'vendedor' });
    const p3 = receber({ sessao: s, parte: 3, ultima: true, entidade: 'vendedor' });
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key,
      hash_corpo, registros, sessao_id, sessao_parte, sessao_ultima) VALUES ('${A.id}', '${credA}', 'vendedor', 'completo',
      'chave-depois-ultima', '${'a'.repeat(64)}', 0, '${s}', 4, false);`, '23514', /depois da última/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, entidade, modo, idempotency_key,
      hash_corpo, registros, sessao_id, sessao_parte, sessao_ultima) VALUES ('${A.id}', '${credA}', 'filial', 'completo',
      'chave-outra-entidade', '${'a'.repeat(64)}', 0, '${s}', 2, false);`, '23514', /outra entidade/, { papel: APP, tenant: A.id });
    concluir(p1);
    // a parte 2 não terminou: a última não inativa nem trava
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'processando' WHERE id = '${p3}';`);
    recusaComDetalhe(banco.conexao, `UPDATE cadastros.entrada_lote SET inativados = 0, ativos_antes = 10 WHERE id = '${p3}';`,
      'MXE03', 'sessao_incompleta', { papel: WORKER, tenant: A.id });
    recusaComDetalhe(banco.conexao, `UPDATE cadastros.entrada_lote SET estado = 'aguardando_confirmacao', ativos_antes = 10,
      inativacao_prevista = 5, aguardando_desde = now() WHERE id = '${p3}';`, 'MXE03', 'sessao_incompleta', { papel: WORKER, tenant: A.id });
    expect(um(`SELECT cadastros.entrada_sessao_completa('${credA}', '${s}', 3) AS c`)).toEqual({ c: false });
    // parte que falhou também deixa a sessão incompleta
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'falhou', corpo = NULL, concluido_em = now(), erro_codigo = 'falha_teste' WHERE id = '${p2}';`);
    expect(consultar(banco.conexao, `SELECT cadastros.entrada_sessao_completa('${credA}', '${s}', 3) AS c`, { papel: WORKER, tenant: A.id })).toEqual([{ c: false }]);
    // o delta nunca inativa
    const d = receber();
    recusaWorker(`UPDATE cadastros.entrada_lote SET inativados = 1, ativos_antes = 10 WHERE id = '${d}';`, '23514', /entrada_lote_inativados/);
    // sessão completa: inativa dentro do limite
    const s2 = randomUUID();
    concluir(receber({ sessao: s2, parte: 1, ultima: false }));
    const u = receber({ sessao: s2, parte: 2, ultima: true });
    expect(consultar(banco.conexao, `SELECT cadastros.entrada_sessao_completa('${credA}', '${s2}', 2) AS c`, { papel: WORKER, tenant: A.id })).toEqual([{ c: true }]);
    comoWorker(`UPDATE cadastros.entrada_lote SET inativados = 3, ativos_antes = 10, estado = 'concluido', corpo = NULL, concluido_em = now() WHERE id = '${u}';`);
    expect(lote(u)).toMatchObject({ estado: 'concluido', inativados: 3 });
  });

  it('(i) trava de 30%: acima do limite só com a confirmação do superadmin (7 dias), que volta o lote para o worker', () => {
    const s = randomUUID();
    const u = receber({ sessao: s, parte: 1, ultima: true, entidade: 'cliente' });
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'processando' WHERE id = '${u}';`);
    // 4 de 10 = 40% > 30% sem confirmação: o CHECK recusa
    recusaWorker(`UPDATE cadastros.entrada_lote SET inativados = 4, ativos_antes = 10 WHERE id = '${u}';`, '23514', /entrada_lote_trava/);
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'aguardando_confirmacao', ativos_antes = 10, inativacao_prevista = 4,
      aguardando_desde = now(), corpo = NULL WHERE id = '${u}';`);
    // o worker não sai de aguardando sem a confirmação
    recusaWorker(`UPDATE cadastros.entrada_lote SET estado = 'processando' WHERE id = '${u}';`, '23514', /só com a confirmação/);
    const pend = ler(A.id).entidades.find((x) => x.entidade === 'cliente')?.bases[0]?.confirmacao_pendente;
    expect(pend).toMatchObject({ lote_id: u, ativos_antes: 10, inativacao_prevista: 4 });
    // fora da empresa, sem sessão, empresa sem licença
    recusaConfig(confirmarSql(B.id, u), 'P0002', /lote não encontrado/);
    recusaConfig(confirmarSql(A.id, u), 'MXS01', /sessão/, null);
    recusaDetalhe(confirmarSql(C.id, u), 'MXC04', 'modulo_desligado');
    const r = jsonConfig<{ lote_id: string; estado: string; trabalho_id: string }>(confirmarSql(A.id, u));
    expect(r).toMatchObject({ lote_id: u, estado: 'processando' });
    expect(lote(u)).toMatchObject({ estado: 'processando', confirmada: true, confirmada_por: SA });
    expect(um(`SELECT tipo, payload FROM plataforma.trabalho WHERE id = '${r.trabalho_id}'`)).toEqual({
      tipo: 'cadastros.entrada_lote', payload: { lote_id: u, etapa: 'inativar' } });
    recusaDetalhe(confirmarSql(A.id, u), 'MXE04', 'sem_confirmacao_pendente');
    // confirmado, o worker inativa acima do limite
    comoWorker(`UPDATE cadastros.entrada_lote SET inativados = 4, estado = 'concluido', concluido_em = now() WHERE id = '${u}';`);
    expect(lote(u)).toMatchObject({ estado: 'concluido', inativados: 4 });
    // confirmação com 7 dias ou mais: expirada; o expirar fecha o lote
    const s2 = randomUUID();
    const v = receber({ sessao: s2, parte: 1, ultima: true, entidade: 'cliente' });
    comoWorker(`UPDATE cadastros.entrada_lote SET estado = 'aguardando_confirmacao', ativos_antes = 10, inativacao_prevista = 9,
      aguardando_desde = now() - interval '8 days', corpo = NULL WHERE id = '${v}';`);
    recusaDetalhe(confirmarSql(A.id, v), 'MXE04', 'confirmacao_expirada');
    executar(banco.conexao, 'SELECT cadastros.entrada_lote_expirar();', { papel: WORKER });
    expect(lote(v)).toMatchObject({ estado: 'concluido_com_erros', erro_codigo: 'confirmacao_expirada', confirmada: false });
  });

  it('(j) dono por entidade: o par anda junto; dependente = MXE05; erp -> cliente pede a carga completa; sem mudança, sem auditoria', () => {
    const r = jsonConfig<{ entidades: string[]; carga_completa_pedida_em: string | null }>(donoSql(A.id, 'cliente', 'cliente'));
    expect(r.entidades).toEqual(['cliente', 'cliente_endereco']);
    expect(r.carga_completa_pedida_em).not.toBeNull();
    expect(consultar(banco.conexao, `SELECT entidade, dono, carga_completa_pedida_em IS NOT NULL AS pedida FROM cadastros.entrada_dono
      ORDER BY entidade`, { papel: APP, tenant: A.id })).toEqual([
      { entidade: 'cliente', dono: 'cliente', pedida: true }, { entidade: 'cliente_endereco', dono: 'cliente', pedida: true }]);
    recusaDetalhe(donoSql(A.id, 'cliente_endereco', 'erp'), 'MXE05', 'entidade_dependente');
    recusaDetalhe(donoSql(A.id, 'produto_unidade', 'cliente'), 'MXE05', 'entidade_dependente');
    recusaConfig(donoSql(A.id, 'titulo', 'cliente'), '23514', /F2/);
    recusaConfig(donoSql(A.id, 'cliente', 'outro'), '23514', /dono/);
    recusaDetalhe(donoSql(D.id, 'cliente', 'cliente'), 'MXC04', 'empresa_inativa');
    const antes = n(`plataforma.auditoria WHERE tenant_id = '${A.id}' AND acao = 'cadastros.entrada.dono.alterar'`);
    jsonConfig(donoSql(A.id, 'cliente', 'cliente'));
    expect(n(`plataforma.auditoria WHERE tenant_id = '${A.id}' AND acao = 'cadastros.entrada.dono.alterar'`)).toBe(antes);
    jsonConfig(donoSql(A.id, 'produto', 'cliente'));
    jsonConfig(donoSql(A.id, 'cliente', 'erp'));
    const e = ler(A.id).entidades;
    expect(e.filter((x) => x.dono === 'cliente').map((x) => x.entidade)).toEqual(['produto', 'produto_unidade']);
    expect(e.find((x) => x.entidade === 'cliente')?.carga_completa_pedida_em).toBeNull();
    // o worker só anula a marca da carga completa
    executar(banco.conexao, `UPDATE cadastros.entrada_dono SET carga_completa_pedida_em = NULL WHERE entidade = 'produto';`, { papel: WORKER, tenant: A.id });
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_dono SET dono = 'erp';`, '42501', /permission denied/, { papel: WORKER, tenant: A.id });
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_dono SET dono = 'erp';`, '42501', /permission denied/, { papel: APP, tenant: A.id });
  });

  it('(k) auditoria: superadmin_id, sem usuário, sem chave, HMAC nem prefixo, com os nomes canônicos', () => {
    const aud = consultar<{ acao: string; superadmin_id: string; usuario_id: string | null; texto: string }>(banco.conexao,
      `SELECT acao, superadmin_id, usuario_id, coalesce(antes::text, '') || coalesce(depois::text, '') AS texto
         FROM plataforma.auditoria WHERE acao LIKE 'cadastros.entrada.%' ORDER BY ocorrido_em, acao`);
    expect(new Set(aud.map((a) => a.acao))).toEqual(new Set(['cadastros.entrada.credencial.criar', 'cadastros.entrada.credencial.trocar',
      'cadastros.entrada.inativacao.confirmar', 'cadastros.entrada.dono.alterar']));
    for (const a of aud) {
      expect({ acao: a.acao, sa: a.superadmin_id, u: a.usuario_id }).toEqual({ acao: a.acao, sa: SA, u: null });
      const proibido = new RegExp(`hmac|chave|prefixo|${HMAC_API.slice(0, 16)}|${HMAC_TROCA.slice(0, 16)}|${PREFIXO_API}|${PREFIXO_TROCA}|AbCd_-12`, 'i');
      expect({ acao: a.acao, vazou: proibido.test(a.texto) }).toEqual({ acao: a.acao, vazou: false });
    }
    expect(n(`plataforma.auditoria WHERE acao LIKE 'cadastros.entrada.%' AND tenant_id <> '${A.id}'`)).toBe(0);
  });

  it('(l) fila de descida: idempotente por tipo e referência; payload só até confirmado; confirmado é final', () => {
    const ref = randomUUID();
    const inserir = `INSERT INTO cadastros.entrada_descida (tenant_id, tipo, referencia, payload)
      VALUES ('${A.id}', 'cliente', '${ref}', '{"cliente_uuid": "${ref}"}') ON CONFLICT (tenant_id, tipo, referencia) DO NOTHING;`;
    executar(banco.conexao, inserir, { papel: WORKER, tenant: A.id });
    executar(banco.conexao, inserir, { papel: APP, tenant: A.id });
    expect(n(`cadastros.entrada_descida WHERE referencia = '${ref}'`)).toBe(1);
    for (const [tipo, r] of [['pedido', 'nao-uuid'], ['nota', '123'], ['nota', randomUUID()], ['titulo', randomUUID()]] as const) {
      recusaDetalhada(banco.conexao, `INSERT INTO cadastros.entrada_descida (tenant_id, tipo, referencia, payload)
        VALUES ('${A.id}', '${tipo}', '${r}', '{}');`, '23514', /.+/, { papel: APP, tenant: A.id });
    }
    executar(banco.conexao, `INSERT INTO cadastros.entrada_descida (tenant_id, tipo, referencia, payload)
      VALUES ('${A.id}', 'nota', '${'1'.repeat(44)}', '{"numero": 1}');`, { papel: APP, tenant: A.id });
    const upd = (sql: string): void => executar(banco.conexao, sql, { papel: APP, tenant: A.id });
    upd(`UPDATE cadastros.entrada_descida SET estado = 'entregue', entregas = entregas + 1, ultima_entrega_em = now() WHERE referencia = '${ref}';`);
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_descida SET estado = 'confirmado', confirmado_em = now() WHERE referencia = '${ref}';`,
      '23514', /entrada_descida_payload/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_descida SET payload = '{"outro": 1}' WHERE referencia = '${ref}';`,
      '42501', /só é zerado/, { papel: APP, tenant: A.id });
    upd(`UPDATE cadastros.entrada_descida SET estado = 'confirmado', confirmado_em = now(), payload = NULL, retorno_codigo = 'gravado' WHERE referencia = '${ref}';`);
    recusaDetalhada(banco.conexao, `UPDATE cadastros.entrada_descida SET estado = 'pendente', confirmado_em = NULL WHERE referencia = '${ref}';`,
      '23514', /confirmada não muda/, { papel: APP, tenant: A.id });
    recusaDetalhada(banco.conexao, `SELECT payload FROM cadastros.entrada_descida;`, '42501', /permission denied/, { papel: 'macuxierp_leitura', tenant: A.id });
  });

  it('(m) reexecução: a 0045 roda de novo sem mudar nada', () => {
    const antes = consultar(banco.conexao, `SELECT to_jsonb(c) AS l FROM cadastros.entrada_credencial c ORDER BY id`);
    rodarScript(banco.conexao, readFileSync(MIGRACAO, 'utf8'), { transacao: true });
    expect(consultar(banco.conexao, `SELECT to_jsonb(c) AS l FROM cadastros.entrada_credencial c ORDER BY id`)).toEqual(antes);
    expect(autenticar(`conector-${A.slug}`)).toHaveLength(1);
  });
});
