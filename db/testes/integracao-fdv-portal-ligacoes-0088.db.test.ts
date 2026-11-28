/**
 * T-0131 (v0.3.32), migração 0088: integracao_fdv.portal_ligacoes(uuid), a ligação ERP → Macuxi FDV no /config com os mesmos
 * números da rota GET /v1/integracao-fdv/ligacoes (#978; RN-INF-13). Conferem os privilégios, a barreira de sessão e de
 * empresa, o formato, a paridade com o lerLigacoes (a massa do rotas.db.test.ts do módulo e uma referência em TS do
 * contarLigacao e do loteResumo, abaixo), o corte em 50 envios, o isolamento entre tenants e a ausência de chave e de corpo.
 */
import { randomUUID } from 'node:crypto';
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
  recusaDetalhada,
  rodarComo,
  sessaoSql,
} from './apoio.ts';
import { fixturePlataforma, novoTenant } from './fixture.ts';

const CONFIG = 'macuxierp_config';
const FUNCAO = 'integracao_fdv.portal_ligacoes(uuid)';
/** A massa do teste da rota (modules/integracao-fdv/api/rotas.db.test.ts, GET /ligacoes): 180 enviados, 155 aceitos. */
const A = novoTenant('ifdv-0088-a');
/** Casos de borda e mais de 50 envios. */
const B = novoTenant('ifdv-0088-b');
/** Licenciada, sem credencial nem lote. */
const D = novoTenant('ifdv-0088-d');
const SA = '5a000000-0000-4000-8000-000000000881';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const CIFRADA = `decode(repeat('ab', 40), 'hex')`;
// hora-fixa-ok: instante só gravado e devolvido em ISO, nunca comparado ao relógio
const BASE = Date.parse('2026-11-20T10:00:00.000Z');
const EM_VOO = ['montado', 'enviando', 'aceito'];
const COM_HUB = ['aceito', 'concluido', 'concluido_com_erros'];

interface Lote {
  estado: string;
  repetido?: boolean;
  /** jsonb literal das contagens. */
  contagens: string;
  entidade?: string;
  excluido?: boolean;
}
interface Envio {
  id: string;
  entidade: string;
  estado: string;
  registros: number;
  aceitos: number | null;
  com_erro: number | null;
  enviado_em: string | null;
  concluido_em: string | null;
}
interface Ligacoes {
  contato: {
    credencial_ativa: boolean;
    conector_id: string | null;
    ambiente: string | null;
    chave_prefixo: string | null;
    habilitadas: number;
    ultimo_contato_em: string | null;
  };
  contadores: { enviados: number; aceitos: number };
  envios: Envio[];
  envios_cortados: boolean;
}

/**
 * Referência da rota, copiada de modules/integracao-fdv (o db/testes não importa o módulo): o SQL de lerLigacoes agrupa por
 * (estado, repetido) só os ESTADOS_ENVIADOS_AO_HUB; contarLigacao (domain/ligacao.ts) pula o repetido e soma por grupo;
 * loteResumo (api/monitor.ts) monta cada envio; o histórico é dos 50 mais novos, sem o repetido.
 */
const ENVIADOS_AO_HUB = ['enviando', 'aceito', 'concluido', 'concluido_com_erros'];
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function referencia(lotes: readonly (Lote & { created: number })[]): Pick<Ligacoes, 'contadores' | 'envios_cortados'> & { envios: Omit<Envio, 'id' | 'enviado_em' | 'concluido_em'>[] } {
  const vivos = lotes.filter((l) => !l.excluido && ENVIADOS_AO_HUB.includes(l.estado));
  const grupos = new Map<string, { repetido: boolean; registros: number; aceitos: number }>();
  for (const l of vivos) {
    const c = JSON.parse(l.contagens) as { registros?: unknown; hub?: { recebidas?: unknown; com_erro?: unknown } };
    const k = `${l.estado}/${l.repetido ?? false}`;
    const g = grupos.get(k) ?? { repetido: l.repetido ?? false, registros: 0, aceitos: 0 };
    g.registros += num(c.registros) ?? 0;
    const rec = num(c.hub?.recebidas);
    if (rec !== null) g.aceitos += Math.max(0, rec - (num(c.hub?.com_erro) ?? 0));
    grupos.set(k, g);
  }
  let enviados = 0;
  let aceitos = 0;
  for (const g of grupos.values()) {
    if (g.repetido) continue;
    enviados += Math.max(0, g.registros);
    aceitos += Math.min(Math.max(0, g.aceitos), Math.max(0, g.registros));
  }
  const historico = vivos.filter((l) => !l.repetido).sort((x, y) => y.created - x.created);
  return {
    contadores: { enviados, aceitos },
    envios: historico.slice(0, 50).map((l) => {
      const c = JSON.parse(l.contagens) as { registros?: unknown; hub?: { recebidas?: unknown; com_erro?: unknown } };
      const rec = num(c.hub?.recebidas);
      const err = num(c.hub?.com_erro);
      return { entidade: l.entidade ?? 'produto', estado: l.estado, registros: num(c.registros) ?? 0, aceitos: rec === null ? null : Math.max(0, rec - (err ?? 0)), com_erro: err };
    }),
    envios_cortados: historico.length > 50,
  };
}

const LOTES_A: Lote[] = [
  { estado: 'concluido', contagens: '{"registros": 100, "hub": {"recebidas": 100, "com_erro": 0}}' },
  { estado: 'concluido_com_erros', contagens: '{"registros": 50, "hub": {"recebidas": 50, "com_erro": 5}}' },
  { estado: 'enviando', contagens: '{"registros": 20}', entidade: 'cliente' },
  { estado: 'aceito', contagens: '{"registros": 10, "hub": {"recebidas": 10}}', entidade: 'filial' },
  { estado: 'concluido', repetido: true, contagens: '{"registros": 100, "hub": {"recebidas": 100, "com_erro": 0}}' },
  { estado: 'falhou', contagens: '{"registros": 99}' },
  { estado: 'montado', contagens: '{"registros": 7}', entidade: 'vendedor' },
  { estado: 'recusado', contagens: '{"registros": 5}' },
];

/** Bordas: recebidas acima dos registros (o teto é do grupo), com_erro acima de recebidas, texto no lugar de número, excluído; e 52 concluídos. */
const LOTES_B: Lote[] = [
  { estado: 'concluido_com_erros', contagens: '{"registros": 4, "hub": {"recebidas": 9, "com_erro": 1}}' },
  { estado: 'concluido_com_erros', contagens: '{"registros": 3, "hub": {"recebidas": 1, "com_erro": 4}}' },
  { estado: 'concluido_com_erros', contagens: '{"registros": "7", "hub": {"recebidas": "7", "com_erro": 2}}' },
  { estado: 'aceito', contagens: '{"registros": 6, "hub": {"recebidas": 6, "com_erro": "x"}}', entidade: 'cliente' },
  { estado: 'enviando', contagens: '{}', entidade: 'filial' },
  { estado: 'concluido', contagens: '{"registros": 1000, "hub": {"recebidas": 1000}}', excluido: true },
  { estado: 'concluido', repetido: true, contagens: '{"registros": 1000, "hub": {"recebidas": 1000}}' },
  ...Array.from({ length: 52 }, (_, i): Lote => ({ estado: 'concluido', contagens: `{"registros": ${i + 1}, "hub": {"recebidas": ${i + 1}, "com_erro": ${i % 3}}}` })),
];

describe.skipIf(!PG_DISPONIVEL)('banco macuxierp — ligação ERP → Macuxi FDV pelo portal /config (T-0131, RN-INF-13, 0088)', () => {
  let banco: BancoDeTeste;
  let sessao: string;
  const cred: Record<string, string> = {};
  const massa: Record<string, (Lote & { created: number })[]> = {};

  const comoConfig = (sql: string, s: string | null = sessao): string[] =>
    linhas(rodarComo(banco.conexao, `${sessaoSql(s)}${sql}`, { papel: CONFIG }));
  const ligacoes = (t: string): Ligacoes => JSON.parse(comoConfig(`SELECT integracao_fdv.portal_ligacoes('${t}');`)[0] ?? 'null') as Ligacoes;
  const um = <T>(sql: string): T => consultar<T>(banco.conexao, sql)[0] as T;
  const inserirLotes = (t: string, lotes: readonly Lote[]): string => {
    massa[t] = lotes.map((l, i) => ({ ...l, created: BASE + i * 1000 }));
    return massa[t]
      .map((l) => {
        const iso = new Date(l.created).toISOString();
        const voo = EM_VOO.includes(l.estado);
        return `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, repetido,
  contagens, corpo, hub_lote_id, enviado_em, concluido_em, ultimo_erro_codigo, created_at, deleted_at) VALUES
  ('${t}', '${l.entidade ?? 'produto'}', '${cred[t]}', 'delta', encode(sha256(convert_to('${randomUUID()}', 'UTF8')), 'hex'), '${l.estado}',
   ${l.repetido ?? false}, '${l.contagens}'::jsonb, ${voo ? `'{}'` : 'NULL'}, ${COM_HUB.includes(l.estado) ? 'gen_random_uuid()' : 'NULL'},
   '${iso}', ${voo ? 'NULL' : `'${iso}'`}, ${['falhou', 'recusado'].includes(l.estado) ? `'rede'` : 'NULL'}, '${iso}', ${l.excluido ? 'now()' : 'NULL'});\n`;
      })
      .join('');
  };

  beforeAll(() => {
    banco = criarBancoDeTeste();
    migrar(banco.conexao, { oficiais: false });
    permitirSetRole(banco.conexao);
    sessao = randomUUID();
    executar(
      banco.conexao,
      // hora-fixa-ok: a validade da sessão de superadmin só precisa estar no futuro, nunca é comparada ao instante fixo
      `${[A, B, D].map(fixturePlataforma).join('')}
INSERT INTO plataforma.tenant_modulo (tenant_id, modulo) VALUES ('${A.id}', 'integracao-fdv'), ('${B.id}', 'integracao-fdv'), ('${D.id}', 'integracao-fdv');
INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo)
  VALUES ('${SA}', 'sa0088@plataforma.teste', 'Superadmin Ficticio', '${HASH}', false, true);
INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
  VALUES ('${sessao}', '${SA}', encode(sha256(convert_to('${sessao}', 'UTF8')), 'hex'), now() + interval '8 hours', now());`,
    );
    for (const [t, conector, prefixo, entidades] of [
      [A.id, 'erp-teste', 'chave-se', `ARRAY['produto']`],
      [B.id, 'conector-b', 'pfxb0088', `ARRAY['produto', 'cliente', 'filial']`],
    ] as const) {
      comoConfig(
        `SELECT integracao_fdv.portal_credencial_definir('${t}', NULL, '${conector}', 'teste', ${CIFRADA}, '${prefixo}', 1, false, NULL, 'req-def', ${entidades}::text[]);`,
      );
      cred[t] = um<{ id: string }>(`SELECT id FROM integracao_fdv.credencial WHERE tenant_id = '${t}' AND substituida_em IS NULL`).id;
    }
    executar(
      banco.conexao,
      // hora-fixa-ok: instante só gravado e devolvido em ISO
      `${inserirLotes(A.id, LOTES_A)}${inserirLotes(B.id, LOTES_B)}
UPDATE integracao_fdv.sinal SET ultimo_aceito_em = '2026-11-28T11:00:00.123Z' WHERE tenant_id = '${A.id}';`,
    );
  });

  afterAll(() => banco?.remover());

  it('(a) EXECUTE só do config; SECURITY DEFINER, search_path fixo, comentada, sem PUBLIC; app, worker e leitura não executam', () => {
    const r = um<Record<string, unknown>>(
      `SELECT p.prosecdef AS definer, array_to_string(p.proconfig, ',') AS cfg,
         obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentado,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
         has_function_privilege('macuxierp_app', p.oid, 'EXECUTE') AS app,
         has_function_privilege('macuxierp_worker', p.oid, 'EXECUTE') AS worker,
         has_function_privilege('macuxierp_leitura', p.oid, 'EXECUTE') AS leitura,
         has_function_privilege('${CONFIG}', p.oid, 'EXECUTE') AS config
       FROM pg_proc p WHERE p.oid = '${FUNCAO}'::regprocedure`,
    );
    expect(r).toEqual({ definer: true, cfg: 'search_path=pg_catalog, pg_temp', comentado: true, publico: false, app: false, worker: false, leitura: false, config: true });
    for (const tabela of ['lote_envio', 'sinal']) {
      recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}SELECT count(*) FROM integracao_fdv.${tabela};`, '42501', /permission denied/, { papel: CONFIG });
    }
  });

  it('(b) barreiras: sem sessão MXS01; empresa inexistente P0002', () => {
    recusaDetalhada(banco.conexao, `SELECT integracao_fdv.portal_ligacoes('${A.id}');`, 'MXS01', /sessão de superadmin inválida/, { papel: CONFIG });
    recusaDetalhada(banco.conexao, `${sessaoSql(sessao)}SELECT integracao_fdv.portal_ligacoes('${randomUUID()}');`, 'P0002', /empresa não encontrada/, { papel: CONFIG });
  });

  it('(c) RN-INF-13: a massa da rota dá 180 enviados e 155 aceitos, os 4 envios na ordem da rota e o Contato da credencial', () => {
    const a = ligacoes(A.id);
    expect(Object.keys(a).sort()).toEqual(['contadores', 'contato', 'envios', 'envios_cortados']);
    expect(a.contadores).toEqual({ enviados: 180, aceitos: 155 });
    expect(a.envios.map((e) => e.estado)).toEqual(['aceito', 'enviando', 'concluido_com_erros', 'concluido']);
    expect(a.envios[2]).toMatchObject({ entidade: 'produto', registros: 50, aceitos: 45, com_erro: 5 });
    expect(a.envios[1]).toMatchObject({ entidade: 'cliente', registros: 20, aceitos: null, com_erro: null, concluido_em: null });
    expect(a.envios_cortados).toBe(false);
    expect(a.contato).toEqual({
      credencial_ativa: true, conector_id: 'erp-teste', ambiente: 'teste', chave_prefixo: 'chave-se', habilitadas: 1,
      ultimo_contato_em: '2026-11-28T11:00:00.123Z',
    });
    const ids = consultar<{ id: string }>(
      banco.conexao,
      `SELECT id FROM integracao_fdv.lote_envio WHERE tenant_id = '${A.id}' AND NOT repetido AND estado = ANY (ARRAY['enviando','aceito','concluido','concluido_com_erros'])
        ORDER BY created_at DESC, id DESC`,
    ).map((x) => x.id);
    expect(a.envios.map((e) => e.id)).toEqual(ids);
    expect(a.envios.every((e) => e.enviado_em !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.enviado_em))).toBe(true);
  });

  it('(d) paridade com a referência da rota (contarLigacao e loteResumo) nas bordas; corte em 50 envios', () => {
    for (const t of [A.id, B.id]) {
      const r = ligacoes(t);
      const esperado = referencia(massa[t] ?? []);
      expect({ t, contadores: r.contadores, cortados: r.envios_cortados }).toEqual({ t, contadores: esperado.contadores, cortados: esperado.envios_cortados });
      expect(r.envios.map(({ entidade, estado, registros, aceitos, com_erro }) => ({ entidade, estado, registros, aceitos, com_erro }))).toEqual(esperado.envios);
    }
    const b = ligacoes(B.id);
    // 52 concluídos (1..52, aceitos = n - n%3) + o grupo concluido_com_erros (registros 7, aceitos 8+0 = 8, teto 7) + aceito 6
    expect(b.contadores).toEqual({ enviados: 1378 + 7 + 6, aceitos: 1378 - 51 + 7 + 6 });
    expect(b.envios).toHaveLength(50);
    expect(b.envios_cortados).toBe(true);
    expect(b.contato).toMatchObject({ conector_id: 'conector-b', chave_prefixo: 'pfxb0088', habilitadas: 3, ultimo_contato_em: null });
  });

  it('(e) sem credencial nem lote: zeros, Contato nulo; um tenant não vê o do outro; sem chave nem corpo', () => {
    expect(ligacoes(D.id)).toEqual({
      contato: { credencial_ativa: false, conector_id: null, ambiente: null, chave_prefixo: null, habilitadas: 0, ultimo_contato_em: null },
      contadores: { enviados: 0, aceitos: 0 },
      envios: [],
      envios_cortados: false,
    });
    const idsDe = (t: string): Set<string> => new Set(ligacoes(t).envios.map((e) => e.id));
    const a = idsDe(A.id);
    expect([...idsDe(B.id)].some((id) => a.has(id))).toBe(false);
    const texto = JSON.stringify([ligacoes(A.id), ligacoes(B.id)]);
    for (const proibido of ['chave_cifrada', 'corpo', 'external_id', 'payload', 'abab']) expect(texto).not.toContain(proibido);
  });
});
