/**
 * Rotas `/v1/integracao-fdv` (C-7) contra o PostgreSQL real, no papel macuxierp_app e com RLS, na mesma ordem de checagem da
 * API (`executarAutorizado`: sessão, perfil, tenant, licença) e com a mesma montagem de contexto (outbox, auditoria).
 * A chave do conector nunca pode aparecer em resposta, evento, auditoria nem log. Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import {
  ErroApi, OMITIDO, corpoErroApi, criarEvento, decifrarCampo, executarAutorizado, eventoDoModulo,
  PERFIS, pode, type Perfil, type RespostaRota, type Sessao, type PluginModulo,
} from '@macuxierp/platform-sdk';
import { AuditoriaPg, LicencasPg, OutboxPg, FilaDeTrabalhosPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { auditar } from '@macuxierp/platform-sdk';
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ENTIDADES_CARGA_INICIAL, ENTIDADES_HUB_F2 } from '../contracts';
import { CHAVE_CLARA, CHAVE_MESTRA, U, admSql, criarCredencial, cursorEntidade, espelho, hubDuble, ok, payloadProduto, ciclo } from './apoio-conector-teste';
import { criarAgendaConector } from './agenda-conector';
import { criarPluginIntegracaoFdv } from './index';

const AGORA = new Date('2026-11-22T10:00:00.000Z');
const CHAVE_NOVA = 'nova-chave-secreta-0123456789abcdef-NAO-VAZAR-2';
const ENTIDADES = ['filial', 'produto'];

describe.skipIf(!PG_DISPONIVEL)('rotas /v1/integracao-fdv no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let worker: BancoPg;
  let A: string;
  let B: string;
  let C: string;
  let adm: ReturnType<typeof admSql>;
  let plugin: PluginModulo;
  const CHAVES_EXTRAS = [`${CHAVE_NOVA}-pausa`, `${CHAVE_NOVA}-conc-1`, `${CHAVE_NOVA}-conc-2`];
  const saidasDeLog: string[] = [];
  const respostas: string[] = [];

  const sessao = (tenant: string, perfil: Perfil = 'administrador'): Sessao => ({ usuario_id: U(), tenant_id: tenant, perfil, filial_ids: [] });

  /** Uma chamada = uma transação do tenant, como a API faz; devolve status e corpo (ou o erro da API). */
  async function chamar(tenant: string, metodo: string, caminho: string, o: { perfil?: Perfil; corpo?: unknown; consulta?: Record<string, unknown>; semSessao?: boolean } = {}) {
    const partes = caminho.split('/').filter(Boolean);
    const rota = plugin.rotas.find((r) => {
      if (r.metodo !== metodo) return false;
      const modelo = r.caminho.split('/').filter(Boolean);
      return modelo.length === partes.length && modelo.every((m, i) => m.startsWith(':') || m === partes[i]);
    });
    if (!rota) throw new Error(`sem rota ${metodo} ${caminho}`);
    const modelo = rota.caminho.split('/').filter(Boolean);
    const params = Object.fromEntries(modelo.flatMap((m, i) => (m.startsWith(':') ? [[m.slice(1), partes[i]!]] : [])));
    const exatas = plugin.rotas.find((r) => r.metodo === metodo && r.caminho === caminho);
    const escolhida = exatas ?? rota;
    try {
      const r = await executarAutorizado<{ resposta: RespostaRota }>({
        sessao: o.semSessao ? null : sessao(tenant, o.perfil),
        acao: escolhida.acao,
        agora: AGORA,
        banco: app,
        licencas: new LicencasPg(),
        executar: async (tx, s) => {
          const corpo = escolhida.corpo ? escolhida.corpo.safeParse(o.corpo) : null;
          if (corpo && !corpo.success) throw new ErroApi(400, 'VALIDACAO', 'Dados inválidos', Object.fromEntries(corpo.error.issues.map((i) => [i.path.join('.'), 'inválido'])));
          const consulta = escolhida.consulta ? escolhida.consulta.safeParse(o.consulta ?? {}) : null;
          if (consulta && !consulta.success) throw new ErroApi(400, 'VALIDACAO', 'Dados inválidos', {});
          const ctx = {
            sessao: s, tx, request_id: 'req-teste', agora: AGORA,
            publicar: async (e: { nome: string; agregado_id: string; payload: Record<string, unknown> }) => {
              if (!eventoDoModulo('integracao-fdv', e.nome)) throw new Error('evento de outro módulo');
              const ev = criarEvento({ ...e, tenant_id: s.tenant_id, ator: s.usuario_id, request_id: 'req-teste' }, AGORA);
              return { ...ev, versao: await new OutboxPg().gravar(tx, ev) };
            },
            auditar: async (d: Parameters<typeof auditar>[3]) => void (await auditar(new AuditoriaPg(), tx, { tenant_id: s.tenant_id, usuario_id: s.usuario_id, request_id: 'req-teste' }, d, AGORA)),
            enfileirar: async (p: { tipo: string; payload: Record<string, unknown> }) => new FilaDeTrabalhosPg().enfileirar(tx, { ...p, tenant_id: s.tenant_id }),
          };
          const resposta = await escolhida.executar(ctx, { corpo: corpo?.data, consulta: consulta?.data, params, cabecalhos: {}, arquivos: {}, todosArquivos: {} });
          return { resposta };
        },
      });
      const out = { status: r.resposta.status ?? 200, corpo: r.resposta.corpo as any, cabecalhos: r.resposta.cabecalhos }; // eslint-disable-line @typescript-eslint/no-explicit-any
      respostas.push(JSON.stringify(out));
      return out;
    } catch (e) {
      if (e instanceof ErroApi) {
        const out = { status: e.status, corpo: corpoErroApi(e) as any, cabecalhos: undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any
        respostas.push(JSON.stringify(out));
        return out;
      }
      throw e;
    }
  }

  const credenciais = (t: string) => adm('SELECT id, conector_id, ambiente, chave_prefixo, chave_mestra_versao, substituida_em, criada_por, entidades_habilitadas::text[] AS ent, limite_registros_lote FROM integracao_fdv.credencial WHERE tenant_id = $1 ORDER BY created_at, id', [t]);
  const eventos = (t: string) => adm('SELECT nome, payload FROM plataforma.evento WHERE tenant_id = $1 AND nome LIKE $2 ORDER BY ocorrido_em, id', [t, 'integracao-fdv.%']);
  const novaCredencial = { conector_id: 'erp-1', chave: CHAVE_NOVA, ambiente: 'teste' };

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    app = efemero.banco('macuxierp_app');
    worker = efemero.banco('macuxierp_worker');
    // PENDÊNCIA com o banco-dados: o app ainda não tem UPDATE nas colunas de agenda do `sinal` (0007 só dá INSERT). Pedido enviado;
    // até a migração, o teste concede o mesmo que o pedido descreve.
    A = await criarTenant(efemero.admin, 'rotas-a', ['integracao-fdv']);
    B = await criarTenant(efemero.admin, 'rotas-b', ['integracao-fdv']);
    C = await criarTenant(efemero.admin, 'rotas-c', []);
    plugin = criarPluginIntegracaoFdv({ chaveMestra: CHAVE_MESTRA, chaveVersao: 1 });
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void saidasDeLog.push(a.map(String).join(' ')));
  });
  afterEach(() => undefined);
  afterAll(async () => {
    vi.restoreAllMocks();
    await efemero?.remover();
  });

  describe('perfil, tenant e licença (regra 6, RN-CORE-02)', () => {
    const leituras: [string, string][] = [['GET', '/monitor'], ['GET', '/lotes'], ['GET', '/lotes/exportar'], ['GET', `/lotes/${U()}/erros`]];
    const escritas: [string, string, unknown?][] = [
      ['PUT', '/credencial', novaCredencial], ['POST', '/credencial/testar'], ['PUT', '/configuracao', { entidades_habilitadas: ENTIDADES, limite_registros_lote: 100 }],
      ['POST', '/entidades/produto/carga-completa'], ['POST', '/entidades/produto/retomar'],
    ];
    it('RN-CORE-02: sem sessão é 401', async () => {
      expect((await chamar(A, 'GET', '/monitor', { semSessao: true })).status).toBe(401);
    });
    it('RN-CORE-01: o perfil que `pode` a ação integracao-fdv.ver vê o monitor e os lotes; o que não pode leva 403', async () => {
      for (const perfil of PERFIS) {
        for (const [m, c] of leituras.slice(0, 2)) expect((await chamar(A, m, c, { perfil })).status, `${perfil} ${c}`).toBe(pode(perfil, 'integracao-fdv.ver') ? 200 : 403);
      }
      // a matriz vem do SDK (`ver` = todos os perfis; o menu só aparece para os perfis do manifest): aqui só se prova que a rota a segue
      expect(pode('administrador', 'integracao-fdv.ver') && pode('gerente', 'integracao-fdv.ver') && pode('leitura', 'integracao-fdv.ver')).toBe(true);
    });
    it('RF-INF-05: só o administrador configura: gerente e leitura levam 403 PERFIL_SEM_PERMISSAO e nada muda', async () => {
      for (const perfil of ['gerente', 'leitura'] as Perfil[]) {
        for (const [m, c, corpo] of escritas) expect(await chamar(A, m, c, { perfil, corpo }), `${perfil} ${m} ${c}`).toMatchObject({ status: 403, corpo: { codigo: 'PERFIL_SEM_PERMISSAO' } });
      }
      expect(await credenciais(A)).toHaveLength(0);
    });
    it('RN-CORE-02: sem a licença do módulo, toda rota dá 403 MODULO_INATIVO e nada é gravado', async () => {
      for (const [m, c, corpo] of [...leituras, ...escritas]) expect(await chamar(C, m, c, { corpo }), `${m} ${c}`).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
      expect(await credenciais(C)).toHaveLength(0);
    });
  });

  describe('PUT /credencial (RF-INF-05)', () => {
    it('RF-INF-05: chave curta, com espaço ou conector inválido é 400 e a resposta não repete a chave', async () => {
      const curta = await chamar(A, 'PUT', '/credencial', { corpo: { ...novaCredencial, chave: 'curta-demais-123' } });
      expect(curta.status).toBe(400);
      expect(JSON.stringify(curta.corpo)).not.toContain('curta-demais-123');
      expect((await chamar(A, 'PUT', '/credencial', { corpo: { ...novaCredencial, conector_id: 'com espaço' } })).status).toBe(400);
      expect(await credenciais(A)).toHaveLength(0);
    });

    it('RF-INF-05: a primeira credencial cifra a chave (AES-256-GCM, tenant como dado associado), guarda só o prefixo, cria o sinal e pede a carga inicial (C-4)', async () => {
      const r = await chamar(A, 'PUT', '/credencial', { corpo: novaCredencial });
      expect(r.status).toBe(201);
      expect(r.corpo).toMatchObject({ conector_id: 'erp-1', ambiente: 'teste', chave_prefixo: CHAVE_NOVA.slice(0, 8), ultimo_uso_em: null });
      expect(Object.keys(r.corpo).sort()).toEqual(['ambiente', 'chave_prefixo', 'conector_id', 'criada_em', 'id', 'ultimo_uso_em']);
      const [c] = await credenciais(A);
      expect(c).toMatchObject({ chave_prefixo: CHAVE_NOVA.slice(0, 8), chave_mestra_versao: 1, substituida_em: null, criada_por: expect.any(String), ent: [...ENTIDADES_HUB_F2], limite_registros_lote: 5000 });
      // o banco guarda cifrado: o worker abre com a chave mestra e o tenant certos; com o tenant de outro, não abre
      const [linha] = await worker.comTenant(A, (tx) => tx.consultar<{ chave_cifrada: Uint8Array }>('SELECT chave_cifrada FROM integracao_fdv.credencial WHERE tenant_id = $1 AND substituida_em IS NULL', [A]));
      expect(Buffer.from(linha!.chave_cifrada).includes(Buffer.from(CHAVE_NOVA))).toBe(false);
      expect(decifrarCampo({ chave: CHAVE_MESTRA, tenantId: A, cifrado: linha!.chave_cifrada }).toString('utf8')).toBe(CHAVE_NOVA);
      expect(() => decifrarCampo({ chave: CHAVE_MESTRA, tenantId: B, cifrado: linha!.chave_cifrada })).toThrow();
      // sinal: as 4 colunas de agenda saem do agora (a reconciliação, do próximo 06h00 UTC)
      const [s] = await adm('SELECT proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [A]);
      expect(s).toMatchObject({ proximo_sinal_em: AGORA, proxima_busca_pedidos_em: AGORA, proximo_retorno_em: null });
      expect(new Date(s!.proxima_reconciliacao_em).toISOString()).toBe('2026-11-23T06:00:00.000Z');
      // C-4
      const ev = await eventos(A);
      expect(ev.map((e) => e.nome)).toEqual(['integracao-fdv.carga_inicial.solicitada@1']);
      expect(ev[0]!.payload.payload).toEqual({ entidades: [...ENTIDADES_CARGA_INICIAL] });
      // auditoria sem a chave
      const [a] = await adm("SELECT acao, entidade, depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao LIKE 'integracao-fdv.credencial.%'", [A]);
      expect(a).toMatchObject({ acao: 'integracao-fdv.credencial.criar', entidade: 'credencial', depois: { conector_id: 'erp-1', ambiente: 'teste' } });
      expect(JSON.stringify(a)).not.toContain(OMITIDO);
    });

    it('RF-INF-05: sem a chave mestra do servidor (null) o PUT responde 503 com mensagem fixa e nada é gravado; as leituras seguem', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-sc', ['integracao-fdv']);
      const original = plugin;
      plugin = criarPluginIntegracaoFdv({ chaveMestra: null });
      try {
        const r = await chamar(t, 'PUT', '/credencial', { corpo: novaCredencial });
        expect(r).toMatchObject({ status: 503, corpo: { codigo: 'CHAVE_INTEGRACAO_AUSENTE' } });
        expect(JSON.stringify(r.corpo)).not.toContain(CHAVE_NOVA);
        expect(await credenciais(t)).toHaveLength(0);
        expect((await chamar(t, 'GET', '/monitor')).status).toBe(200);
      } finally {
        plugin = original;
      }
    });

    it('RF-INF-05: duas trocas simultâneas se serializam pela linha de sinal: uma cria (201), a outra troca (200), uma só ativa e nenhum 500', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-cc', ['integracao-fdv']);
      const [x, y] = await Promise.all(CHAVES_EXTRAS.slice(1).map((k) => chamar(t, 'PUT', '/credencial', { corpo: { ...novaCredencial, chave: k } })));
      expect([x!.status, y!.status].sort()).toEqual([200, 201]);
      const cs = await credenciais(t);
      expect(cs).toHaveLength(2);
      expect(cs.filter((c) => c.substituida_em === null)).toHaveLength(1);
      expect(await adm('SELECT 1 FROM integracao_fdv.sinal WHERE tenant_id = $1', [t])).toHaveLength(1);
    });

    it('RF-INF-05: a chave nova limpa só a pausa por credencial recusada, antecipa o envio e audita (sem a chave)', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-p', ['integracao-fdv']);
      expect((await chamar(t, 'PUT', '/credencial', { corpo: novaCredencial })).status).toBe(201);
      const futuro = new Date('2026-12-01T00:00:00Z');
      for (const e of ['produto', 'cliente']) await cursorEntidade(efemero.admin, t, e, { proximoEm: futuro });
      await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'credencial', pausada_em = $2 WHERE tenant_id = $1 AND entidade = 'produto'", [t, AGORA]);
      await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'topologia', pausada_em = $2 WHERE tenant_id = $1 AND entidade = 'cliente'", [t, AGORA]);
      expect((await chamar(t, 'PUT', '/credencial', { corpo: { ...novaCredencial, chave: CHAVES_EXTRAS[0]! } })).status).toBe(200);
      const cur = await adm('SELECT entidade, pausada_motivo, pausada_em, proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 ORDER BY entidade', [t]);
      expect(cur.find((x) => x.entidade === 'produto')).toMatchObject({ pausada_motivo: null, pausada_em: null, proximo_em: AGORA });
      expect(cur.find((x) => x.entidade === 'cliente')).toMatchObject({ pausada_motivo: 'topologia' });
      expect(new Date(cur.find((x) => x.entidade === 'cliente')!.proximo_em).toISOString()).toBe(futuro.toISOString());
      const aud = await adm("SELECT antes, depois FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.credencial.liberar_pausa'", [t]);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({ antes: { pausada_motivo: 'credencial', entidades: ['produto'] }, depois: { pausada_motivo: null } });
      // sem pausa por credencial, nada a limpar e nada a auditar
      expect((await chamar(t, 'PUT', '/credencial', { corpo: { ...novaCredencial, chave: CHAVES_EXTRAS[0]! } })).status).toBe(200);
      expect(await adm("SELECT 1 FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.credencial.liberar_pausa'", [t])).toHaveLength(1);
    });

    it('RF-INF-05: trocar só a chave cria linha nova, marca a anterior como substituída, copia a configuração e não zera o espelho nem pede carga', async () => {
      await adm('UPDATE integracao_fdv.credencial SET entidades_habilitadas = $2::integracao_fdv.entidade_hub[], limite_registros_lote = 777 WHERE tenant_id = $1', [A, ENTIDADES]);
      await espelho(efemero.admin, A, 'produto', payloadProduto('P-ROT'), { confirmado: true });
      const antes = await eventos(A);
      const r = await chamar(A, 'PUT', '/credencial', { corpo: { ...novaCredencial, chave: `${CHAVE_NOVA}-rotacionada` } });
      expect(r.status).toBe(200);
      const cs = await credenciais(A);
      expect(cs).toHaveLength(2);
      expect(cs[0]!.substituida_em).not.toBeNull();
      expect(cs[1]).toMatchObject({ substituida_em: null, ent: ENTIDADES, limite_registros_lote: 777 });
      const [e] = await adm("SELECT hash_confirmado FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = 'P-ROT'", [A]);
      expect(e!.hash_confirmado).not.toBeNull();
      expect(await eventos(A)).toHaveLength(antes.length);
    });

    it('RF-INF-05: trocar o conector zera cursor e confirmação do espelho (só onde há payload), antecipa o envio e pede a carga inicial', async () => {
      const tabela = U();
      await cursorEntidade(efemero.admin, A, 'produto', { proximoEm: new Date('2026-12-01T00:00:00Z'), cursor: { em: new Date('2026-11-20T00:00:00Z'), id: 'P-ROT' } });
      await adm('UPDATE integracao_fdv.cursor_entidade SET sessao_aberta_id = $2 WHERE tenant_id = $1 AND entidade = $3', [A, tabela, 'produto']);
      // linha inativa com payload anulado e confirmada: o CHECK exige hash_confirmado; a troca não pode tocá-la
      await adm(
        `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, ativo, pendente, hash_confirmado, confirmado_em)
         VALUES ($1, 'produto', 'P-VELHO', NULL, $2, $3, $3, false, false, $2, $3)`,
        [A, 'a'.repeat(64), AGORA],
      );
      const antes = (await eventos(A)).length;
      const r = await chamar(A, 'PUT', '/credencial', { corpo: { conector_id: 'outro-erp', chave: `${CHAVE_NOVA}-outro`, ambiente: 'teste' } });
      expect(r.status).toBe(200);
      const [cur] = await adm("SELECT cursor_alterado_em, cursor_external_id, sessao_aberta_id, proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'produto'", [A]);
      expect(cur).toMatchObject({ cursor_alterado_em: null, cursor_external_id: null, sessao_aberta_id: null, proximo_em: AGORA });
      const reg = await adm("SELECT registro_external_id, hash_confirmado, confirmado_em FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id IN ('P-ROT', 'P-VELHO') ORDER BY 1", [A]);
      expect(reg).toMatchObject([{ registro_external_id: 'P-ROT', hash_confirmado: null, confirmado_em: null }, { registro_external_id: 'P-VELHO', hash_confirmado: 'a'.repeat(64) }]);
      const ev = await eventos(A);
      expect(ev).toHaveLength(antes + 1);
      expect(ev.at(-1)!.payload.payload).toEqual({ entidades: [...ENTIDADES_CARGA_INICIAL] });
      // troca de ambiente (mesmo conector) também zera
      await adm("UPDATE integracao_fdv.registro_publicado SET hash_confirmado = hash, confirmado_em = $2 WHERE tenant_id = $1 AND registro_external_id = 'P-ROT'", [A, AGORA]);
      expect((await chamar(A, 'PUT', '/credencial', { corpo: { conector_id: 'outro-erp', chave: `${CHAVE_NOVA}-prod`, ambiente: 'producao' } })).status).toBe(200);
      const [rot] = await adm("SELECT hash_confirmado FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = 'P-ROT'", [A]);
      expect(rot!.hash_confirmado).toBeNull();
    });

    it('RF-INF-05: a chave nunca aparece em resposta, evento, auditoria nem log', async () => {
      const chaves = [...CHAVES_EXTRAS, CHAVE_NOVA, `${CHAVE_NOVA}-rotacionada`, `${CHAVE_NOVA}-outro`, `${CHAVE_NOVA}-prod`, 'curta-demais-123'];
      const tudo = JSON.stringify([
        respostas,
        await adm('SELECT * FROM plataforma.evento WHERE tenant_id = $1', [A]),
        await adm('SELECT * FROM plataforma.auditoria WHERE tenant_id = $1', [A]),
        await adm('SELECT * FROM plataforma.trabalho WHERE tenant_id = $1', [A]),
        saidasDeLog,
      ]);
      for (const k of chaves) expect(tudo).not.toContain(k);
      // nem o prefixo em evento ou auditoria
      expect(JSON.stringify([await adm('SELECT payload FROM plataforma.evento WHERE tenant_id = $1', [A]), await adm('SELECT antes, depois FROM plataforma.auditoria WHERE tenant_id = $1', [A])])).not.toContain(CHAVE_NOVA.slice(0, 8));
    });

    it('RN-CORE-05 / multi-tenant: a credencial do tenant A não aparece no tenant B', async () => {
      expect((await chamar(B, 'GET', '/monitor')).corpo.credencial).toBeNull();
      expect(await credenciais(B)).toHaveLength(0);
    });
  });

  describe('privilégios do papel macuxierp_app na agenda do sinal (migração 0022)', () => {
    it('0022: PUT /credencial e POST /credencial/testar rodam como macuxierp_app sem o GRANT do beforeAll', async () => {
      const sem = await criarBancoEfemero();
      const appDoArnes = app;
      try {
        const colunas = ['proximo_sinal_em', 'proxima_reconciliacao_em', 'proxima_busca_pedidos_em', 'proximo_retorno_em'];
        const r = await sem.admin.query(
          "SELECT c, has_column_privilege('macuxierp_app', 'integracao_fdv.sinal', c, 'UPDATE') AS ok FROM unnest($1::text[]) AS c",
          [colunas],
        );
        const faltam = r.rows.filter((x) => !x.ok).map((x) => x.c);
        expect(faltam, `A migração 0022 deve conceder UPDATE em integracao_fdv.sinal (${faltam.join(', ')}) ao macuxierp_app`).toEqual([]);
        const t = await criarTenant(sem.admin, 'rotas-0022', ['integracao-fdv']);
        app = sem.banco('macuxierp_app');
        expect((await chamar(t, 'PUT', '/credencial', { corpo: { ...novaCredencial, chave: `${CHAVE_NOVA}-0022` } })).status).toBe(201);
        expect((await chamar(t, 'POST', '/credencial/testar')).status).toBe(202);
      } finally {
        app = appDoArnes;
        await sem.remover();
      }
    }, 60_000);
  });

  describe('GET /monitor (RF-INF-04)', () => {
    it('RF-INF-04: sem credencial o monitor vem vazio, com as 10 entidades da F2', async () => {
      const r = await chamar(B, 'GET', '/monitor');
      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ credencial: null, configuracao: null, sinal: null, erros: [], conflitos: [] });
      expect(r.corpo.entidades.map((e: { entidade: string }) => e.entidade)).toEqual([...ENTIDADES_HUB_F2]);
    });

    it('RF-INF-04 / RN-INF-04: mostra envio, sucesso, pendentes, pausa com texto do catálogo, erros por linha sem mensagem crua, conflitos, sinal e configuração', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-m', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      await adm('UPDATE integracao_fdv.credencial SET entidades_habilitadas = $2::integracao_fdv.entidade_hub[], limite_registros_lote = 250 WHERE id = $1', [cred, ['produto', 'cliente']]);
      await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred });
      await adm("UPDATE integracao_fdv.cursor_entidade SET ultimo_envio_em = $2, ultimo_sucesso_em = $3, pausada_motivo = 'credencial', pausada_em = $2 WHERE tenant_id = $1 AND entidade = 'produto'", [t, new Date('2026-11-22T09:50:00Z'), new Date('2026-11-22T09:40:00Z')]);
      await espelho(efemero.admin, t, 'produto', payloadProduto('P1'));
      await espelho(efemero.admin, t, 'produto', payloadProduto('P2'));
      await espelho(efemero.admin, t, 'produto', payloadProduto('P3'), { confirmado: true });
      const [lote] = await adm(
        `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, concluido_em, contagens, ultimo_erro_codigo)
         VALUES ($1, 'produto', $2, 'delta', $3, 'falhou', $4, '{"registros": 3}', 'rede') RETURNING id`,
        [t, cred, 'b'.repeat(64), AGORA],
      );
      await adm(
        `INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo, campo) VALUES
           ($1, $2, 0, 'hub', 'produto', 'P1', 'campo_obrigatorio', 'nome'),
           ($1, $2, 1, 'erp', 'produto', 'P2', 'codigo_que_nao_existe_no_catalogo', NULL)`,
        [t, lote!.id],
      );
      await adm("INSERT INTO integracao_fdv.conflito_chave (tenant_id, entidade, erp_id, chave, codigo) VALUES ($1, 'produto', $2, 'P9', 'chave_duplicada')", [t, U()]);
      await adm("INSERT INTO integracao_fdv.sinal (tenant_id, ultimo_envio_em, ultimo_aceito_em, ultimo_http, politica_versao) VALUES ($1, $2, $2, 200, '{\"minima\": \"1.4.0\"}')", [t, AGORA]);

      const r = await chamar(t, 'GET', '/monitor', { perfil: 'leitura' });
      expect(r.status).toBe(200);
      const p = r.corpo.entidades.find((e: { entidade: string }) => e.entidade === 'produto');
      expect(p).toMatchObject({ habilitada: true, pendentes: 2, situacao: 'pausada', pausada_motivo: 'credencial', erros_abertos: 2, ultimo_envio_em: '2026-11-22T09:50:00.000Z', ultimo_sucesso_em: '2026-11-22T09:40:00.000Z' });
      expect(p.pausada_mensagem).toContain('Credencial recusada');
      expect(r.corpo.entidades.find((e: { entidade: string }) => e.entidade === 'filial')).toMatchObject({ habilitada: false, situacao: 'ok', pendentes: 0 });
      expect(r.corpo.configuracao).toEqual({ entidades_habilitadas: ['produto', 'cliente'], limite_registros_lote: 250 });
      expect(r.corpo.sinal).toMatchObject({ ultimo_aceito_em: AGORA.toISOString(), ultimo_http: 200, parado_por_versao: false, politica_versao: { minima: '1.4.0' } });
      expect(r.corpo.erros).toHaveLength(2);
      const e0 = r.corpo.erros.find((e: { registro_external_id: string }) => e.registro_external_id === 'P1');
      expect(e0).toMatchObject({ codigo: 'campo_obrigatorio', campo: 'nome', origem: 'hub', entidade: 'produto' });
      expect(e0.mensagem).toContain('Campo obrigatório vazio');
      const e1 = r.corpo.erros.find((e: { registro_external_id: string }) => e.registro_external_id === 'P2');
      expect(e1.mensagem).toContain('Erro não catalogado');
      expect(r.corpo.conflitos).toMatchObject([{ entidade: 'produto', chave: 'P9', codigo: 'chave_duplicada' }]);
      expect(r.corpo.conflitos[0].mensagem).toContain('Outro cadastro');
      expect(JSON.stringify(r.corpo)).not.toContain('chave_cifrada');
      // multi-tenant: nem os erros, nem os lotes, nem o lote por id aparecem em outro tenant
      expect((await chamar(A, 'GET', '/monitor')).corpo).toMatchObject({ erros: [], conflitos: [] });
      expect((await chamar(A, 'GET', '/lotes')).corpo.itens.some((l: { id: string }) => l.id === lote!.id)).toBe(false);
      expect(await chamar(A, 'GET', `/lotes/${lote!.id}/erros`)).toMatchObject({ status: 404 });
    });
  });

  describe('GET /lotes e /lotes/:id/erros', () => {
    it('RF-INF-04: lista do mais novo ao mais antigo, com filtros na URL, cursor, mensagem do catálogo e CSV com as colunas da página', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-l', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      const ids: string[] = [];
      for (const [i, estado] of ['concluido', 'falhou', 'concluido_com_erros'].entries()) {
        const [l] = await adm(
          `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, concluido_em, contagens, ultimo_erro_codigo, created_at, hub_lote_id)
           VALUES ($1, $2, $3, 'delta', $4, $5, $6, $7::jsonb, $8, $9, $10) RETURNING id`,
          [t, i === 1 ? 'cliente' : 'produto', cred, String(i).repeat(64), estado, AGORA, JSON.stringify({ registros: 5, hub: { recebidas: 5, com_erro: i === 2 ? 2 : 0 } }), estado === 'falhou' ? 'rede' : null, new Date(AGORA.getTime() + i * 1000), estado === 'falhou' ? null : U()],
        );
        ids.push(l!.id);
      }
      const todos = await chamar(t, 'GET', '/lotes');
      expect(todos.corpo.itens.map((l: { id: string }) => l.id)).toEqual([...ids].reverse());
      expect(todos.corpo.itens[0]).toMatchObject({ estado: 'concluido_com_erros', registros: 5, aceitos: 3, com_erro: 2 });
      expect(todos.corpo.itens[1]).toMatchObject({ estado: 'falhou', ultimo_erro_codigo: 'rede' });
      expect(todos.corpo.itens[1].ultimo_erro_mensagem).toContain('Sem resposta do FDV');
      const pag1 = await chamar(t, 'GET', '/lotes', { consulta: { limite: '2' } });
      expect(pag1.corpo.itens).toHaveLength(2);
      const pag2 = await chamar(t, 'GET', '/lotes', { consulta: { limite: '2', cursor: pag1.corpo.proximo_cursor } });
      expect(pag2.corpo.itens.map((l: { id: string }) => l.id)).toEqual([ids[0]]);
      expect(pag2.corpo.proximo_cursor).toBeNull();
      expect((await chamar(t, 'GET', '/lotes', { consulta: { entidade: 'cliente' } })).corpo.itens).toHaveLength(1);
      expect((await chamar(t, 'GET', '/lotes', { consulta: { estado: 'falhou', entidade: 'produto' } })).corpo.itens).toHaveLength(0);
      expect((await chamar(t, 'GET', '/lotes', { consulta: { estado: 'inventado' } })).status).toBe(400);
      const csv = await chamar(t, 'GET', '/lotes/exportar');
      expect(csv.cabecalhos).toMatchObject({ 'content-type': 'text/csv; charset=utf-8' });
      expect(String(csv.corpo).split('\r\n')[0]).toContain('Situação');
      expect(String(csv.corpo)).toContain('Concluído com erros');
      expect(String(csv.corpo)).not.toContain(CHAVE_CLARA);
      // erros do lote: ordem por índice, paginados, sem valor
      for (let i = 0; i < 3; i++) await adm("INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo) VALUES ($1, $2, $3, 'hub', 'produto', $4, 'campo_invalido')", [t, ids[2], i, `P${i}`]);
      const e1 = await chamar(t, 'GET', `/lotes/${ids[2]}/erros`, { consulta: { limite: '2' } });
      expect(e1.corpo.itens.map((e: { indice: number }) => e.indice)).toEqual([0, 1]);
      const e2 = await chamar(t, 'GET', `/lotes/${ids[2]}/erros`, { consulta: { limite: '2', cursor: e1.corpo.proximo_cursor } });
      expect(e2.corpo.itens.map((e: { indice: number }) => e.indice)).toEqual([2]);
      expect(e2.corpo.itens[0].mensagem).toContain('formato inválido');
      expect((await chamar(t, 'GET', `/lotes/${U()}/erros`)).status).toBe(404);
      expect((await chamar(t, 'GET', '/lotes/nao-e-uuid/erros')).status).toBe(400);
    });
  });

  describe('PUT /configuracao', () => {
    it('RN-INF-02: sem credencial é 409; limite fora de 1 a 5.000 e entidade fora da F2 são 400', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-c0', ['integracao-fdv']);
      expect((await chamar(t, 'PUT', '/configuracao', { corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 10 } })).status).toBe(409);
      expect((await chamar(A, 'PUT', '/configuracao', { corpo: { entidades_habilitadas: ['filial'], limite_registros_lote: 5001 } })).status).toBe(400);
      expect((await chamar(A, 'PUT', '/configuracao', { corpo: { entidades_habilitadas: ['nota'], limite_registros_lote: 10 } })).status).toBe(400);
    });

    it('RN-INF-02: grava a configuração na credencial ativa, audita e antecipa só o envio das entidades recém-habilitadas', async () => {
      await adm("UPDATE integracao_fdv.credencial SET entidades_habilitadas = '{filial}' WHERE tenant_id = $1 AND substituida_em IS NULL", [A]);
      await cursorEntidade(efemero.admin, A, 'produto', { proximoEm: new Date('2026-12-01T00:00:00Z') });
      await cursorEntidade(efemero.admin, A, 'filial', { proximoEm: new Date('2026-12-01T00:00:00Z') });
      const r = await chamar(A, 'PUT', '/configuracao', { corpo: { entidades_habilitadas: ['filial', 'produto'], limite_registros_lote: 321 } });
      expect(r.status).toBe(200);
      expect(r.corpo).toEqual({ entidades_habilitadas: ['filial', 'produto'], limite_registros_lote: 321 });
      const [c] = await adm('SELECT entidades_habilitadas::text[] AS e, limite_registros_lote FROM integracao_fdv.credencial WHERE tenant_id = $1 AND substituida_em IS NULL', [A]);
      expect(c).toMatchObject({ e: ['filial', 'produto'], limite_registros_lote: 321 });
      const cur = await adm('SELECT entidade, proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 ORDER BY entidade', [A]);
      expect(cur.find((x) => x.entidade === 'produto')!.proximo_em).toEqual(AGORA);
      expect(new Date(cur.find((x) => x.entidade === 'filial')!.proximo_em).toISOString()).toBe('2026-12-01T00:00:00.000Z');
      // habilitar entidade sem linha de cursor cria a linha, já devida
      await chamar(A, 'PUT', '/configuracao', { corpo: { entidades_habilitadas: ['filial', 'produto', 'cliente'], limite_registros_lote: 321 } });
      expect((await adm("SELECT proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'cliente'", [A]))[0]!.proximo_em).toEqual(AGORA);
      expect(await adm("SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.configuracao.alterar'", [A])).toHaveLength(2);
    });
  });

  describe('carga completa, retomar e testar (A)', () => {
    it('RN-INF-04: carga completa abre sessão nova, zera o cursor local, antecipa o envio e audita', async () => {
      await cursorEntidade(efemero.admin, A, 'produto', { proximoEm: new Date('2026-12-01T00:00:00Z'), cursor: { em: new Date('2026-11-20T00:00:00Z'), id: 'P-1' } });
      const r = await chamar(A, 'POST', '/entidades/produto/carga-completa');
      expect(r.status).toBe(202);
      const [cur] = await adm("SELECT cursor_alterado_em, cursor_external_id, sessao_aberta_id, proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'produto'", [A]);
      expect(cur).toMatchObject({ cursor_alterado_em: null, cursor_external_id: null, proximo_em: AGORA });
      expect(cur!.sessao_aberta_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await adm("SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.entidade.carga_completa'", [A])).toHaveLength(1);
      // carga repetida com a sessão aberta e sem lote em voo: continua a mesma sessão (coalesce), com o cursor da sessão como está
      const primeira = cur!.sessao_aberta_id;
      await adm("UPDATE integracao_fdv.cursor_entidade SET cursor_alterado_em = $2, cursor_external_id = 'P-9' WHERE tenant_id = $1 AND entidade = 'produto'", [A, new Date('2026-11-21T00:00:00Z')]);
      expect((await chamar(A, 'POST', '/entidades/produto/carga-completa')).status).toBe(202);
      expect((await adm("SELECT sessao_aberta_id, cursor_external_id FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'produto'", [A]))[0]).toMatchObject({ sessao_aberta_id: primeira, cursor_external_id: 'P-9' });
    });

    it('RN-INF-04: carga completa recusa entidade desabilitada (422), lote em voo (409), entidade desconhecida (400) e tenant sem credencial (409)', async () => {
      expect(await chamar(A, 'POST', '/entidades/estoque/carga-completa')).toMatchObject({ status: 422, corpo: { codigo: 'RN-INF-02', detalhes: { codigo: 'entidade_desabilitada' } } });
      expect((await chamar(A, 'POST', '/entidades/nota/carga-completa')).status).toBe(400);
      expect((await chamar(A, 'POST', '/entidades/inventada/retomar')).status).toBe(400);
      const [cr] = await adm('SELECT id FROM integracao_fdv.credencial WHERE tenant_id = $1 AND substituida_em IS NULL', [A]);
      await adm(
        `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, sessao_id, sessao_parte, sessao_ultimo, chave_idempotencia, corpo, estado)
         VALUES ($1, 'filial', $2, 'completo', $3, 1, false, $4, '{"registros": []}', 'enviando')`,
        [A, cr!.id, U(), 'c'.repeat(64)],
      );
      expect(await chamar(A, 'POST', '/entidades/filial/carga-completa')).toMatchObject({ status: 409, corpo: { codigo: 'CONFLITO' } });
      // a recusa desfaz o upsert do cursor (que vem antes da conferência do lote em voo): nenhuma sessão nasce
      expect((await adm("SELECT sessao_aberta_id FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'filial'", [A]))[0]!.sessao_aberta_id).toBeNull();
      expect((await chamar(B, 'POST', '/entidades/filial/carga-completa')).status).toBe(409);
    });

    it('RN-INF-04: retomar limpa a pausa e antecipa o envio; sem pausa é idempotente; outro tenant não é afetado', async () => {
      await cursorEntidade(efemero.admin, A, 'cliente', { proximoEm: new Date('2026-12-01T00:00:00Z') });
      await cursorEntidade(efemero.admin, B, 'cliente', { proximoEm: new Date('2026-12-01T00:00:00Z') });
      for (const t of [A, B]) await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'topologia', pausada_em = $2 WHERE tenant_id = $1 AND entidade = 'cliente'", [t, AGORA]);
      const r = await chamar(A, 'POST', '/entidades/cliente/retomar');
      expect(r.status).toBe(200);
      const [a] = await adm("SELECT pausada_motivo, pausada_em, proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'cliente'", [A]);
      expect(a).toMatchObject({ pausada_motivo: null, pausada_em: null, proximo_em: AGORA });
      const [b] = await adm("SELECT pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'cliente'", [B]);
      expect(b!.pausada_motivo).toBe('topologia');
      expect((await chamar(A, 'POST', '/entidades/cliente/retomar')).status).toBe(200);
      expect(await adm("SELECT acao FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.entidade.retomar'", [A])).toHaveLength(1);
      expect((await chamar(B, 'POST', '/entidades/estoque/retomar')).status).toBe(200);
    });

    it('RF-INF-04: testar conexão responde 202, antecipa o sinal e a agenda do worker manda o POST /sinal com a credencial decifrada', async () => {
      // só o sinal vence: o resto da agenda do tenant fica no futuro, para o ciclo não tentar enviar lotes
      await adm("UPDATE integracao_fdv.sinal SET proximo_sinal_em = '2026-12-01T00:00:00Z', proxima_reconciliacao_em = '2026-12-01T00:00:00Z', proxima_busca_pedidos_em = NULL, proximo_retorno_em = NULL WHERE tenant_id = $1", [A]);
      await adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = '2026-12-01T00:00:00Z' WHERE tenant_id = $1", [A]);
      const r = await chamar(A, 'POST', '/credencial/testar');
      expect(r).toMatchObject({ status: 202, corpo: { aceito: true, pedido_em: AGORA.toISOString() } });
      expect((await adm('SELECT proximo_sinal_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [A]))[0]!.proximo_sinal_em).toEqual(AGORA);
      const hub = hubDuble({ 'POST /sinal': [ok({ politica_versao: { minima: '1.4.0' } })] });
      
      const agenda = criarAgendaConector({ outbox: new OutboxPg() });
      await ciclo(worker, agenda, hub, AGORA, [A]);
      expect(hub.chamadas.filter((c) => c.pedido.caminho === '/sinal')).toHaveLength(1);
      expect(hub.chamadas[0]!.cred).toMatchObject({ conectorId: 'outro-erp', chave: `${CHAVE_NOVA}-prod` });
      const [s] = await adm('SELECT ultimo_aceito_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [A]);
      expect(s!.ultimo_aceito_em).toEqual(AGORA);
      expect(await adm("SELECT 1 FROM plataforma.auditoria WHERE tenant_id = $1 AND acao = 'integracao-fdv.credencial.testar'", [A])).toHaveLength(1);
      expect((await chamar(B, 'POST', '/credencial/testar')).status).toBe(409);
    });
  });
});
