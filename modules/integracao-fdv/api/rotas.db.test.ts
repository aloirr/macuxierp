/**
 * Rotas `/v1/integracao-fdv` (C-7) contra o PostgreSQL real, no papel macuxierp_app e com RLS, na mesma ordem de checagem da
 * API (`executarAutorizado`: sessão, perfil, tenant, licença). Só leitura desde a T-0056: a escrita é do plugin de plataforma
 * (`plataforma.db.test.ts`). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import {
  ErroApi, corpoErroApi, criarEvento, executarAutorizado, eventoDoModulo,
  PERFIS, pode, type Perfil, type RespostaRota, type Sessao, type PluginModulo,
} from '@macuxierp/platform-sdk';
import { AuditoriaPg, LicencasPg, OutboxPg, FilaDeTrabalhosPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { auditar } from '@macuxierp/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTIDADES_HUB_F2 } from '../contracts';
import { CHAVE_CLARA, U, admSql, criarCredencial, cursorEntidade, espelho, payloadProduto } from './apoio-conector-teste';
import { criarPluginIntegracaoFdv } from './index';

const AGORA = new Date('2026-11-22T10:00:00.000Z');

describe.skipIf(!PG_DISPONIVEL)('rotas /v1/integracao-fdv no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let app: BancoPg;
  let A: string;
  let B: string;
  let C: string;
  let adm: ReturnType<typeof admSql>;
  let plugin: PluginModulo;

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
      return out;
    } catch (e) {
      if (e instanceof ErroApi) {
        const out = { status: e.status, corpo: corpoErroApi(e) as any, cabecalhos: undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any
          return out;
      }
      throw e;
    }
  }

  const credenciais = (t: string) => adm('SELECT id, conector_id, ambiente, chave_prefixo, chave_mestra_versao, substituida_em, criada_por, entidades_habilitadas::text[] AS ent, limite_registros_lote FROM integracao_fdv.credencial WHERE tenant_id = $1 ORDER BY created_at, id', [t]);

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    app = efemero.banco('macuxierp_app');
    // PENDÊNCIA com o banco-dados: o app ainda não tem UPDATE nas colunas de agenda do `sinal` (0007 só dá INSERT). Pedido enviado;
    // até a migração, o teste concede o mesmo que o pedido descreve.
    A = await criarTenant(efemero.admin, 'rotas-a', ['integracao-fdv']);
    B = await criarTenant(efemero.admin, 'rotas-b', ['integracao-fdv']);
    C = await criarTenant(efemero.admin, 'rotas-c', []);
    plugin = criarPluginIntegracaoFdv();
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  describe('perfil, tenant e licença (regra 6, RN-CORE-02)', () => {
    const leituras: [string, string][] = [['GET', '/monitor'], ['GET', '/lotes'], ['GET', '/lotes/exportar'], ['GET', `/lotes/${U()}/erros`]];
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
    it('RN-CORE-02: sem a licença do módulo, toda rota dá 403 MODULO_INATIVO e nada é gravado', async () => {
      for (const [m, c] of [...leituras, ['GET', '/status']]) expect(await chamar(C, m!, c!), `${m} ${c}`).toMatchObject({ status: 403, corpo: { codigo: 'MODULO_INATIVO' } });
      expect(await credenciais(C)).toHaveLength(0);
    });
  });

  describe('BKO só leitura (ADR 0013 seção 6, T-0056)', () => {
    it('RF-INF-04: GET /status sem credencial traz os 10 cadastros desligados, sem conector', async () => {
      const r = await chamar(B, 'GET', '/status', { perfil: 'leitura' });
      expect(r.status).toBe(200);
      expect(r.corpo).toMatchObject({ conector_id: null, ambiente: null, chave_prefixo: null, ultimo_sinal: null });
      expect(r.corpo.cadastros.map((c: { entidade: string; ligada: boolean }) => [c.entidade, c.ligada])).toEqual(ENTIDADES_HUB_F2.map((e) => [e, false]));
    });

    it('RF-INF-04: GET /status mostra ligada por cadastro, último envio, a falha por precedência e o último sinal, sem id da credencial nem chave', async () => {
      const t = await criarTenant(efemero.admin, 'rotas-s', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      await adm('UPDATE integracao_fdv.credencial SET entidades_habilitadas = $2::integracao_fdv.entidade_hub[], limite_registros_lote = 250 WHERE id = $1', [cred, ['produto', 'cliente']]);
      await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred });
      await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'credencial', pausada_em = $2 WHERE tenant_id = $1 AND entidade = 'produto'", [t, AGORA]);
      await adm(
        `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, enviado_em, concluido_em, contagens, ultimo_erro_codigo)
         VALUES ($1, 'cliente', $2, 'delta', $3, 'falhou', $4, $4, '{"registros": 1}', 'rede')`,
        [t, cred, 'c'.repeat(64), AGORA],
      );
      await adm("INSERT INTO integracao_fdv.sinal (tenant_id, ultimo_envio_em, ultimo_aceito_em, ultimo_http, politica_versao) VALUES ($1, $2, $2, 200, '{\"minima\": \"1.4.0\"}')", [t, AGORA]);
      const r = await chamar(t, 'GET', '/status', { perfil: 'leitura' });
      expect(r.status).toBe(200);
      const por = (e: string) => r.corpo.cadastros.find((c: { entidade: string }) => c.entidade === e);
      expect(por('produto')).toMatchObject({ ligada: true, falha: { motivo: 'credencial', acao: 'corrigir_credencial' } });
      expect(por('cliente')).toMatchObject({ ligada: true, ultimo_envio_em: AGORA.toISOString(), falha: { motivo: 'lote_falhou', acao: 'aguardar_retentativa' } });
      expect(por('filial')).toMatchObject({ ligada: false, falha: null });
      expect(r.corpo).toMatchObject({ conector_id: 'erp-teste', ambiente: 'teste', chave_prefixo: 'chave-se', ultimo_sinal: { ultimo_http: 200, parado_por_versao: false } });
      const texto = JSON.stringify(r.corpo);
      for (const proibido of [cred, 'chave_cifrada', 'politica_versao', 'limite_registros_lote', 'entidades_habilitadas']) expect(texto).not.toContain(proibido);
      // multi-tenant: o outro tenant não vê nada deste
      expect((await chamar(A, 'GET', '/status')).corpo.conector_id).not.toBe('erp-teste');
    });
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
});
