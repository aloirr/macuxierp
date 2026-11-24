/**
 * Operação da Integração FDV (T-0086) contra o PostgreSQL real (papel macuxierp_worker, RLS): Reprocessar só de falha e
 * pendente, Log (BKO completo e /config sem dado de negócio), Monitor e a inativação do Zerar que o conector envia com a origem
 * `zerar`. O estado do espelho do Zerar é montado direto (`ativo = false`, `pendente = true`, marca em `fonte_refs`): a função
 * `portal_inativar_espelho` é da migração do banco-dados e não é dependência deste teste. O Hub é o DUBLÊ (sem rede, sem FDV).
 * Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARCA_REENVIO, montarLogPlataforma, montarLogTenant, montarMonitor } from '../domain';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import {
  AGORA, admSql, ciclo, criarCredencial, cursorEntidade, espelho, hubDuble, ok, payloadProduto,
} from './apoio-conector-teste';
import { lerInsumosLog, lerInsumosMonitor, reprocessarCadastro } from './operacao';
import { criarRotas } from './rotas';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
const depois = (s: number): Date => mais(AGORA, s);
const LOTE_ID = '5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1';
const LOTE_2 = '6b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f2';
const ZERAR = { [MARCA_REENVIO.zerar.chave]: MARCA_REENVIO.zerar.valor };
const aceito = (id = LOTE_ID) => ({ lote_id: id, status: 'recebido', entidade: 'produto', modo: 'delta', recebidos: 2, repetido: false, consulta: `/integracao/v1/lotes/${id}` });
const resultado = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ lote_id: id, entidade: 'produto', modo: 'delta', status, contagens: { recebidas: 2, com_erro: 0, novas: 2 }, erros: [], ...extra });
const FALHA_HUB = { indice: 0, external_id: 'Z1', codigo: 'falha_processamento', campo: null, reprocessavel: true, origem: 'hub' };
const ANTES = new Date(AGORA.getTime() - 86_400_000);

describe.skipIf(!PG_DISPONIVEL)('operação da Integração FDV no PostgreSQL real (T-0086)', { timeout: 30_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const reg = async (t: string, chave: string) =>
    (await adm('SELECT pendente, ativo, hash, hash_confirmado, fonte_refs FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3', [t, 'produto', chave]))[0]!;
  const lotes = (t: string) => adm("SELECT id, estado, contagens, corpo FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND entidade = 'produto' ORDER BY created_at, geracao", [t]);
  const postados = (hub: ReturnType<typeof hubDuble>) => hub.chamadas.filter((c) => c.pedido.metodo === 'POST' && c.pedido.caminho === '/lotes');
  const externosDoCorpo = (corpo: unknown) => (corpo as { registros: Array<{ external_id: string }> }).registros.map((r) => r.external_id);

  /** Tenant com credencial e o cursor em delta. */
  async function base(slug: string, o: { entidades?: Parameters<typeof criarCredencial>[2] extends infer P ? (P extends { entidades?: infer E } ? E : never) : never } = {}) {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    const cred = await criarCredencial(efemero.admin, t, { conector: `conector-${slug}`, ...(o.entidades ? { entidades: o.entidades } : {}) });
    await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred, cursor: { em: ANTES, id: 'ANTIGO' } });
    return { t, cred };
  }
  /** Duas inativações do Zerar pendentes (Z1, Z2) e um integrado ativo (I1), como a 0053 deixa o espelho. */
  async function espelhoDoZerar(t: string, nomeZ1 = 'Produto Z1'): Promise<void> {
    await espelho(efemero.admin, t, 'produto', payloadProduto('Z1', { ativo: false, nome: nomeZ1 }), { ativo: false, pendente: true, refs: ZERAR, alterado: new Date(AGORA.getTime() - 3000) });
    await espelho(efemero.admin, t, 'produto', payloadProduto('Z2', { ativo: false }), { ativo: false, pendente: true, refs: ZERAR, alterado: new Date(AGORA.getTime() - 2000) });
    await espelho(efemero.admin, t, 'produto', payloadProduto('I1'), { confirmado: true, pendente: false, alterado: new Date(AGORA.getTime() - 9000) });
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  describe('Reprocessar', () => {
    it('RN-INF-03: marca só falha e pendente; o integrado não volta a pendente nem é reenviado; antecipa o ciclo', async () => {
      const { t } = await base('op-a');
      await espelho(efemero.admin, t, 'produto', payloadProduto('INT'), { confirmado: true, pendente: false });
      await espelho(efemero.admin, t, 'produto', payloadProduto('PEN'), { pendente: true });
      await espelho(efemero.admin, t, 'produto', payloadProduto('FAL'), { confirmado: true, pendente: false });
      await espelho(efemero.admin, t, 'produto', payloadProduto('MUD', { nome: 'mudou' }), { pendente: false }); // hash_confirmado nulo: pendente pelo hash
      const [lote] = await adm(
        `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, hub_lote_id, concluido_em, contagens)
         SELECT $1, 'produto', c.id, 'delta', repeat('a', 64), 'concluido_com_erros', gen_random_uuid(), now(), '{}'::jsonb FROM integracao_fdv.credencial c WHERE c.tenant_id = $1 RETURNING id`, [t]);
      await adm("INSERT INTO integracao_fdv.lote_erro (tenant_id, lote_envio_id, indice, origem, entidade, registro_external_id, codigo) VALUES ($1, $2, 0, 'hub', 'produto', 'FAL', 'falha_processamento')", [t, lote!.id]);
      await adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = now() + interval '1 hour' WHERE tenant_id = $1", [t]);
      const antes = await reg(t, 'INT');

      const r = await banco.comTenant(t, (tx) => reprocessarCadastro(tx, t, 'produto'));
      expect(r).toEqual({ conflito: false, ids: expect.any(Array), falhas: 1, pendentes: 2 });

      expect(await reg(t, 'INT')).toEqual(antes); // integrado: intocado
      expect(await reg(t, 'FAL')).toMatchObject({ pendente: true, fonte_refs: { reenvio: 'reprocessar' } });
      expect(await reg(t, 'PEN')).toMatchObject({ pendente: true, fonte_refs: { reenvio: 'reprocessar' } });
      expect(await reg(t, 'MUD')).toMatchObject({ pendente: true });
      const [c] = await adm("SELECT proximo_em <= now() AS ja FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'produto'", [t]);
      expect(c!.ja).toBe(true);
      // sem carga completa: o cursor local não voltou ao início
      expect((await adm("SELECT cursor_external_id, sessao_aberta_id FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'produto'", [t]))[0]).toEqual({ cursor_external_id: 'ANTIGO', sessao_aberta_id: null });
    });

    it('só integrados: nada a reprocessar (contagens zero, nada gravado); duas vezes seguidas dá o mesmo resultado', async () => {
      const { t } = await base('op-b');
      await espelho(efemero.admin, t, 'produto', payloadProduto('INT'), { confirmado: true, pendente: false });
      const antes = await reg(t, 'INT');
      for (let i = 0; i < 2; i++) expect(await banco.comTenant(t, (tx) => reprocessarCadastro(tx, t, 'produto'))).toEqual({ conflito: false, ids: [], falhas: 0, pendentes: 0 });
      expect(await reg(t, 'INT')).toEqual(antes);
    });

    it('com lote em voo no cadastro: conflito, e nenhum registro é marcado', async () => {
      const { t, cred } = await base('op-c');
      await espelho(efemero.admin, t, 'produto', payloadProduto('PEN'), { pendente: true });
      await adm(
        `INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, chave_idempotencia, estado, corpo, contagens)
         VALUES ($1, 'produto', $2, 'delta', repeat('b', 64), 'enviando', '{"registros": []}'::jsonb, '{}'::jsonb)`, [t, cred]);
      expect(await banco.comTenant(t, (tx) => reprocessarCadastro(tx, t, 'produto'))).toEqual({ conflito: true });
      expect((await reg(t, 'PEN')).fonte_refs).toEqual({});
    });

    it('tenant: o Reprocessar de uma empresa não toca o espelho de outra', async () => {
      const a = await base('op-d1');
      const b = await base('op-d2');
      await espelho(efemero.admin, a.t, 'produto', payloadProduto('PEN'), { pendente: true });
      await espelho(efemero.admin, b.t, 'produto', payloadProduto('PEN'), { pendente: true });
      await banco.comTenant(a.t, (tx) => reprocessarCadastro(tx, a.t, 'produto'));
      expect((await reg(a.t, 'PEN')).fonte_refs).toEqual({ reenvio: 'reprocessar' });
      expect((await reg(b.t, 'PEN')).fonte_refs).toEqual({});
    });
  });

  describe('inativação do Zerar no conector (§5)', () => {
    it('o ciclo delta envia só as inativações com o payload do espelho, a origem zerar no lote, e não reenvia o integrado', async () => {
      const { t } = await base('zer-a');
      await espelhoDoZerar(t);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const [l] = await lotes(t);
      expect(externosDoCorpo(l!.corpo)).toEqual(['Z1', 'Z2']); // I1 (integrado) não vai
      expect((l!.corpo as { registros: Array<{ ativo: boolean }> }).registros.map((r) => r.ativo)).toEqual([false, false]);
      expect(l!.contagens).toMatchObject({ origem: 'zerar', registros: 2 });
      expect(await reg(t, 'Z1')).toMatchObject({ pendente: false, ativo: false });
      expect(await reg(t, 'Z1')).toMatchObject({ hash_confirmado: (await reg(t, 'Z1')).hash });
    });

    it('a falha do Hub não desfaz nada: a inativação fica em falha, aparece no Log com a origem zerar, e o Reprocessar a reenvia', async () => {
      const { t } = await base('zer-b');
      await espelhoDoZerar(t);
      const hub = hubDuble({
        'POST /lotes': [ok(aceito()), ok(aceito(LOTE_2))],
        'GET /lotes/{id}': [
          ok(resultado(LOTE_ID, 'concluido_com_erros', { contagens: { recebidas: 2, com_erro: 1 }, erros: [FALHA_HUB] })),
          ok(resultado(LOTE_2, 'concluido')),
        ],
      });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);

      // Z1 falhou no Hub: segue pendente, com erro aberto (falha); Z2 foi aceito; nada foi apagado do espelho
      expect(await reg(t, 'Z1')).toMatchObject({ pendente: true, hash_confirmado: null, ativo: false });
      expect(await reg(t, 'Z2')).toMatchObject({ pendente: false });
      const log = await banco.comTenant(t, (tx) => lerInsumosLog(tx, t, 'produto', 200));
      expect(log.total_erros).toBe(1);
      const tenant = montarLogTenant({ entidade: 'produto', lidoEm: AGORA, envios: log.envios, erros: log.erros, totalErros: log.total_erros, motivo: log.motivo?.motivo ?? null });
      expect(tenant.envios[0]).toMatchObject({ origem: 'zerar', situacao: 'com_erros', registros: 2, com_erro: 1 });
      expect(tenant.erros).toEqual([expect.objectContaining({ registro_external_id: 'Z1', codigo: 'falha_processamento', nome_curto: 'Produto Z1', corrigir_href: null })]);
      expect(tenant.motivo).toBe('erros_por_linha');

      // Reprocessar: só Z1 (falha) volta; Z2 (integrado) não
      const r = await banco.comTenant(t, (tx) => reprocessarCadastro(tx, t, 'produto'));
      expect(r).toMatchObject({ conflito: false, falhas: 1, pendentes: 0 });
      expect((await reg(t, 'Z2')).fonte_refs).toEqual(ZERAR);
      await ciclo(banco, agenda, hub, depois(2000), [t]);
      await ciclo(banco, agenda, hub, depois(2010), [t]);
      const corpos = postados(hub).map((c) => externosDoCorpo(c.pedido.corpo));
      expect(corpos).toEqual([['Z1', 'Z2'], ['Z1']]);
      expect(await reg(t, 'Z1')).toMatchObject({ pendente: false });
      expect((await reg(t, 'Z1')).hash_confirmado).toBe((await reg(t, 'Z1')).hash);
      const [, segundo] = await lotes(t);
      expect(segundo!.contagens).toMatchObject({ origem: 'zerar' }); // o reenvio de uma inativação do Zerar segue zerar
      const depoisLog = await banco.comTenant(t, (tx) => lerInsumosLog(tx, t, 'produto', 200));
      expect(depoisLog.total_erros).toBe(0); // o erro ficou resolvido no lote que aceitou
    });

    it('lote que falhou inteiro (Hub fora): as inativações seguem pendentes e saem no Reprocessar com a origem reprocessar', async () => {
      const { t } = await base('zer-c');
      await espelho(efemero.admin, t, 'produto', payloadProduto('P1'), { pendente: true });
      const hub = hubDuble({ 'POST /lotes': [ok(aceito()), ok(aceito(LOTE_2))], 'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'falhou')), ok(resultado(LOTE_2, 'concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      expect((await lotes(t))[0]!.estado).toBe('falhou');
      expect(await reg(t, 'P1')).toMatchObject({ pendente: true });
      const log = await banco.comTenant(t, (tx) => lerInsumosLog(tx, t, 'produto', 200));
      expect(log.motivo).toMatchObject({ motivo: 'lote_falhou' });
      expect(await banco.comTenant(t, (tx) => reprocessarCadastro(tx, t, 'produto'))).toMatchObject({ conflito: false, falhas: 0, pendentes: 1 });
      await ciclo(banco, agenda, hub, depois(3000), [t]);
      await ciclo(banco, agenda, hub, depois(3010), [t]);
      expect((await lotes(t)).map((l) => l.contagens.origem)).toEqual(['ciclo', 'reprocessar']);
    });

    it('a pausa do conector segura o envio: nada é chamado e as inativações ficam pendentes até a retomada', async () => {
      const { t } = await base('zer-d');
      await espelhoDoZerar(t);
      await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'credencial', pausada_em = $2 WHERE tenant_id = $1", [t, AGORA]);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'concluido'))] });
      await ciclo(banco, agenda, hub, depois(10), [t]);
      expect(hub.chamadas).toHaveLength(0);
      expect(await reg(t, 'Z1')).toMatchObject({ pendente: true });
      await adm('UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = NULL, pausada_em = NULL WHERE tenant_id = $1', [t]);
      await ciclo(banco, agenda, hub, depois(20), [t]);
      expect(postados(hub)).toHaveLength(1);
    });

    it('cadastro desligado na integração segura o envio; ao ligar, as inativações saem', async () => {
      const { t, cred } = await base('zer-e', { entidades: ['filial'] });
      await espelhoDoZerar(t);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(0);
      expect(await reg(t, 'Z1')).toMatchObject({ pendente: true });
      expect(await lotes(t)).toHaveLength(0);
      await adm("UPDATE integracao_fdv.credencial SET entidades_habilitadas = ARRAY['filial', 'produto']::integracao_fdv.entidade_hub[] WHERE id = $1", [cred]);
      await adm('UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1', [t, depois(100)]);
      await ciclo(banco, agenda, hub, depois(3700), [t]);
      expect(externosDoCorpo(postados(hub)[0]!.pedido.corpo)).toEqual(['Z1', 'Z2']);
    });
  });

  describe('Log e Monitor', () => {
    it('ADR 0013: com nome e CNPJ no espelho e erro aberto, o log do /config não traz nem nome, nem documento, nem external_id', async () => {
      const { t } = await base('log-a');
      await espelhoDoZerar(t, 'Mercado Silva LTDA 12345678000195');
      const hub = hubDuble({
        'POST /lotes': [ok(aceito())],
        'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'concluido_com_erros', { contagens: { recebidas: 2, com_erro: 1 }, erros: [FALHA_HUB] }))],
      });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const i = await banco.comTenant(t, (tx) => lerInsumosLog(tx, t, 'produto', null));
      const config = montarLogPlataforma({ entidade: 'produto', lidoEm: AGORA, envios: i.envios, erros: i.erros, totalErros: i.total_erros, motivo: i.motivo?.motivo ?? null });
      const texto = JSON.stringify(config);
      for (const proibido of ['Mercado Silva', '12345678000195', 'Z1', 'registro_external_id', 'nome_curto']) expect(texto, proibido).not.toContain(proibido);
      expect(config.erros).toEqual([{ codigo: 'falha_processamento', campo: null, quantidade: 1 }]);
      expect(config.envios[0]).toMatchObject({ origem: 'zerar', situacao: 'com_erros' });
      // o do BKO traz o registro e o nome (é a empresa vendo o que é dela)
      expect(JSON.stringify(montarLogTenant({ entidade: 'produto', lidoEm: AGORA, envios: i.envios, erros: i.erros, totalErros: i.total_erros, motivo: null }))).toContain('Mercado Silva');
    });

    it('tenant: o log do BKO de uma empresa não traz erro de outra', async () => {
      const a = await base('log-b1');
      const b = await base('log-b2');
      for (const [x, n] of [[a, 'Do A'], [b, 'Do B']] as const) {
        await espelhoDoZerar(x.t, n);
        const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'concluido_com_erros', { contagens: { recebidas: 2, com_erro: 1 }, erros: [FALHA_HUB] }))] });
        await ciclo(banco, agenda, hub, AGORA, [x.t]);
        await ciclo(banco, agenda, hub, depois(6), [x.t]);
      }
      const i = await banco.comTenant(a.t, (tx) => lerInsumosLog(tx, a.t, 'produto', 200));
      expect(i.erros.map((e) => e.payload?.nome)).toEqual(['Do A']);
      expect(i.envios).toHaveLength(1);
    });

    it('rotas do BKO: log com os 200 primeiros e total; CSV com todos os erros, sem mensagem do Hub', async () => {
      const { t } = await base('log-c');
      await espelhoDoZerar(t);
      const hub = hubDuble({
        'POST /lotes': [ok(aceito())],
        'GET /lotes/{id}': [ok(resultado(LOTE_ID, 'concluido_com_erros', { contagens: { recebidas: 2, com_erro: 1 }, erros: [{ ...FALHA_HUB, mensagem: 'texto cru do Hub com Fulano 12345678900' }] }))],
      });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const rotas = criarRotas();
      const exec = (caminho: string) => {
        const r = rotas.find((x) => x.caminho === caminho)!;
        return banco.comTenant(t, (tx) => r.executar({ sessao: { tenant_id: t, perfil: 'administrador' }, tx, agora: AGORA, request_id: 'r' } as never, { params: { entidade: 'produto' }, consulta: {} } as never));
      };
      const log = (await exec('/entidades/:entidade/log')).corpo as { total_erros: number; erros: Array<{ registro_external_id: string }> };
      expect(log.total_erros).toBe(1);
      expect(log.erros.map((e) => e.registro_external_id)).toEqual(['Z1']);
      const csv = await exec('/entidades/:entidade/log.csv');
      expect(csv.cabecalhos?.['content-type']).toContain('text/csv');
      expect(String(csv.corpo)).toContain('Z1;Produto Z1;;falha_processamento;');
      expect(String(csv.corpo)).not.toMatch(/Fulano|12345678900/);
    });

    it('Monitor: lê credencial, sinal aceito e fila (lotes em voo e registros pendentes); sem credencial = desativado', async () => {
      const { t } = await base('mon-a');
      await espelho(efemero.admin, t, 'produto', payloadProduto('P1'), { pendente: true });
      await espelho(efemero.admin, t, 'produto', payloadProduto('P2'), { pendente: true });
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, ultimo_envio_em, ultimo_aceito_em) VALUES ($1, $2, $2)', [t, new Date(AGORA.getTime() - 30_000)]);
      const m = montarMonitor({ ...(await banco.comTenant(t, (tx) => lerInsumosMonitor(tx, t))), agora: AGORA });
      expect(m).toMatchObject({ identificador: 'conector-mon-a', situacao: 'em_dia', fila: { lotes: 0, linhas: 2 } });
      const vazio = await criarTenant(efemero.admin, 'mon-b', ['integracao-fdv']);
      expect(montarMonitor({ ...(await banco.comTenant(vazio, (tx) => lerInsumosMonitor(tx, vazio))), agora: AGORA })).toMatchObject({ identificador: null, situacao: 'desativado', versao: null });
    });
  });
});
