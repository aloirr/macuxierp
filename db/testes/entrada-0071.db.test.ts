/**
 * T-0057 (B1), migração 0071: entrada de dados do banco do cliente no ERP (/entrada/v1; ADR 0014 §4 e §8, no corte das
 * decisões 33 B e 34 B de 26/11: só o delta, sem carga completa e sem a trava de 30%), com os nomes do contrato E1
 * (packages/platform-sdk/src/entrada.ts, PR #747). Tabelas cadastros.entrada_* (regra 5, RLS por tenant, GRANTs
 * mínimos), a cadastros.entrada_autenticar (SECURITY DEFINER, só do macuxierp_app, sem tenant) e as do portal /config
 * (cadastros.portal_entrada_ler | _credencial_definir | _credencial_revogar, só do macuxierp_config, com sessão de
 * superadmin, MXS01/P0002, MXC04 da empresa e 23514 de formato). O segredo nunca fica em claro: o banco guarda só o HMAC-SHA256(pepper, chave)
 * calculado pela API; a auditoria e o portal_ler nunca levam o HMAC, e a auditoria nem o prefixo.
 */
import { randomUUID } from 'node:crypto';
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
  privilegiosDe,
  recusaComDetalhe,
  recusaDetalhada,
  rodarComo,
  sessaoSql,
} from './apoio.ts';
import { fixtureModulos, fixturePlataforma, novoTenant } from './fixture.ts';

const CONFIG = 'macuxierp_config';
const A = novoTenant('entrada-0071-a');
const B = novoTenant('entrada-0071-b');
/** Sem a licença do cadastros. */
const C = novoTenant('entrada-0071-c');
/** Suspensa. */
const D = novoTenant('entrada-0071-d');
/** Excluída. */
const E = novoTenant('entrada-0071-e');
const SA = '5a000000-0000-4000-8000-000000000711';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
/** HMAC fictício (32 bytes) e o hex dele, que nunca pode aparecer em auditoria nem no portal_ler. */
const HMAC_HEX = 'cd'.repeat(32);
const HMAC = `decode('${HMAC_HEX}', 'hex')`;
/** PREFIXO_CHAVE_ENTRADA_TAMANHO = 8. */
const PREFIXO = 'mxe_0071';
const CONECTOR_A = 'entrada-entrada-0071-a';
const TABELAS = ['cadastros.entrada_credencial', 'cadastros.entrada_lote', 'cadastros.entrada_cursor', 'cadastros.entrada_sinal'];

const AUTENTICAR = 'cadastros.entrada_autenticar(text)';
const PORTAL = [
  'cadastros.portal_entrada_ler(uuid)',
  'cadastros.portal_entrada_credencial_definir(uuid, text, bytea, text, text)',
  'cadastros.portal_entrada_credencial_revogar(uuid, text, text)',
] as const;
const INTERNAS = ['cadastros.entrada_hmac_imutavel()'] as const;

/** PortalEntradaLeitura do SDK (as chaves exatas são conferidas no teste (h)). */
interface Leitura {
  credenciais: { conector_id: string; prefixo: string; criada_em: string; revogada_em: string | null; ultimo_uso_em: string | null }[];
  ultimo_sinal: { conector_id: string; em: string; versao_conector: string } | null;
  lotes: { lote_id: string; entidade: string; modo: string; status: string; recebidos: number; com_erro: number; recebido_em: string; concluido_em: string | null }[];
}

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — entrada do FDV /entrada/v1 (T-0057 B1, 0071)', () => {
  let banco: BancoDeTeste;
  let sessao: string;

  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const jsonConfig = <T>(sql: string): T => JSON.parse(comoConfig(sql)[0] ?? 'null') as T;
  const ler = (t: string): Leitura => jsonConfig<Leitura>(`SELECT cadastros.portal_entrada_ler('${t}');`);
  const definir = (t: string, o: { conector?: string; hmac?: string; prefixo?: string } = {}): string =>
    `SELECT cadastros.portal_entrada_credencial_definir('${t}', '${o.conector ?? `cx-${t.slice(0, 8)}`}', ${o.hmac ?? HMAC},
       '${o.prefixo ?? PREFIXO}', 'req-0071');`;
  const revogar = (t: string, conector: string): string =>
    `SELECT cadastros.portal_entrada_credencial_revogar('${t}', '${conector}', 'req-rev');`;
  const recusaConfig = (sql: string, codigo: string, padrao: RegExp, s: string | null = sessao): void =>
    recusaDetalhada(banco.conexao, `${sessaoSql(s)}${sql}`, codigo, padrao, { papel: CONFIG });
  const autenticar = (conector: string): Record<string, unknown>[] =>
    consultar(banco.conexao, `SELECT * FROM cadastros.entrada_autenticar('${conector}')`, {
      papel: 'macuxierp_app',
    });
  const ativa = (t: string, conector: string): { id: string } | undefined =>
    consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM cadastros.entrada_credencial WHERE tenant_id = '${t}' AND conector_id = '${conector}'
         AND substituida_em IS NULL AND revogada_em IS NULL AND deleted_at IS NULL`,
    )[0];
  const auditoria = (t: string): { acao: string; superadmin_id: string; usuario_id: string | null; texto: string }[] =>
    consultar(
      banco.conexao,
      `SELECT acao, superadmin_id, usuario_id, coalesce(antes::text, '') || coalesce(depois::text, '') AS texto
         FROM plataforma.auditoria WHERE tenant_id = '${t}' AND acao LIKE 'cadastros.entrada.%' ORDER BY created_at, id`,
    );

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      `${[A, B].map((t) => fixturePlataforma(t) + fixtureModulos(t)).join('\n')}
${fixturePlataforma(C)}${fixturePlataforma(D)}${fixturePlataforma(E)}
UPDATE plataforma.tenant_modulo SET ativo = false WHERE tenant_id = '${C.id}' AND modulo = 'cadastros';
UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = '${D.id}';
UPDATE plataforma.tenant SET deleted_at = now() WHERE id = '${E.id}';
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0071@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) regra 5 e RLS ligada', () => {
    for (const t of TABELAS) {
      expect({ t, rls: um<{ r: boolean }>(`SELECT relrowsecurity AS r FROM pg_class WHERE oid = '${t}'::regclass`).r }).toEqual({ t, rls: true });
    }
  });

  it('(b) GRANTs mínimos: o app nunca lê o HMAC; o worker processa lote e cursor; a leitura não vê a credencial; o config nada', () => {
    const p = (papel: string): Record<string, string> => Object.fromEntries(TABELAS.map((t) => [t, privilegiosDe(banco.conexao, papel, t)]));
    expect(p('macuxierp_app')).toEqual({
      'cadastros.entrada_credencial': '-', // só colunas (sem chave_hmac)
      'cadastros.entrada_lote': 'SI',
      'cadastros.entrada_cursor': 'S',
      'cadastros.entrada_sinal': 'SI',
    });
    expect(p('macuxierp_worker')).toEqual({
      'cadastros.entrada_credencial': '-',
      'cadastros.entrada_lote': 'S',
      'cadastros.entrada_cursor': 'SI',
      'cadastros.entrada_sinal': '-',
    });
    expect(p('macuxierp_leitura')).toEqual({
      'cadastros.entrada_credencial': '-',
      'cadastros.entrada_lote': 'S',
      'cadastros.entrada_cursor': 'S',
      'cadastros.entrada_sinal': 'S',
    });
    expect(p(CONFIG)).toEqual(Object.fromEntries(TABELAS.map((t) => [t, '-'])));
    const app = { papel: 'macuxierp_app', tenant: A.id };
    expect(falha(() => consultar(banco.conexao, 'SELECT chave_hmac FROM cadastros.entrada_credencial', app))).toMatch(/permission denied/);
    expect(consultar(banco.conexao, 'SELECT conector_id, chave_prefixo FROM cadastros.entrada_credencial', app)).toEqual([
      { conector_id: CONECTOR_A, chave_prefixo: 'mxe_abcd' },
    ]);
    expect(falha(() => consultar(banco.conexao, 'SELECT 1 FROM cadastros.entrada_credencial', { papel: 'macuxierp_worker', tenant: A.id }))).toMatch(
      /permission denied/,
    );
    // o app só marca o uso; o worker só avança estado, contagens, erros e cursor (coluna a coluna)
    expect(
      um<{ app: boolean; app_hmac: boolean; w: boolean; w_chave: boolean }>(
        `SELECT has_column_privilege('macuxierp_app', 'cadastros.entrada_credencial', 'ultimo_uso_em', 'UPDATE') AS app,
                has_column_privilege('macuxierp_app', 'cadastros.entrada_credencial', 'chave_hmac', 'UPDATE') AS app_hmac,
                has_column_privilege('macuxierp_worker', 'cadastros.entrada_lote', 'estado', 'UPDATE') AS w,
                has_column_privilege('macuxierp_worker', 'cadastros.entrada_lote', 'idempotency_key', 'UPDATE') AS w_chave`,
      ),
    ).toEqual({ app: true, app_hmac: false, w: true, w_chave: false });
  });

  it('(c) funções: SECURITY DEFINER, search_path fixo, comentadas, sem PUBLIC; autenticar só do app; portal só do config; internas de ninguém', () => {
    for (const f of [AUTENTICAR, ...PORTAL, ...INTERNAS]) {
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
        definer: f !== 'cadastros.entrada_hmac_imutavel()',
        cfg: 'search_path=pg_catalog, pg_temp',
        comentado: true,
        publico: false,
        app: f === AUTENTICAR,
        worker: false,
        leitura: false,
        config: (PORTAL as readonly string[]).includes(f),
      });
    }
  });

  it('(d) definir: cria e troca pelo conector_id com o HMAC já calculado; a anterior sai na hora; auditoria sem HMAC nem prefixo', () => {
    const criada = jsonConfig<Record<string, unknown>>(definir(B.id, { conector: 'b-api' }));
    expect(criada).toEqual({ conector_id: 'b-api', prefixo: PREFIXO, criada_em: expect.stringMatching(/Z$/) });
    const primeira = ativa(B.id, 'b-api');
    // troca: mesma empresa e conector, HMAC novo; a anterior para de autenticar na hora
    jsonConfig(definir(B.id, { conector: 'b-api', hmac: `decode(repeat('ef', 32), 'hex')` }));
    const segunda = ativa(B.id, 'b-api');
    expect(segunda?.id).not.toBe(primeira?.id);
    expect(autenticar('b-api')).toEqual([{ tenant_id: B.id, credencial_id: segunda?.id, chave_hmac: 'ef'.repeat(32) }]);
    expect(um<{ s: boolean }>(`SELECT substituida_em IS NOT NULL AS s FROM cadastros.entrada_credencial WHERE id = '${primeira?.id}'`).s).toBe(true);
    // a leitura mostra uma linha por conector_id (a substituída some)
    expect(ler(B.id).credenciais.map((c) => c.conector_id).sort()).toEqual(['b-api', 'entrada-entrada-0071-b']);

    const aud = auditoria(B.id);
    expect(aud.map((a) => a.acao)).toEqual(['cadastros.entrada.credencial.criar', 'cadastros.entrada.credencial.trocar']);
    for (const a of aud) {
      expect(a).toMatchObject({ superadmin_id: SA, usuario_id: null });
      expect(a.texto).not.toContain(PREFIXO);
      expect(a.texto).not.toContain(HMAC_HEX);
      expect(a.texto).not.toContain('ef'.repeat(32));
      expect(a.texto).not.toMatch(/hmac|chave|prefixo/);
    }
  });

  it('(e) definir: formato, conector de outra empresa, empresa e licença recusados (23514 / MXC04 / P0002); sem sessão = MXS01', () => {
    const casos: [string, string][] = [
      [definir(A.id, { conector: 'com espaço' }), 'conector_id_invalido'],
      [definir(A.id, { conector: '-comeca-com-traco' }), 'conector_id_invalido'],
      [definir(A.id, { conector: 'x'.repeat(101) }), 'conector_id_invalido'],
      [definir(A.id, { hmac: `decode('abcd', 'hex')` }), 'hmac_invalido'],
      [definir(A.id, { prefixo: 'curto' }), 'prefixo_invalido'],
      [definir(A.id, { prefixo: 'longo-demais' }), 'prefixo_invalido'],
      // o conector_id é da empresa B (inclusive o substituído): nunca passa para outra empresa
      [definir(A.id, { conector: 'b-api' }), 'conector_em_uso'],
    ];
    for (const [sql, detalhe] of casos) {
      recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${sql}`, '23514', detalhe, { papel: CONFIG });
    }
    // empresa e licença: o MXC04 da plataforma.portal_empresa_licenciada (0064)
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${definir(C.id)}`, 'MXC04', 'modulo_desligado', { papel: CONFIG });
    recusaComDetalhe(banco.conexao, `${sessaoSql(sessao)}${definir(D.id)}`, 'MXC04', 'empresa_inativa', { papel: CONFIG });
    recusaConfig(definir(E.id), 'P0002', /empresa não encontrada/);
    recusaConfig(definir(randomUUID()), 'P0002', /empresa não encontrada/);
    recusaConfig(definir(A.id), 'MXS01', /sessão de superadmin inválida/, null);
    recusaConfig(definir(A.id), 'MXS01', /sessão de superadmin inválida/, randomUUID());
    // o app (sem SET ROLE no config) não executa
    expect(falha(() => executar(banco.conexao, definir(A.id), { papel: 'macuxierp_app', tenant: A.id }))).toMatch(/permission denied/);
    expect(ativa(A.id, `cx-${A.id.slice(0, 8)}`)).toBeUndefined();
  });

  it('(f) entrada_autenticar: sem tenant, devolve só tenant, credencial e HMAC da ativa; nada de conector desconhecido ou empresa excluída', () => {
    expect(autenticar(CONECTOR_A)).toEqual([
      { tenant_id: A.id, credencial_id: ativa(A.id, CONECTOR_A)?.id, chave_hmac: 'ab'.repeat(32) },
    ]);
    // o CredencialEntradaArmazenada da PortaCredencialEntrada.buscar: só as três colunas, o HMAC em hex minúsculo (64)
    expect(um<{ a: string }>(`SELECT pg_get_function_result('${AUTENTICAR}'::regprocedure) AS a`).a).toBe(
      'TABLE(tenant_id uuid, credencial_id uuid, chave_hmac text)',
    );
    // substituída e revogada não autenticam (só elas no conector)
    executar(
      banco.conexao,
      `INSERT INTO cadastros.entrada_credencial (tenant_id, conector_id, chave_hmac, chave_prefixo, substituida_em)
         VALUES ('${B.id}', 'b-substituida', ${HMAC}, 'mxe_ssss', now());
       INSERT INTO cadastros.entrada_credencial (tenant_id, conector_id, chave_hmac, chave_prefixo, revogada_em)
         VALUES ('${B.id}', 'b-revogada', ${HMAC}, 'mxe_rrrr', now());`,
    );
    expect(autenticar('b-substituida')).toEqual([]);
    expect(autenticar('b-revogada')).toEqual([]);
    expect(autenticar('nao-existe')).toEqual([]);
    expect(autenticar('')).toEqual([]);
    executar(
      banco.conexao,
      `INSERT INTO cadastros.entrada_credencial (tenant_id, conector_id, chave_hmac, chave_prefixo)
         VALUES ('${E.id}', 'e-excluida', ${HMAC}, 'mxe_eeee');`,
    );
    expect(autenticar('e-excluida')).toEqual([]);
    for (const papel of ['macuxierp_worker', 'macuxierp_leitura']) {
      expect(falha(() => consultar(banco.conexao, `SELECT * FROM cadastros.entrada_autenticar('x')`, { papel }))).toMatch(/permission denied/);
    }
  });

  it('(g) revogar: a credencial ativa sai na hora (autenticar vazio), auditada; de novo ou de outra empresa = P0002', () => {
    const r = jsonConfig<Record<string, unknown>>(revogar(B.id, 'b-api'));
    expect(r).toEqual({ conector_id: 'b-api', revogada_em: expect.stringMatching(/Z$/) });
    expect(autenticar('b-api')).toEqual([]);
    expect(ler(B.id).credenciais.find((c) => c.conector_id === 'b-api')?.revogada_em).toBe(r.revogada_em);
    const ult = auditoria(B.id).at(-1);
    expect(ult).toMatchObject({ acao: 'cadastros.entrada.credencial.revogar', superadmin_id: SA, usuario_id: null });
    expect(ult?.texto).not.toContain(PREFIXO);
    recusaConfig(revogar(B.id, 'b-api'), 'P0002', /credencial não encontrada/);
    recusaConfig(revogar(B.id, CONECTOR_A), 'P0002', /credencial não encontrada/);
    recusaConfig(revogar(B.id, CONECTOR_A), 'MXS01', /sessão de superadmin inválida/, null);
    // revogar vale até com a empresa suspensa (segurança): a D não tem credencial, então P0002 da credencial
    recusaConfig(revogar(D.id, 'qualquer'), 'P0002', /credencial não encontrada/);
    // depois de revogada, o mesmo conector_id volta com chave nova
    jsonConfig(definir(B.id, { conector: 'b-api' }));
    expect(ativa(B.id, 'b-api')).toBeDefined();
    expect(ler(B.id).credenciais.find((c) => c.conector_id === 'b-api')?.revogada_em).toBeNull();
  });

  it('(h) portal_ler: o PortalEntradaLeitura sem HMAC, corpo nem chave de idempotência; sem auditoria; MXS01 e P0002', () => {
    const antes = auditoria(A.id).length;
    const texto = comoConfig(`SELECT cadastros.portal_entrada_ler('${A.id}');`)[0] ?? '';
    expect(texto).not.toContain('ab'.repeat(32));
    expect(texto).not.toMatch(/hmac|corpo|chave-entrada|CLI-1/);
    const e = ler(A.id);
    expect(Object.keys(e).sort()).toEqual(['credenciais', 'lotes', 'ultimo_sinal']);
    expect(e.credenciais).toEqual([
      { conector_id: CONECTOR_A, prefixo: 'mxe_abcd', criada_em: expect.stringMatching(/Z$/), revogada_em: null, ultimo_uso_em: null },
    ]);
    expect(e.ultimo_sinal).toEqual({ conector_id: CONECTOR_A, em: expect.stringMatching(/Z$/), versao_conector: '1.5.0' });
    expect(e.lotes).toEqual([
      {
        lote_id: expect.any(String),
        entidade: 'cliente',
        modo: 'delta',
        status: 'recebido',
        recebidos: 1,
        com_erro: 0,
        recebido_em: expect.stringMatching(/Z$/),
        concluido_em: null,
      },
    ]);
    expect(auditoria(A.id).length).toBe(antes);
    // a leitura vale para empresa sem licença ou suspensa
    expect(ler(C.id)).toEqual({ credenciais: [], ultimo_sinal: null, lotes: [] });
    expect(ler(D.id).credenciais).toEqual([]);
    recusaConfig(`SELECT cadastros.portal_entrada_ler('${E.id}');`, 'P0002', /empresa não encontrada/);
    recusaConfig(`SELECT cadastros.portal_entrada_ler('${A.id}');`, 'MXS01', /sessão de superadmin inválida/, null);
  });

  it('(i) lote: Idempotency-Key única por tenant e conector; delta só; corpo zerado no estado final; conector igual ao da credencial', () => {
    const app = { papel: 'macuxierp_app', tenant: A.id };
    const inserir = (chave: string, extra = ''): string =>
      `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, conector_id, entidade, idempotency_key, hash_corpo, corpo, recebidos${extra ? ', modo' : ''})
         SELECT tenant_id, id, conector_id, 'produto', '${chave}', repeat('f', 64), '{}', 2${extra}
         FROM cadastros.entrada_credencial WHERE tenant_id = plataforma.tenant_atual()
           AND substituida_em IS NULL AND revogada_em IS NULL;`;
    // a mesma chave da fixture no mesmo conector = 23505; a chave do tenant B, no A, não conflita
    recusaDetalhada(banco.conexao, inserir('chave-entrada-0071-a'), '23505', /entrada_lote_idempotencia_uq/, app);
    executar(banco.conexao, inserir('chave-entrada-0071-b'), app);
    // fora do PADRAO_CHAVE_IDEMPOTENCIA (curta demais)
    recusaDetalhada(banco.conexao, inserir('curta'), '23514', /entrada_lote_idempotency_key_check/, app);
    // carga completa fica para depois (decisão 34 B)
    recusaDetalhada(banco.conexao, inserir('chave-completo', `, 'completo'`), '23514', /entrada_lote_modo_check/, app);
    // conector do lote diferente do da credencial = FK composta
    recusaDetalhada(
      banco.conexao,
      `INSERT INTO cadastros.entrada_lote (tenant_id, credencial_id, conector_id, entidade, idempotency_key, hash_corpo, corpo, recebidos)
         SELECT tenant_id, id, 'outro', 'produto', 'chave-outro', repeat('f', 64), '{}', 0 FROM cadastros.entrada_credencial
         WHERE tenant_id = plataforma.tenant_atual();`,
      '23503',
      /foreign key/,
      app,
    );
    const w = { papel: 'macuxierp_worker', tenant: A.id };
    // estado final com corpo = recusado; sem corpo e com concluido_em, passa; com_erro acima de recebidos, não
    recusaDetalhada(
      banco.conexao,
      `UPDATE cadastros.entrada_lote SET estado = 'concluido', concluido_em = now() WHERE idempotency_key = 'chave-entrada-0071-b';`,
      '23514',
      /entrada_lote_corpo_zerado/,
      w,
    );
    recusaDetalhada(
      banco.conexao,
      `UPDATE cadastros.entrada_lote SET com_erro = 3 WHERE idempotency_key = 'chave-entrada-0071-b';`,
      '23514',
      /entrada_lote_com_erro/,
      w,
    );
    executar(
      banco.conexao,
      `UPDATE cadastros.entrada_lote SET estado = 'concluido_com_erros', corpo = NULL, concluido_em = now(), com_erro = 1,
         erros = '[{"indice": 0, "external_id": "P1", "campo": "ncm", "codigo": "formato_invalido"}]'
       WHERE idempotency_key = 'chave-entrada-0071-b';`,
      w,
    );
    expect(ler(A.id).lotes[0]).toMatchObject({ entidade: 'produto', status: 'concluido_com_erros', recebidos: 2, com_erro: 1 });
    expect(falha(() => executar(banco.conexao, `UPDATE cadastros.entrada_lote SET idempotency_key = 'x';`, w))).toMatch(/permission denied/);
    // um lote por entidade e conector processando de cada vez
    executar(banco.conexao, `UPDATE cadastros.entrada_lote SET estado = 'processando' WHERE idempotency_key = 'chave-entrada-0071-a';`, w);
    executar(banco.conexao, inserir('chave-segunda'), app);
    executar(banco.conexao, `UPDATE cadastros.entrada_lote SET entidade = 'cliente' WHERE idempotency_key = 'chave-segunda';`);
    recusaDetalhada(
      banco.conexao,
      `UPDATE cadastros.entrada_lote SET estado = 'processando' WHERE idempotency_key = 'chave-segunda';`,
      '23505',
      /entrada_lote_um_processando/,
      w,
    );
  });

  it('(j) o HMAC gravado nunca é trocado (troca = credencial nova), nem pelo dono', () => {
    recusaDetalhada(
      banco.conexao,
      `UPDATE cadastros.entrada_credencial SET chave_hmac = decode(repeat('00', 32), 'hex') WHERE tenant_id = '${A.id}';`,
      '42501',
      /troca = credencial nova/,
    );
  });
});
