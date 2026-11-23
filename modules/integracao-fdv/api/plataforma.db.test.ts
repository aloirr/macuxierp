/**
 * Plugin de plataforma da Integração FDV contra o PostgreSQL real com a 0038 (T-0056, ADR 0013): cada chamada abre uma
 * transação como a apps/api faz no `comPlataforma` (SET LOCAL ROLE macuxierp_config + a sessão do superadmin) e roda a rota.
 * A chave do conector nunca pode aparecer em resposta, log, auditoria, evento nem erro. Sem Postgres o teste pula
 * (`bash db/scripts/pg-local.sh`; migrações em `MACUXI_DB_MIGRACOES`).
 */
import { randomUUID } from 'node:crypto';
import { CAMINHOS_INTEGRACAO_FDV_PLATAFORMA as C, decifrarCampo, ErroApi, type Transacao } from '@macuxierp/platform-sdk';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarPluginPlataformaIntegracaoFdv } from './plataforma';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv';
const SA = '5a000000-0000-4000-8000-0000000000f1';
const MESTRA = Buffer.alloc(32, 11);
const CHAVE = 'chave-do-conector-portal-0123456789abcdef-NAO-VAZAR';
const CHAVE_2 = 'segunda-chave-do-conector-0123456789abcdef-NAO-VAZAR';
const ENTRADA = { conector_id: 'erp-portal', chave: CHAVE, ambiente: 'teste' };

describe.skipIf(!PG_DISPONIVEL)('plugin de plataforma da Integração FDV no PostgreSQL real (0038)', () => {
  let b: BancoEfemero;
  let sessao: string;
  let A: string;
  let B: string;
  let SEM: string;
  let SUSPENSA: string;
  const saidasDeLog: string[] = [];
  const respostas: string[] = [];
  const plugin = criarPluginPlataformaIntegracaoFdv({ chaveIntegracao: MESTRA, chaveVersao: 1 });

  async function comPlataforma<R>(s: string, fn: (tx: Transacao) => Promise<R>, confirmar: boolean): Promise<R> {
    const c = await b.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE macuxierp_config');
      await c.query("SELECT set_config('macuxierp.sessao_superadmin', $1, true)", [s]);
      const tx: Transacao = { consultar: async (sql, p = []) => (await c.query(sql, p as unknown[])).rows };
      const r = await fn(tx);
      await c.query(confirmar ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Sempre confirma (as escritas se enxergam entre as chamadas); o erro desfaz a transação. */
  const chamar = async (metodo: string, caminho: string, e: { corpo?: unknown; params?: Record<string, string>; sessao?: string } = {}) => {
    const r = plugin.rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
    if (!r) throw new Error(`rota ${metodo} ${caminho}`);
    try {
      const out = await comPlataforma(e.sessao ?? sessao, (tx) =>
        // hora-fixa-ok: o instante do contexto só alimenta a rota; o teste não o compara com instantes fixos
        r.executar({ sessao: { superadmin_id: SA, sessao_id: e.sessao ?? sessao }, tx, request_id: randomUUID(), agora: new Date(), auditar: async () => {} }, {
          corpo: r.corpo ? r.corpo.parse(e.corpo) : undefined,
          params: e.params ?? {},
        } as never), true);
      respostas.push(JSON.stringify(out));
      return out;
    } catch (x) {
      if (x instanceof ErroApi) respostas.push(JSON.stringify({ status: x.status, codigo: x.codigo, message: x.message }));
      throw x;
    }
  };

  const credenciais = async (t: string) =>
    (await b.admin.query('SELECT id, conector_id, chave_cifrada, chave_prefixo, chave_mestra_versao, substituida_em FROM integracao_fdv.credencial WHERE tenant_id = $1 ORDER BY created_at, id', [t])).rows;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    await b.admin.query(`DO $$ BEGIN
      IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN GRANT macuxierp_config TO CURRENT_USER; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END $$`);
    A = await criarTenant(b.admin, 'portal-ifdv-a', ['integracao-fdv']);
    B = await criarTenant(b.admin, 'portal-ifdv-b', ['integracao-fdv']);
    SEM = await criarTenant(b.admin, 'portal-ifdv-sem', []);
    SUSPENSA = await criarTenant(b.admin, 'portal-ifdv-susp', ['integracao-fdv']);
    await b.admin.query("UPDATE plataforma.tenant SET situacao = 'suspenso' WHERE id = $1", [SUSPENSA]);
    await b.admin.query(
      `INSERT INTO plataforma.superadmin (id, email, nome, senha_hash, deve_trocar_senha, ativo) VALUES ($1, 'sa-ifdv@exemplo.com.br', 'Superadmin de teste', $2, false, true)`,
      [SA, HASH],
    );
    sessao = randomUUID();
    await b.admin.query(
      // hora-fixa-ok: sessão de teste válida por 8h a partir do relógio do banco
      `INSERT INTO plataforma.sessao_superadmin (id, superadmin_id, token_hash, expira_em, ultimo_uso_em)
       VALUES ($1::uuid, $2::uuid, encode(sha256(convert_to($1::text, 'UTF8')), 'hex'), now() + interval '8 hours', now())`,
      [sessao, SA],
    );
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void saidasDeLog.push(a.map(String).join(' ')));
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    await b?.remover();
  });

  it('GET sem credencial: 10 cadastros desligados na ordem de carga, módulo licenciado, sem chave', async () => {
    const r = await chamar('GET', C.ler, { params: { id: A } });
    expect(r.corpo).toMatchObject({ empresa_id: A, modulo_licenciado: true, credencial_id: null, conector_id: null, limite_registros_lote: null, entidades_habilitadas: [], ultimo_sinal: null });
    const cad = (r.corpo as { cadastros: { entidade: string; ligada: boolean; falha: unknown; lote_em_voo: boolean }[] }).cadastros;
    expect(cad.map((c) => c.entidade)).toHaveLength(10);
    expect(cad.every((c) => !c.ligada && c.falha === null && !c.lote_em_voo)).toBe(true);
  });

  it('RF-INF-05: a primeira credencial dá 201 e a seguinte 200; cifra com a empresa alvo, audita com o superadmin e nada vaza a chave', async () => {
    const primeira = await chamar('PUT', C.credencial, { params: { id: A }, corpo: ENTRADA });
    expect(primeira.status).toBe(201);
    expect(primeira.corpo).toMatchObject({ conector_id: 'erp-portal', ambiente: 'teste', chave_prefixo: CHAVE.slice(0, 8), limite_registros_lote: 5000 });
    expect((primeira.corpo as { entidades_habilitadas: string[] }).entidades_habilitadas).toHaveLength(10);
    const segunda = await chamar('PUT', C.credencial, { params: { id: A }, corpo: { ...ENTRADA, chave: CHAVE_2 } });
    expect(segunda.status).toBe(200);

    const linhas = await credenciais(A);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.substituida_em).not.toBeNull();
    expect(decifrarCampo({ chave: MESTRA, tenantId: A, cifrado: linhas[1]!.chave_cifrada }).toString('utf8')).toBe(CHAVE_2);
    expect(() => decifrarCampo({ chave: MESTRA, tenantId: B, cifrado: linhas[1]!.chave_cifrada })).toThrow();
    // a primeira credencial pede a carga inicial uma vez; trocar só a chave não repete
    const ev = (await b.admin.query("SELECT nome FROM plataforma.evento WHERE tenant_id = $1 AND nome LIKE 'integracao-fdv.%'", [A])).rows;
    expect(ev.map((e) => e.nome)).toEqual(['integracao-fdv.carga_inicial.solicitada@1']);
    const aud = (await b.admin.query("SELECT acao, superadmin_id, usuario_id FROM plataforma.auditoria WHERE tenant_id = $1 AND acao LIKE 'integracao-fdv.%' ORDER BY created_at, id", [A])).rows;
    expect(aud.map((x) => x.acao)).toEqual(['integracao-fdv.credencial.criar', 'integracao-fdv.credencial.trocar']);
    expect(aud.every((x) => x.superadmin_id === SA && x.usuario_id === null)).toBe(true);

    const tudo = JSON.stringify([
      respostas, saidasDeLog,
      (await b.admin.query('SELECT to_jsonb(a)::text FROM plataforma.auditoria a WHERE tenant_id = $1', [A])).rows,
      (await b.admin.query('SELECT payload::text FROM plataforma.evento WHERE tenant_id = $1', [A])).rows,
    ]);
    for (const segredo of [CHAVE, CHAVE_2, MESTRA.toString('hex'), MESTRA.toString('base64'), linhas[1]!.chave_cifrada.toString('hex')]) expect(tudo).not.toContain(segredo);
  });

  it('o GET depois da troca mostra o prefixo e o conector; outro tenant não enxerga a credencial', async () => {
    const a = await chamar('GET', C.ler, { params: { id: A } });
    expect(a.corpo).toMatchObject({ conector_id: 'erp-portal', chave_prefixo: CHAVE_2.slice(0, 8) });
    const outro = await chamar('GET', C.ler, { params: { id: B } });
    expect(outro.corpo).toMatchObject({ credencial_id: null, conector_id: null });
    expect(await credenciais(B)).toHaveLength(0);
  });

  it('configuração, testar, carga completa e retomar: o ciclo do portal', async () => {
    const cfg = await chamar('PUT', C.configuracao, { params: { id: A }, corpo: { entidades_habilitadas: ['filial', 'produto'], limite_registros_lote: 250 } });
    expect(cfg.corpo).toMatchObject({ entidades_habilitadas: ['filial', 'produto'], limite_registros_lote: 250 });
    const lig = (cfg.corpo as { cadastros: { entidade: string; ligada: boolean }[] }).cadastros.filter((c) => c.ligada).map((c) => c.entidade);
    expect(lig).toEqual(['filial', 'produto']);
    const t = await chamar('POST', C.testar, { params: { id: A } });
    expect(t).toMatchObject({ status: 202, corpo: { aceito: true } });
    expect(Number.isNaN(Date.parse((t.corpo as { pedido_em: string }).pedido_em))).toBe(false);
    expect(await chamar('POST', C.cargaCompleta, { params: { id: A, entidade: 'produto' } })).toMatchObject({ status: 202, corpo: { aceito: true } });
    await expect(chamar('POST', C.cargaCompleta, { params: { id: A, entidade: 'cliente' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-INF-02' });
    expect(await chamar('POST', C.retomar, { params: { id: A, entidade: 'produto' } })).toEqual({ corpo: { retomada: false } });
    await b.admin.query("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'envelope', pausada_em = now() WHERE tenant_id = $1 AND entidade = 'produto'", [A]);
    expect(await chamar('POST', C.retomar, { params: { id: A, entidade: 'produto' } })).toEqual({ corpo: { retomada: true } });
    const acoes = (await b.admin.query("SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 AND acao LIKE 'integracao-fdv.%'", [A])).rows.map((x) => x.acao);
    expect(acoes).toEqual(expect.arrayContaining(['integracao-fdv.configuracao.alterar', 'integracao-fdv.credencial.testar', 'integracao-fdv.entidade.carga_completa', 'integracao-fdv.entidade.retomar']));
  });

  it('sessão inválida: a função recusa e nada é gravado', async () => {
    const antes = await credenciais(B);
    await expect(chamar('GET', C.ler, { params: { id: A }, sessao: randomUUID() })).rejects.toThrow();
    await expect(chamar('PUT', C.credencial, { params: { id: B }, corpo: ENTRADA, sessao: randomUUID() })).rejects.toThrow();
    expect(await credenciais(B)).toEqual(antes);
  });

  it('RN-CORE-02: empresa sem o módulo licenciado dá 422 na escrita e nada é gravado; o GET mostra modulo_licenciado falso', async () => {
    expect((await chamar('GET', C.ler, { params: { id: SEM } })).corpo).toMatchObject({ modulo_licenciado: false });
    await expect(chamar('PUT', C.credencial, { params: { id: SEM }, corpo: ENTRADA })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-02', message: 'Ligue o módulo Integração FDV na empresa antes de configurar' });
    await expect(chamar('PUT', C.configuracao, { params: { id: SEM }, corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 1 } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-02' });
    expect(await credenciais(SEM)).toHaveLength(0);
  });

  it('empresa suspensa: recusa com 23514 (0038) ou MXI04 empresa_inativa (0039); o erro sobe cru (a apps/api mapeia para 422)', async () => {
    const erro = await chamar('PUT', C.credencial, { params: { id: SUSPENSA }, corpo: ENTRADA }).then(
      () => null,
      (e: unknown) => e as { code?: string; detail?: string },
    );
    expect(erro).not.toBeNull();
    expect(
      erro?.code === '23514' || (erro?.code === 'MXI04' && erro?.detail === 'empresa_inativa'),
      `código inesperado: ${erro?.code} / ${erro?.detail}`,
    ).toBe(true);
    expect(await credenciais(SUSPENSA)).toHaveLength(0);
  });

  it('empresa inexistente: P0002 sobe cru, no GET e nas escritas (a apps/api mapeia para 404)', async () => {
    const nenhuma = randomUUID();
    await expect(chamar('GET', C.ler, { params: { id: nenhuma } })).rejects.toMatchObject({ code: 'P0002' });
    await expect(chamar('PUT', C.credencial, { params: { id: nenhuma }, corpo: ENTRADA })).rejects.toMatchObject({ code: 'P0002' });
    await expect(chamar('POST', C.testar, { params: { id: nenhuma } })).rejects.toMatchObject({ code: 'P0002' });
  });
});
