/**
 * Agenda do conector (reserva, envio, consulta, sinal e reconciliação) contra o PostgreSQL real (papel macuxierp_worker, RLS),
 * com um DUBLÊ do ClienteHub (sem rede, sem FDV). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 * T-0009 §3 a §6.1; RF-INF-02/03/04; RN-INF-02/03/04.
 */
import { OutboxPg, type BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jsonCanonico } from '../domain';
import { criarAgendaConector } from './agenda-conector';
import { mais } from './conector-comum';
import {
  AGORA, CHAVE_CLARA, admSql, ciclo, criarCredencial, cursorEntidade, ErroClienteHub, espelho, hubDuble, ok, payloadProduto, recusa, retentavel, U,
} from './apoio-conector-teste';

const agenda = criarAgendaConector({ outbox: new OutboxPg() });
/** `s` segundos depois do `AGORA` dos testes. */
const depois = (s: number): Date => mais(AGORA, s);
const LOTE_ID = '5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1';
const aceito = (id = LOTE_ID, repetido = false) => ({ lote_id: id, status: 'recebido', entidade: 'produto', modo: 'delta', recebidos: 3, repetido, consulta: `/integracao/v1/lotes/${id}` });
const resultado = (status: string, extra: Record<string, unknown> = {}) => ({ lote_id: LOTE_ID, entidade: 'produto', modo: 'delta', status, contagens: { recebidas: 3, com_erro: 0, novas: 3 }, erros: [], ...extra });

describe.skipIf(!PG_DISPONIVEL)('agenda do conector no PostgreSQL real', { timeout: 20_000 }, () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const lotes = (t: string, e = 'produto') => adm('SELECT id, estado, geracao, modo, tentativas, hub_lote_id, repetido, ultimo_erro_codigo, sessao_parte, sessao_ultimo, corpo, contagens, concluido_em FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND entidade = $2 ORDER BY created_at, geracao', [t, e]);
  const cur = async (t: string, e = 'produto') => (await adm('SELECT proximo_em, pausada_motivo, cursor_alterado_em, cursor_external_id, sessao_aberta_id, ultimo_sucesso_em, ultimo_envio_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = $2', [t, e]))[0]!;
  const reg = async (t: string, chave: string, e = 'produto') => (await adm('SELECT pendente, hash, hash_confirmado, confirmado_em, ativo FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = $2 AND registro_external_id = $3', [t, e, chave]))[0]!;
  const eventos = (t: string) => adm("SELECT nome, agregado_id, payload FROM plataforma.evento WHERE tenant_id = $1 AND nome LIKE 'integracao-fdv.%' ORDER BY ocorrido_em, versao", [t]);
  const credencialDoTenant = (t: string) => adm('SELECT id FROM integracao_fdv.credencial WHERE tenant_id = $1', [t]);

  /** Tenant com licença, credencial e 3 produtos pendentes; delta (cursor já existe) salvo `completo`. */
  async function cenario(slug: string, o: { completo?: boolean; produtos?: number; credencial?: boolean } = {}): Promise<{ t: string; cred: string | null; chaves: string[] }> {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
    const cred = o.credencial === false ? null : await criarCredencial(efemero.admin, t, { conector: `conector-${slug}` });
    const chaves = Array.from({ length: o.produtos ?? 3 }, (_, i) => `P${String(i + 1).padStart(3, '0')}`);
    for (const [i, c] of chaves.entries()) await espelho(efemero.admin, t, 'produto', payloadProduto(c), { alterado: new Date(AGORA.getTime() - 3_600_000 + i * 1000) });
    await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred, cursor: o.completo ? null : { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANTIGO' } });
    return { t, cred, chaves };
  }

  /** Regrava a linha do produto como inativa (payload, hash e coluna coerentes, como o consumidor grava). */
  async function inativarNoEspelho(t: string, chave: string): Promise<void> {
    const alterado = (await adm('SELECT alterado_em FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = $2', [t, chave]))[0]!.alterado_em as Date;
    await adm('DELETE FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = $2', [t, chave]);
    await espelho(efemero.admin, t, 'produto', payloadProduto(chave, { ativo: false }), { alterado, ativo: false });
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  describe('reservar (SKIP LOCKED, tenant_id, pausada, posse)', () => {
    it('reserva só o vencido e não pausado, adia para a posse e não reserva de novo; ignora as colunas da T-0016', async () => {
      const t = await criarTenant(efemero.admin, 'res-a', ['integracao-fdv']);
      await cursorEntidade(efemero.admin, t, 'produto', { proximoEm: depois(-10) });
      await cursorEntidade(efemero.admin, t, 'cliente', { proximoEm: depois(+600) });
      await cursorEntidade(efemero.admin, t, 'filial', { proximoEm: depois(-10) });
      await adm("UPDATE integracao_fdv.cursor_entidade SET pausada_motivo = 'credencial', pausada_em = $2 WHERE tenant_id = $1 AND entidade = 'filial'", [t, AGORA]);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em) VALUES ($1, $2, $3, $4, $4)', [t, depois(-5), depois(+9999), depois(-1)]);
      const posse = depois(120);
      const itens = (await banco.semTenant((tx) => agenda.reservar(tx, 100, AGORA, posse))).filter((i) => i.tenant_id === t);
      expect(itens.map((i) => `${i.tarefa}:${i.chave}`).sort()).toEqual(['envio:produto', 'sinal:null']);
      expect((await cur(t)).proximo_em.getTime()).toBe(posse.getTime());
      expect((await cur(t, 'cliente')).proximo_em.getTime()).toBe(depois(600).getTime());
      const s = (await adm('SELECT proximo_sinal_em, proxima_busca_pedidos_em, proximo_retorno_em, proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
      expect(s.proximo_sinal_em.getTime()).toBe(posse.getTime());
      expect(s.proxima_busca_pedidos_em.getTime()).toBe(depois(-1).getTime()); // da T-0016: intocada
      expect(s.proximo_retorno_em.getTime()).toBe(depois(-1).getTime());
      expect((await banco.semTenant((tx) => agenda.reservar(tx, 100, AGORA, posse))).filter((i) => i.tenant_id === t)).toEqual([]);
      expect((await banco.semTenant((tx) => agenda.reservar(tx, 100, depois(121), depois(241)))).filter((i) => i.tenant_id === t).length).toBe(2); // a posse venceu
    });

    it('SKIP LOCKED: dois workers ao mesmo tempo não pegam o mesmo item', async () => {
      const t = await criarTenant(efemero.admin, 'res-b', ['integracao-fdv']);
      for (const e of ['produto', 'cliente', 'filial', 'vendedor']) await cursorEntidade(efemero.admin, t, e, { proximoEm: depois(-10) });
      const outro = efemero.banco('macuxierp_worker', 2);
      const chave = (i: { tenant_id: string; chave: string | null }) => `${i.tenant_id}:${i.chave}`;
      let a: string[] = [];
      let b: string[] = [];
      await banco.semTenant(async (txA) => {
        a = (await agenda.reservar(txA, 2, AGORA, depois(120))).filter((i) => i.tenant_id === t).map(chave);
        // a transação A ainda não terminou: B não enxerga as linhas dela
        b = (await outro.semTenant((txB) => agenda.reservar(txB, 100, AGORA, depois(120)))).filter((i) => i.tenant_id === t).map(chave);
      });
      expect(a).toHaveLength(2);
      expect(b).toHaveLength(2);
      expect(new Set([...a, ...b]).size).toBe(4);
    });

    it('RF-INF-04: a reserva divide o limite (sinal, reconciliação, envio): o sinal não é esmagado pelos envios nem os esmaga', async () => {
      await adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = '2100-01-01'");
      await adm("UPDATE integracao_fdv.sinal SET proximo_sinal_em = '2100-01-01', proxima_reconciliacao_em = '2100-01-01'");
      for (const slug of ['res-c1', 'res-c2', 'res-c3', 'res-c4']) {
        const t = await criarTenant(efemero.admin, slug, ['integracao-fdv']);
        await cursorEntidade(efemero.admin, t, 'produto', { proximoEm: depois(-10) });
        await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [t, depois(-5), depois(+9999)]);
      }
      const itens = await banco.semTenant((tx) => agenda.reservar(tx, 3, AGORA, depois(120)));
      // cota de 3: 1 sinal, 0 reconciliação (nenhuma vencida), o resto (2) vai para o envio, mesmo com 4 sinais vencidos
      expect(itens.map((i) => i.tarefa).sort()).toEqual(['envio', 'envio', 'sinal']);
      // envios em excesso não deixam o sinal sem vez: a primeira reserva já levou 1 sinal e 2 envios; as próximas, o resto
      const seguinte = await banco.semTenant((tx) => agenda.reservar(tx, 3, AGORA, depois(120)));
      expect(seguinte.map((i) => i.tarefa).sort()).toEqual(['envio', 'envio', 'sinal']);
      await adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = '2100-01-01'");
      await adm("UPDATE integracao_fdv.sinal SET proximo_sinal_em = '2100-01-01', proxima_reconciliacao_em = '2100-01-01'");
    });
  });

  describe('envio e consulta do lote', () => {
    it('delta: envia com Idempotency-Key, consulta, confirma os aceitos, avança o cursor e publica lote.enviado@1', async () => {
      const { t, chaves } = await cenario('env-a');
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('processando')), ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const [l] = await lotes(t);
      expect(l).toMatchObject({ estado: 'aceito', geracao: 1, modo: 'delta', tentativas: 1, hub_lote_id: LOTE_ID, repetido: false });
      const envio = hub.chamadas[0]!;
      expect(envio.pedido).toMatchObject({ metodo: 'POST', caminho: '/lotes' });
      expect(envio.pedido.chaveIdempotencia).toMatch(/^[0-9a-f]{64}$/);
      expect(envio.cred.conectorId).toBe('conector-env-a');
      expect((envio.pedido.corpo as { registros: Array<{ external_id: string }> }).registros.map((r) => r.external_id)).toEqual(chaves);
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(5).getTime());

      await ciclo(banco, agenda, hub, depois(6), [t]); // ainda processando
      expect((await lotes(t))[0]!.estado).toBe('aceito');
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(11).getTime());
      await ciclo(banco, agenda, hub, depois(12), [t]); // concluído
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'concluido' });
      for (const c of chaves) expect(await reg(t, c)).toMatchObject({ pendente: false });
      expect((await reg(t, chaves[0]!)).hash_confirmado).toBe((await reg(t, chaves[0]!)).hash);
      const c = await cur(t);
      expect(c.cursor_external_id).toBe(chaves[2]);
      expect(c.ultimo_sucesso_em.getTime()).toBe(depois(12).getTime());
      expect(c.proximo_em.getTime()).toBe(depois(12 + 3600).getTime()); // nada mais pendente: ocioso
      const ev = await eventos(t);
      expect(ev.map((x) => x.nome)).toEqual(['integracao-fdv.lote.enviado@1']);
      expect(ev[0]!.payload.payload).toMatchObject({ entidade: 'produto', modo: 'delta', geracao: 1, registros: 3, aceitos: 3, com_erro: 0 });
    });

    it('ADR 0010 item 3: a linha antiga da troca de chave, confirmada inativa no Hub, sai (deleted_at) só no finalizar; a nova e as demais ficam', async () => {
      const { t, chaves } = await cenario('env-troca');
      const erp = '11111111-1111-4111-8111-111111111111';
      await inativarNoEspelho(t, chaves[0]!);
      await adm("UPDATE integracao_fdv.registro_publicado SET erp_id = $2 WHERE tenant_id = $1 AND registro_external_id = $3", [t, erp, chaves[0]]);
      await adm("UPDATE integracao_fdv.registro_publicado SET erp_id = $2 WHERE tenant_id = $1 AND registro_external_id = $3", [t, erp, chaves[1]]);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const antes = await adm('SELECT registro_external_id, deleted_at FROM integracao_fdv.registro_publicado WHERE tenant_id = $1', [t]);
      expect(antes.every((r) => r.deleted_at === null)).toBe(true); // ainda não confirmado pelo Hub
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const linhas = await adm('SELECT registro_external_id, deleted_at, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1', [t]);
      const por = (c: string) => linhas.find((r) => r.registro_external_id === c)!;
      expect(por(chaves[0]!).deleted_at).not.toBeNull();
      expect(por(chaves[0]!).pendente).toBe(false);
      expect(por(chaves[1]!).deleted_at).toBeNull();
      expect(por(chaves[2]!).deleted_at).toBeNull();
    });

    it('0015: inativação comum (sem linha sucessora do mesmo erp_id) não faz a linha sair do espelho', async () => {
      const { t, chaves } = await cenario('env-inativa', { produtos: 1 });
      await inativarNoEspelho(t, chaves[0]!);
      await adm("UPDATE integracao_fdv.registro_publicado SET erp_id = $2 WHERE tenant_id = $1", [t, '22222222-2222-4222-8222-222222222222']);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const [l] = await adm('SELECT deleted_at, pendente FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND registro_external_id = $2', [t, chaves[0]]);
      expect(l).toMatchObject({ deleted_at: null, pendente: false });
    });

    it('0015: o lote respeita min(limite_registros_lote da credencial, 5.000)', async () => {
      const { t } = await cenario('env-limite', { produtos: 5 });
      await adm('UPDATE integracao_fdv.credencial SET limite_registros_lote = 2 WHERE tenant_id = $1', [t]);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('processando'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((hub.chamadas[0]!.pedido.corpo as { registros: unknown[] }).registros).toHaveLength(2);
    });

    it('0015: entidade fora de entidades_habilitadas (ou lista vazia) não chama o Hub, não monta lote, não pausa nem erra; só volta a olhar em 1 h', async () => {
      // a credencial tem RLS por tenant e a reserva roda sem tenant (worker_global só nas tabelas da agenda): o filtro é no executar
      const { t } = await cenario('env-desab');
      let esperado = depois(10 + 3600).getTime();
      for (const lista of ["ARRAY['filial']", 'ARRAY[]']) {
        await adm(`UPDATE integracao_fdv.credencial SET entidades_habilitadas = ${lista}::integracao_fdv.entidade_hub[] WHERE tenant_id = $1`, [t]);
        const hub = hubDuble();
        const itens = await ciclo(banco, agenda, hub, depois(10), [t]);
        expect(itens.filter((i) => i.tarefa === 'envio')).toHaveLength(1);
        expect(hub.chamadas).toHaveLength(0);
        const c = await cur(t);
        expect(c.pausada_motivo).toBeNull();
        expect(c.proximo_em.getTime()).toBe(esperado);
        expect(await lotes(t)).toHaveLength(0);
        expect(await eventos(t)).toHaveLength(0);
        await adm('UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
        esperado = depois(10 + 3600).getTime();
      }
      // habilitada de novo: volta a ser reservada e envia
      await adm("UPDATE integracao_fdv.credencial SET entidades_habilitadas = ARRAY['produto']::integracao_fdv.entidade_hub[] WHERE tenant_id = $1", [t]);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('processando'))] });
      await ciclo(banco, agenda, hub, depois(10), [t]);
      expect(hub.chamadas.length).toBeGreaterThan(0);
    });

    it('0015: desabilitar a entidade com lote aceito deixa consultar e concluir; só montar lote novo fica bloqueado', async () => {
      const { t, chaves } = await cenario('env-desab-voo');
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await lotes(t))[0]!.estado).toBe('aceito');
      await adm("UPDATE integracao_fdv.credencial SET entidades_habilitadas = ARRAY['filial']::integracao_fdv.entidade_hub[] WHERE tenant_id = $1", [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      expect((await lotes(t))[0]!.estado).toBe('concluido');
      for (const c of chaves) expect(await reg(t, c)).toMatchObject({ pendente: false });
      // com o lote fechado, um registro novo pendente não vira lote enquanto estiver desabilitada
      await espelho(efemero.admin, t, 'produto', payloadProduto('P900'), { alterado: depois(20) });
      await adm('UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1', [t, depois(21)]);
      const n = hub.chamadas.length;
      await ciclo(banco, agenda, hub, depois(30), [t]);
      expect(hub.chamadas).toHaveLength(n);
      expect(await lotes(t)).toHaveLength(1);
    });

    it('carga completa: cursor nulo no Hub abre sessão, manda os ativos e fecha a sessão na última parte', async () => {
      const { t } = await cenario('env-b', { completo: true });
      await espelho(efemero.admin, t, 'produto', payloadProduto('INATIVO', { ativo: false }), { ativo: false });
      const hub = hubDuble({ 'GET /cursores/produto': [ok({ entidade: 'produto', cursor: null, atualizado_em: null })], 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('concluido', { modo: 'completo' }))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas.map((c) => `${c.pedido.metodo} ${c.pedido.caminho}`)).toEqual(['GET /cursores/produto', 'POST /lotes']);
      const [l] = await lotes(t);
      expect(l).toMatchObject({ modo: 'completo', sessao_parte: 1, sessao_ultimo: true });
      expect(l!.corpo.registros).toHaveLength(3); // o inativo fica de fora da sessão
      expect(l!.corpo.sessao).toMatchObject({ parte: 1, ultimo: true });
      expect((await cur(t)).sessao_aberta_id).toBe(l!.corpo.sessao.id);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const c = await cur(t);
      expect(c.sessao_aberta_id).toBeNull();
      expect(c.cursor_external_id).toBe('P003');
    });

    it('T-0061: sessão completa em andamento cujo restante foi inativado fecha com o último ativo reenviado e ultimo: true (sem parte vazia, sem 422, sem pausa)', async () => {
      const { t } = await cenario('env-fecho', { completo: true });
      await adm('UPDATE integracao_fdv.credencial SET limite_registros_lote = 2 WHERE tenant_id = $1', [t]);
      // dublê do Hub: parte sem registros é 422 lote_vazio, como o Hub de verdade
      let n = 0;
      const hub = hubDuble({
        'GET /cursores/produto': [ok({ entidade: 'produto', cursor: null, atualizado_em: null })],
        'POST /lotes': [(p) => {
          const c = p.corpo as { registros: unknown[] };
          if (c.registros.length === 0) return recusa(422, 'lote_vazio');
          n += 1;
          return ok(aceito(`5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f${n}`));
        }],
        'GET /lotes/{id}': [(p) => ok(resultado('concluido', { modo: 'completo', lote_id: p.caminho.split('/').pop() }))],
      });
      let agora = AGORA;
      const avancar = async (): Promise<void> => {
        agora = mais(agora, 10);
        await ciclo(banco, agenda, hub, agora, [t]);
      };
      for (let i = 0; i < 6 && (await lotes(t)).every((l) => l.estado !== 'concluido'); i++) await avancar();
      expect((await lotes(t))[0]).toMatchObject({ estado: 'concluido', sessao_parte: 1, sessao_ultimo: false });
      const hashAntes = (await reg(t, 'P002')).hash;
      await inativarNoEspelho(t, 'P003'); // o restante da sessão some entre a parte 1 e a 2
      for (let i = 0; i < 8 && (await cur(t)).sessao_aberta_id !== null; i++) await avancar();
      const ls = await lotes(t);
      expect(ls).toHaveLength(2);
      expect(ls[1]).toMatchObject({ estado: 'concluido', sessao_parte: 2, sessao_ultimo: true });
      const regs = ls[1]!.corpo.registros as Array<{ external_id: string }>;
      expect(regs.map((r) => r.external_id)).toEqual(['P002']);
      expect(ls[1]!.corpo.sessao).toMatchObject({ parte: 2, ultimo: true });
      expect(hub.chamadas.filter((c) => c.pedido.metodo === 'POST').every((c) => (c.pedido.corpo as { registros: unknown[] }).registros.length > 0)).toBe(true);
      const c = await cur(t);
      expect(c.sessao_aberta_id).toBeNull();
      expect(c.pausada_motivo).toBeNull();
      expect(c.cursor_external_id).toBe('P002'); // o cursor não recuou nem pulou
      expect((await reg(t, 'P002')).hash).toBe(hashAntes);
      expect((await reg(t, 'P002')).hash_confirmado).toBe(hashAntes);
    });

    /** Sessão completa de 3 produtos em partes de 2: devolve o tenant com a parte 1 concluída (P001 e P002 aceitos) e o relógio. */
    async function sessaoComParte1(slug: string) {
      const { t } = await cenario(slug, { completo: true });
      await adm('UPDATE integracao_fdv.credencial SET limite_registros_lote = 2 WHERE tenant_id = $1', [t]);
      let n = 0;
      const hub = hubDuble({
        'GET /cursores/produto': [ok({ entidade: 'produto', cursor: null, atualizado_em: null })],
        'POST /lotes': [(p) => {
          if ((p.corpo as { registros: unknown[] }).registros.length === 0) return recusa(422, 'lote_vazio');
          n += 1;
          return ok(aceito(`5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f${n}`));
        }],
        'GET /lotes/{id}': [(p) => ok(resultado('concluido', { modo: 'completo', lote_id: p.caminho.split('/').pop() }))],
      });
      let agora = AGORA;
      const avancar = async (): Promise<void> => {
        agora = mais(agora, 10);
        await ciclo(banco, agenda, hub, agora, [t]);
      };
      for (let i = 0; i < 6 && (await lotes(t)).every((l) => l.estado !== 'concluido'); i++) await avancar();
      expect((await lotes(t))[0]).toMatchObject({ estado: 'concluido', sessao_parte: 1, sessao_ultimo: false });
      return { t, hub, avancar };
    }

    it('T-0061: fecho abaixo do cursor local (o último do cursor foi inativado): leva o último aceito, e o cursor local e o enviado ao Hub não recuam', async () => {
      const { t, hub, avancar } = await sessaoComParte1('env-fecho-abaixo');
      const cursorLocal = await cur(t);
      expect(cursorLocal.cursor_external_id).toBe('P002');
      const hashP001 = (await reg(t, 'P001')).hash;
      await inativarNoEspelho(t, 'P002'); // o último da parte 1 sai; o anterior (P001) foi aceito
      await inativarNoEspelho(t, 'P003');
      for (let i = 0; i < 8 && (await cur(t)).sessao_aberta_id !== null; i++) await avancar();
      const ls = await lotes(t);
      expect(ls).toHaveLength(2);
      expect(ls[1]).toMatchObject({ estado: 'concluido', sessao_parte: 2, sessao_ultimo: true });
      const corpo = ls[1]!.corpo as { registros: Array<{ external_id: string }>; cursor: { alterado_em: string; external_id: string } };
      expect(corpo.registros.map((r) => r.external_id)).toEqual(['P001']);
      expect(corpo.cursor).toEqual({ alterado_em: (cursorLocal.cursor_alterado_em as Date).toISOString(), external_id: 'P002' });
      const posts = hub.chamadas.filter((c) => c.pedido.metodo === 'POST').map((c) => c.pedido.corpo as { cursor: { external_id: string } });
      expect(posts[posts.length - 1]!.cursor.external_id).toBe('P002');
      const c = await cur(t);
      expect(c.sessao_aberta_id).toBeNull();
      expect(c.cursor_external_id).toBe('P002');
      expect(c.cursor_alterado_em).toEqual(cursorLocal.cursor_alterado_em);
      expect((await reg(t, 'P001')).hash).toBe(hashP001);
    });

    it('T-0061: sem registros válidos e com linha inválida, o fecho entra junto da linha inválida na parte final', async () => {
      const { t, avancar } = await sessaoComParte1('env-fecho-invalida');
      await inativarNoEspelho(t, 'P003');
      await espelho(efemero.admin, t, 'produto', payloadProduto('P004', { sku: '' }), { alterado: new Date(AGORA.getTime() - 3_600_000 + 5000) });
      for (let i = 0; i < 8 && (await cur(t)).sessao_aberta_id !== null; i++) await avancar();
      const ls = await lotes(t);
      expect(ls).toHaveLength(2);
      expect(ls[1]).toMatchObject({ sessao_parte: 2, sessao_ultimo: true });
      const corpo = ls[1]!.corpo as { registros: Array<{ external_id: string }>; linhas_invalidas: Array<{ external_id: string }> };
      expect(corpo.registros.map((r) => r.external_id)).toEqual(['P002']);
      expect(corpo.linhas_invalidas.map((l) => l.external_id)).toEqual(['P004']);
      expect((await cur(t)).cursor_external_id).toBe('P002');
    });

    it('T-0061: sessão em andamento sem nenhum ativo fecha localmente, sem lote', async () => {
      const { t } = await cenario('env-fecho0', { completo: true, produtos: 0 });
      const sessao = U();
      await adm("UPDATE integracao_fdv.cursor_entidade SET sessao_aberta_id = $2 WHERE tenant_id = $1 AND entidade = 'produto'", [t, sessao]);
      await adm(`INSERT INTO integracao_fdv.lote_envio (tenant_id, entidade, credencial_id, modo, sessao_id, sessao_parte, sessao_ultimo, geracao, chave_idempotencia, corpo, estado, hub_lote_id, concluido_em)
                 SELECT $1, 'produto', id, 'completo', $2, 1, false, 1, repeat('a', 64), '{}'::jsonb, 'concluido', $3, $4 FROM integracao_fdv.credencial WHERE tenant_id = $1`, [t, sessao, LOTE_ID, AGORA]);
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas.filter((c) => c.pedido.metodo === 'POST')).toHaveLength(0);
      const c = await cur(t);
      expect(c.sessao_aberta_id).toBeNull();
      expect(c.pausada_motivo).toBeNull();
    });

    it('carga completa pedida com o espelho vazio: nenhum POST /lotes, sessão fechada, sem pausa; depois um registro novo vai normalmente', async () => {
      const { t } = await cenario('env-b4', { completo: true, produtos: 0 });
      await adm("UPDATE integracao_fdv.cursor_entidade SET sessao_aberta_id = $2 WHERE tenant_id = $1 AND entidade = 'produto'", [t, U()]);
      const hub = hubDuble({ 'GET /cursores/produto': [ok({ entidade: 'produto', cursor: null, atualizado_em: null })], 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('concluido', { modo: 'completo' }))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas.filter((c) => c.pedido.metodo === 'POST')).toHaveLength(0);
      const c = await cur(t);
      expect(c.sessao_aberta_id).toBeNull();
      expect(c.pausada_motivo).toBeNull();
      expect(await lotes(t)).toHaveLength(0);
      await espelho(efemero.admin, t, 'produto', payloadProduto('N001'), { alterado: new Date(AGORA.getTime() - 1000) });
      await ciclo(banco, agenda, hub, depois(3700), [t]); // passa a espera ociosa de 1 h
      const [l] = await lotes(t);
      expect(l).toMatchObject({ modo: 'completo', sessao_parte: 1, sessao_ultimo: true });
      expect(l!.corpo.registros).toHaveLength(1);
    });

    it('cursor do Hub não nulo com cursor local nulo: segue em delta a partir do cursor do Hub', async () => {
      const { t } = await cenario('env-b2', { completo: true });
      const hub = hubDuble({ 'GET /cursores/produto': [ok({ cursor: { alterado_em: '2026-11-22T08:00:00.000Z', external_id: 'P000' } })], 'POST /lotes': [ok(aceito())] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await lotes(t))[0]!).toMatchObject({ modo: 'delta', sessao_parte: null });
    });

    it('carga completa pedida pelo BKO enquanto o ERP consulta o cursor do Hub: o lote sai em completo com a sessão do BKO e o cursor do Hub não a sobrescreve', async () => {
      const { t } = await cenario('env-b3', { completo: true });
      const sessaoBko = U();
      const base = hubDuble({ 'GET /cursores/produto': [ok({ cursor: { alterado_em: '2026-11-22T08:00:00.000Z', external_id: 'P000' } })], 'POST /lotes': [ok(aceito())] });
      const hub = {
        ...base,
        async chamar(cred: Parameters<typeof base.chamar>[0], p: Parameters<typeof base.chamar>[1]) {
          // o que a rota de carga completa grava (cursor zerado e sessão nova) entre a leitura do cursor e a montagem
          if (p.caminho === '/cursores/produto') await adm("UPDATE integracao_fdv.cursor_entidade SET sessao_aberta_id = $2, cursor_alterado_em = NULL, cursor_external_id = NULL WHERE tenant_id = $1 AND entidade = 'produto'", [t, sessaoBko]);
          return base.chamar(cred, p);
        },
      };
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const [l] = await lotes(t);
      expect(l).toMatchObject({ modo: 'completo', sessao_parte: 1 });
      expect(l!.corpo.sessao.id).toBe(sessaoBko);
      expect((await cur(t)).sessao_aberta_id).toBe(sessaoBko);
      expect((await cur(t)).cursor_external_id).toBeNull();
    });

    it('RN-INF-03: replay (Idempotent-Replay) grava repetido e segue como aceito', async () => {
      const { t } = await cenario('env-c');
      const hub = hubDuble({ 'POST /lotes': [ok(aceito(LOTE_ID, true), true)] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'aceito', repetido: true });
    });

    it('5xx/429: retentativa pela curva do Hub, reenviando o MESMO corpo com a MESMA chave', async () => {
      const { t } = await cenario('env-d');
      const hub = hubDuble({ 'POST /lotes': [retentavel(503), retentavel(429, 45_000), ok(aceito())] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'enviando', tentativas: 1, ultimo_erro_codigo: 'http_503' });
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(5).getTime());
      await ciclo(banco, agenda, hub, depois(5), [t]);
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(5 + 45).getTime()); // Retry-After maior que a curva (10 s)
      await ciclo(banco, agenda, hub, depois(50), [t]);
      const [l] = await lotes(t);
      expect(l).toMatchObject({ estado: 'aceito', tentativas: 3, geracao: 1 });
      const posts = hub.chamadas.filter((c) => c.pedido.metodo === 'POST');
      expect(new Set(posts.map((p) => p.pedido.chaveIdempotencia)).size).toBe(1);
      expect(new Set(posts.map((p) => jsonCanonico(p.pedido.corpo))).size).toBe(1); // a ordem das chaves muda no jsonb; o conteúdo não
      expect(await eventos(t)).toHaveLength(0);
    });

    it('rede: o dublê que perde a conexão (retentável sem status) adia sem falhar', async () => {
      const { t } = await cenario('env-d2');
      const hub = hubDuble({ 'POST /lotes': [retentavel(null, null, 'timeout')] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'enviando', ultimo_erro_codigo: 'timeout' });
    });

    it('409 de idempotência pausa só a entidade (idempotencia), recusa o lote e publica lote.falhou@1', async () => {
      const { t } = await cenario('env-e');
      await espelho(efemero.admin, t, 'cliente', { external_id: 'CLI1', ativo: true, razao_social: 'X', filial_external_id: 'F', limite_credito_cents: 0 });
      await cursorEntidade(efemero.admin, t, 'cliente', { proximoEm: depois(+3600) });
      const hub = hubDuble({ 'POST /lotes': [recusa(409, 'chave_idempotencia_reutilizada')] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await cur(t)).pausada_motivo).toBe('idempotencia');
      expect((await cur(t, 'cliente')).pausada_motivo).toBeNull();
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'recusado', ultimo_erro_codigo: 'chave_idempotencia_reutilizada' });
      const ev = await eventos(t);
      expect(ev.map((x) => x.nome)).toEqual(['integracao-fdv.lote.falhou@1']);
      expect(ev[0]!.payload.payload).toMatchObject({ estado: 'recusado', codigo: 'chave_idempotencia_reutilizada' });
      // pausada: não é mais reservada
      expect(await ciclo(banco, agenda, hub, depois(200), [t])).toEqual([]);
    });

    it('401 pausa a credencial em TODAS as entidades e nada mais é chamado (limite de falhas por IP)', async () => {
      const { t } = await cenario('env-f');
      await cursorEntidade(efemero.admin, t, 'cliente', { proximoEm: depois(+3600) });
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em) VALUES ($1, $2)', [t, depois(+3600)]);
      const hub = hubDuble({ 'POST /lotes': [recusa(401, 'credencial_invalida')], 'POST /sinal': [ok({})] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await cur(t)).pausada_motivo).toBe('credencial');
      expect((await cur(t, 'cliente')).pausada_motivo).toBe('credencial');
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'recusado', ultimo_erro_codigo: 'credencial_invalida' });
      // o sinal vencido não chama o Hub com a credencial já recusada
      await adm('UPDATE integracao_fdv.sinal SET proximo_sinal_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      const antes = hub.chamadas.length;
      await ciclo(banco, agenda, hub, depois(10), [t]);
      expect(hub.chamadas.length).toBe(antes);
    });

    it('413 divide o lote ao meio com geração nova; a outra metade volta pelo cursor depois', async () => {
      const { t } = await cenario('env-g', { produtos: 6 });
      const hub = hubDuble({ 'POST /lotes': [recusa(413, 'corpo_grande'), ok(aceito()), ok(aceito('6b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1'))], 'GET /lotes/{id}': [ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const ls = await lotes(t);
      expect(ls.map((l) => [l.estado, l.geracao, l.corpo.registros.length])).toEqual([['recusado', 1, 6], ['montado', 2, 3]]);
      expect(ls[0]!.ultimo_erro_codigo).toBe('corpo_grande');
      expect(await eventos(t)).toHaveLength(0); // dividir não é falha de negócio
      await ciclo(banco, agenda, hub, depois(1), [t]); // envia a metade
      expect((await lotes(t))[1]!.estado).toBe('aceito');
      await ciclo(banco, agenda, hub, depois(7), [t]); // consulta: concluído
      expect((await lotes(t))[1]!.estado).toBe('concluido');
      expect((await reg(t, 'P001')).pendente).toBe(false);
      expect((await reg(t, 'P006')).pendente).toBe(true);
      await ciclo(banco, agenda, hub, depois(8), [t]); // a outra metade sai em lote novo
      const posts = hub.chamadas.filter((c) => c.pedido.metodo === 'POST');
      expect(posts).toHaveLength(3);
      expect((posts[2]!.pedido.corpo as { registros: unknown[] }).registros).toHaveLength(3);
    });

    it('413 em lote de 1 registro não divide: pausa por envelope', async () => {
      const { t } = await cenario('env-g2', { produtos: 1 });
      await ciclo(banco, agenda, hubDuble({ 'POST /lotes': [recusa(413, 'corpo_grande')] }), AGORA, [t]);
      expect((await cur(t)).pausada_motivo).toBe('envelope');
      expect((await lotes(t))[0]!.estado).toBe('recusado');
    });

    it('erro por linha: confirma os aceitos, grava lote_erro sem mensagem, reprocessável segue pendente e o firme sai da fila', async () => {
      const { t, chaves } = await cenario('env-h');
      const hub = hubDuble({
        'POST /lotes': [ok(aceito())],
        'GET /lotes/{id}': [ok(resultado('concluido_com_erros', {
          contagens: { recebidas: 3, com_erro: 2 },
          erros: [
            { indice: 0, external_id: chaves[0], codigo: 'referencia_ausente', campo: 'produto_external_id', mensagem: 'O produto 12345678900 Fulano não existe', reprocessavel: true, origem: 'hub' },
            { indice: 1, external_id: chaves[1], codigo: 'valor_fora_da_faixa', campo: 'preco_cents', mensagem: 'valor -5 de Fulano', reprocessavel: false, origem: 'hub' },
          ],
        }))],
      });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'concluido_com_erros' });
      expect(await reg(t, chaves[2]!)).toMatchObject({ pendente: false });
      expect((await reg(t, chaves[2]!)).hash_confirmado).not.toBeNull();
      expect(await reg(t, chaves[0]!)).toMatchObject({ pendente: true, hash_confirmado: null }); // reprocessável: volta depois
      expect(await reg(t, chaves[1]!)).toMatchObject({ pendente: false, hash_confirmado: null }); // firme: só um novo evento
      const erros = await adm('SELECT indice, origem, codigo, campo, reprocessavel, registro_external_id FROM integracao_fdv.lote_erro WHERE tenant_id = $1 ORDER BY indice', [t]);
      expect(erros).toEqual([
        { indice: 0, origem: 'hub', codigo: 'referencia_ausente', campo: 'produto_external_id', reprocessavel: true, registro_external_id: chaves[0] },
        { indice: 1, origem: 'hub', codigo: 'valor_fora_da_faixa', campo: 'preco_cents', reprocessavel: false, registro_external_id: chaves[1] },
      ]);
      expect(JSON.stringify(erros)).not.toMatch(/Fulano|12345678900/);
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(6 + 900).getTime()); // reprocessável: espera a curva longa
      expect((await eventos(t))[0]!.payload.payload).toMatchObject({ aceitos: 1, com_erro: 2 });
      // o erro do registro aceito depois fica resolvido
      await adm('UPDATE integracao_fdv.registro_publicado SET pendente = true WHERE tenant_id = $1 AND registro_external_id = $2', [t, chaves[0]]);
      const hub2 = hubDuble({ 'POST /lotes': [ok(aceito('7b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1'))], 'GET /lotes/{id}': [ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub2, depois(1000), [t]);
      await ciclo(banco, agenda, hub2, depois(1010), [t]);
      const [e0] = await adm('SELECT resolvido_em FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND indice = 0', [t]);
      expect(e0!.resolvido_em).not.toBeNull();
    });

    it('status falhou: lote falhou, nada confirmado, lote.falhou@1 e o reenvio usa geração nova', async () => {
      const { t, chaves } = await cenario('env-i');
      const hub = hubDuble({ 'POST /lotes': [ok(aceito()), ok(aceito('8b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1'))], 'GET /lotes/{id}': [ok(resultado('falhou'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'falhou', ultimo_erro_codigo: 'falha_processamento' });
      expect(await reg(t, chaves[0]!)).toMatchObject({ pendente: true, hash_confirmado: null });
      expect((await eventos(t)).map((x) => x.nome)).toEqual(['integracao-fdv.lote.falhou@1']);
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(6 + 900).getTime());
      await ciclo(banco, agenda, hub, depois(6 + 901), [t]);
      const ls = await lotes(t);
      expect(ls.map((l) => l.geracao)).toEqual([1, 2]);
      const posts = hub.chamadas.filter((c) => c.pedido.metodo === 'POST');
      expect(posts[0]!.pedido.chaveIdempotencia).not.toBe(posts[1]!.pedido.chaveIdempotencia);
    });

    it('404 ao consultar (lote_nao_encontrado): reenvia o mesmo corpo com a mesma chave', async () => {
      const { t } = await cenario('env-j');
      const hub = hubDuble({ 'POST /lotes': [ok(aceito()), ok(aceito(LOTE_ID, true), true)], 'GET /lotes/{id}': [recusa(404, 'lote_nao_encontrado')] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'enviando', hub_lote_id: null });
      await ciclo(banco, agenda, hub, depois(7), [t]);
      const posts = hub.chamadas.filter((c) => c.pedido.metodo === 'POST');
      expect(posts[0]!.pedido.chaveIdempotencia).toBe(posts[1]!.pedido.chaveIdempotencia);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'aceito', repetido: true });
    });

    it('M5: referência ainda não confirmada fica retida (sem ruído); confirmada a filial, o vendedor sai', async () => {
      const t = await criarTenant(efemero.admin, 'env-k', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      const vend = { external_id: 'V1', ativo: true, nome: 'Ana', filial_external_id: 'FIL-1' };
      await espelho(efemero.admin, t, 'vendedor', vend);
      await cursorEntidade(efemero.admin, t, 'vendedor', { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANT' } });
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(0);
      expect(await lotes(t, 'vendedor')).toHaveLength(0);
      expect((await cur(t, 'vendedor')).proximo_em.getTime()).toBe(depois(3600).getTime());
      // a filial é confirmada: o consumidor/finalização acorda quem depende
      await espelho(efemero.admin, t, 'filial', { external_id: 'FIL-1', ativo: true, codigo: '0001', nome: 'Matriz' }, { confirmado: true });
      await adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1 AND entidade = 'vendedor'", [t, depois(10)]);
      await ciclo(banco, agenda, hub, depois(11), [t]);
      expect(hub.chamadas).toHaveLength(1);
      expect((await lotes(t, 'vendedor'))[0]!.corpo.registros[0]).toMatchObject({ external_id: 'V1', filial_external_id: 'FIL-1' });
    });

    it('M5: linha inválida firme vai em linhas_invalidas (mensagem do catálogo, código do Hub) e só uma vez', async () => {
      const t = await criarTenant(efemero.admin, 'env-l', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      await espelho(efemero.admin, t, 'produto', payloadProduto('BOM'));
      await espelho(efemero.admin, t, 'produto', payloadProduto('RUIM', { nome: '' }));
      await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANT' } });
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())], 'GET /lotes/{id}': [ok(resultado('concluido_com_erros', { erros: [{ indice: 0, external_id: 'RUIM', codigo: 'campo_obrigatorio', campo: 'nome', reprocessavel: false, origem: 'conector' }] }))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const corpo = hub.chamadas[0]!.pedido.corpo as { registros: Array<{ external_id: string }>; linhas_invalidas: Array<Record<string, unknown>> };
      expect(corpo.registros.map((r) => r.external_id)).toEqual(['BOM']);
      expect(corpo.linhas_invalidas).toEqual([{ external_id: 'RUIM', codigo: 'campo_obrigatorio', campo: 'nome', mensagem: expect.stringContaining('Campo obrigatório') }]);
      expect(await adm("SELECT codigo, origem FROM integracao_fdv.lote_erro WHERE tenant_id = $1", [t])).toEqual([{ codigo: 'campo_obrigatorio', origem: 'erp' }]);
      await ciclo(banco, agenda, hub, depois(6), [t]); // concluído; o erro "conector" não duplica o do ERP
      expect(await adm('SELECT 1 FROM integracao_fdv.lote_erro WHERE tenant_id = $1', [t])).toHaveLength(1);
      // o RUIM segue pendente, mas o conteúdo igual não é reenviado
      await ciclo(banco, agenda, hub, depois(4000), [t]);
      expect(hub.chamadas.filter((c) => c.pedido.metodo === 'POST')).toHaveLength(1);
    });

    it('RN-INF-03: linhas inválidas firmes já declaradas saem da fila e não travam os válidos atrás delas (o hash guarda o evento novo)', async () => {
      const t = await criarTenant(efemero.admin, 'env-m', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      const base = new Date('2026-11-22T08:00:00.000Z');
      // 5001 produtos inválidos (nome vazio) na frente da fila: o primeiro lote (5000) não leva nenhum válido
      await adm(
        `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente)
         SELECT $1, 'produto', 'I' || lpad(n::text, 5, '0'),
                jsonb_build_object('external_id', 'I' || lpad(n::text, 5, '0'), 'ativo', true, 'sku', 'S' || n, 'nome', '', 'unidade', 'UN'),
                encode(sha256(convert_to('h' || n, 'UTF8')), 'hex'), $2::timestamptz + n * interval '1 millisecond', $2::timestamptz + n * interval '1 millisecond', '{}'::jsonb, true, true
           FROM generate_series(1, 5001) AS n`,
        [t, base],
      );
      await espelho(efemero.admin, t, 'produto', payloadProduto('VALIDO'), { alterado: new Date(base.getTime() + 60_000) });
      await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANT' } });
      const hub = hubDuble({ 'POST /lotes': [ok(aceito()), ok(aceito('9b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1'))], 'GET /lotes/{id}': [ok(resultado('concluido'))] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const corpo1 = hub.chamadas[0]!.pedido.corpo as { registros: unknown[]; linhas_invalidas: unknown[]; linhas_invalidas_omitidas: number };
      expect(corpo1.registros).toHaveLength(0);
      expect(corpo1.linhas_invalidas).toHaveLength(500);
      expect(corpo1.linhas_invalidas_omitidas).toBe(4500);
      // um evento novo muda o conteúdo de I00001 enquanto o lote está no Hub
      await adm("UPDATE integracao_fdv.registro_publicado SET hash = repeat('a', 64), pendente = true WHERE tenant_id = $1 AND registro_external_id = 'I00001'", [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      const fora = (await adm("SELECT count(*)::int AS n FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND entidade = 'produto' AND NOT pendente", [t]))[0]!.n;
      expect(fora).toBe(499); // 500 declaradas menos a que mudou no meio do caminho
      expect(await reg(t, 'I00001')).toMatchObject({ pendente: true });
      expect(await reg(t, 'I00002')).toMatchObject({ pendente: false });
      expect(await reg(t, 'I00501')).toMatchObject({ pendente: true }); // além das 500: ainda não declarada
      // o próximo lote já leva o válido (4502 pendentes cabem em 5000)
      await ciclo(banco, agenda, hub, depois(7), [t]);
      const corpo2 = hub.chamadas.filter((c) => c.pedido.metodo === 'POST')[1]!.pedido.corpo as { registros: Array<{ external_id: string }> };
      expect(corpo2.registros.map((r) => r.external_id)).toEqual(['VALIDO']);
    });

    it('RN-INF-03: o Hub que lista menos erros que com_erro (lista cortada) não confirma ninguém fora da lista', async () => {
      const { t, chaves } = await cenario('env-n');
      const hub = hubDuble({
        'POST /lotes': [ok(aceito())],
        'GET /lotes/{id}': [ok(resultado('concluido_com_erros', {
          contagens: { recebidas: 3, com_erro: 2 },
          erros: [{ indice: 1, external_id: chaves[1], codigo: 'valor_fora_da_faixa', campo: 'nome', reprocessavel: false, origem: 'hub' }],
        }))],
      });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'concluido_com_erros' });
      expect(await reg(t, chaves[0]!)).toMatchObject({ pendente: true, hash_confirmado: null });
      expect(await reg(t, chaves[2]!)).toMatchObject({ pendente: true, hash_confirmado: null });
      expect(await reg(t, chaves[1]!)).toMatchObject({ pendente: false, hash_confirmado: null }); // o firme listado sai
      expect((await eventos(t))[0]!.payload.payload).toMatchObject({ aceitos: 0, com_erro: 2 });
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(6 + 900).getTime()); // curva longa: a lista encolhe a cada volta
    });

    it('RN-INF-03: 413 divide o lote e os erros do ERP do original ficam resolvidos pelo lote novo (sem duplicar)', async () => {
      const t = await criarTenant(efemero.admin, 'env-o', ['integracao-fdv']);
      const cred = await criarCredencial(efemero.admin, t);
      for (const c of ['BOM1', 'BOM2']) await espelho(efemero.admin, t, 'produto', payloadProduto(c));
      await espelho(efemero.admin, t, 'produto', payloadProduto('RUIM', { nome: '' }));
      await cursorEntidade(efemero.admin, t, 'produto', { credencialId: cred, cursor: { em: new Date(AGORA.getTime() - 86_400_000), id: 'ANT' } });
      const hub = hubDuble({ 'POST /lotes': [recusa(413), ok(aceito())] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const ls = await lotes(t);
      const original = ls[0]!;
      const novo = ls[1]!;
      expect(original).toMatchObject({ estado: 'recusado', ultimo_erro_codigo: 'corpo_grande' });
      expect(novo).toMatchObject({ estado: 'montado', geracao: 2 });
      const erros = await adm('SELECT lote_envio_id, resolvido_no_lote_envio_id AS no, resolvido_em FROM integracao_fdv.lote_erro WHERE tenant_id = $1 ORDER BY resolvido_em NULLS LAST', [t]);
      expect(erros).toHaveLength(2);
      expect(erros[0]).toMatchObject({ lote_envio_id: original.id, no: novo.id });
      expect(erros[0]!.resolvido_em).not.toBeNull();
      expect(erros[1]).toMatchObject({ lote_envio_id: novo.id, resolvido_em: null });
      expect((await eventos(t)).filter((x) => x.nome.endsWith('falhou@1'))).toHaveLength(0); // dividir não é falha
    });
  });

  describe('credencial, licença e defeitos', () => {
    it('sem credencial ativa: nada é chamado e volta a olhar em 1 h', async () => {
      const { t } = await cenario('cre-a', { credencial: false });
      const hub = hubDuble();
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(0);
      expect((await cur(t)).proximo_em.getTime()).toBe(depois(3600).getTime());
    });

    it('semLicenca pausa a entidade com licenca_erp (idempotente) e adia sinal e reconciliação', async () => {
      const { t } = await cenario('cre-b');
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $2)', [t, depois(-1)]);
      await banco.comTenant(t, async (tx) => {
        await agenda.semLicenca({ tenant_id: t, tarefa: 'envio', chave: 'produto' }, tx, AGORA);
        await agenda.semLicenca({ tenant_id: t, tarefa: 'envio', chave: 'produto' }, tx, depois(5));
        await agenda.semLicenca({ tenant_id: t, tarefa: 'sinal', chave: null }, tx, AGORA);
        await agenda.semLicenca({ tenant_id: t, tarefa: 'reconciliacao', chave: null }, tx, AGORA);
      });
      const c = await cur(t);
      expect(c.pausada_motivo).toBe('licenca_erp');
      const pausadaEm = (await adm('SELECT pausada_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [t]))[0]!.pausada_em;
      expect(pausadaEm.getTime()).toBe(AGORA.getTime());
      const s = (await adm('SELECT proximo_sinal_em, proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
      expect(s.proximo_sinal_em.getTime()).toBe(depois(3600).getTime());
      expect(s.proxima_reconciliacao_em.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    });

    it('RD-0481: semLicenca de sinal e reconciliação não religa a linha do sinal apagada', async () => {
      const { t } = await cenario('cre-b2');
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, deleted_at) VALUES ($1, $2, $2, $3)', [t, depois(-1), AGORA]);
      await banco.comTenant(t, async (tx) => {
        await agenda.semLicenca({ tenant_id: t, tarefa: 'sinal', chave: null }, tx, AGORA);
        await agenda.semLicenca({ tenant_id: t, tarefa: 'reconciliacao', chave: null }, tx, AGORA);
      });
      const s = (await adm('SELECT proximo_sinal_em, proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
      expect([s.proximo_sinal_em.getTime(), s.proxima_reconciliacao_em.getTime()]).toEqual([depois(-1).getTime(), depois(-1).getTime()]);
    });

    it('chave que não abre (cifrado adulterado): pausa a credencial sem chamar o Hub e sem vazar nada', async () => {
      const { t, cred } = await cenario('cre-c');
      await adm('ALTER TABLE integracao_fdv.credencial DISABLE TRIGGER credencial_chave_so_anula');
      await adm("UPDATE integracao_fdv.credencial SET chave_cifrada = substring(chave_cifrada from 1 for 20) || '\\x00ff'::bytea || substring(chave_cifrada from 23) WHERE id = $1", [cred]);
      await adm('ALTER TABLE integracao_fdv.credencial ENABLE TRIGGER credencial_chave_so_anula');
      const hub = hubDuble();
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(0);
      expect((await cur(t)).pausada_motivo).toBe('credencial');
    });

    it('ErroClienteHub("pedido_invalido") é defeito do ERP: lote recusado, entidade pausada por envelope, sem retentativa', async () => {
      const { t } = await cenario('cre-d');
      const hub = hubDuble({ 'POST /lotes': [() => { throw new ErroClienteHub('pedido_invalido'); }] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect((await lotes(t))[0]!).toMatchObject({ estado: 'recusado', ultimo_erro_codigo: 'pedido_invalido' });
      expect((await cur(t)).pausada_motivo).toBe('envelope');
      expect((await eventos(t))[0]!.payload.payload).toMatchObject({ codigo: 'pedido_invalido', estado: 'recusado' });
    });

    it('credencial nunca aparece em evento, lote, erro, sinal nem reconciliação (só vai ao Hub, em memória)', async () => {
      const { t, chaves } = await cenario('cre-e');
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $2)', [t, depois(-1)]);
      const hub = hubDuble({
        'POST /lotes': [ok(aceito())],
        'GET /lotes/{id}': [ok(resultado('concluido_com_erros', { erros: [{ indice: 0, external_id: chaves[0], codigo: 'campo_obrigatorio', campo: 'nome', reprocessavel: false, origem: 'hub', mensagem: CHAVE_CLARA }] }))],
        'POST /sinal': [ok({ politica_versao: { versao_minima: '1.0.0' } })],
        'POST /reconciliacoes': [ok({})],
      });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      await ciclo(banco, agenda, hub, depois(6), [t]);
      await ciclo(banco, agenda, hub, depois(70), [t]);
      expect(hub.chamadas.every((c) => c.cred.chave === CHAVE_CLARA)).toBe(true);
      const tudo = JSON.stringify([
        await eventos(t),
        await lotes(t),
        await adm('SELECT * FROM integracao_fdv.lote_erro WHERE tenant_id = $1', [t]),
        await adm('SELECT * FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]),
        await adm('SELECT * FROM integracao_fdv.reconciliacao WHERE tenant_id = $1', [t]),
        await adm('SELECT * FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [t]),
      ]);
      expect(tudo).not.toContain(CHAVE_CLARA);
      // a coluna cifrada nunca é lida em claro: o que está no banco não é a chave
      const c = (await adm('SELECT chave_cifrada FROM integracao_fdv.credencial WHERE tenant_id = $1', [t]))[0]!;
      expect(Buffer.from(c.chave_cifrada).includes(Buffer.from(CHAVE_CLARA))).toBe(false);
      expect((await adm('SELECT ultimo_uso_em FROM integracao_fdv.credencial WHERE tenant_id = $1', [t]))[0]!.ultimo_uso_em).not.toBeNull();
    });
  });

  describe('sinal e reconciliação', () => {
    it('sinal: corpo no formato do Hub, guarda último aceito, http e política; próximo em 1 min; sem dado pessoal', async () => {
      const { t } = await cenario('sin-a');
      await cursorEntidade(efemero.admin, t, 'cliente', { proximoEm: depois(+9999) });
      await adm("UPDATE integracao_fdv.cursor_entidade SET proximo_em = $2 WHERE tenant_id = $1 AND entidade = 'produto'", [t, depois(+9999)]);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [t, depois(-1), depois(+9999)]);
      const hub = hubDuble({ 'POST /sinal': [ok({ politica_versao: { versao_minima: '1.0.0', versao_recomendada: '1.4.0' } })] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      const c = hub.chamadas.find((x) => x.pedido.caminho === '/sinal')!;
      const corpo = c.pedido.corpo as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(corpo).toMatchObject({ versao_contrato: 'v1', conector_id: 'conector-sin-a', versao_conector: '1.4.0', em: AGORA.toISOString() });
      expect(corpo.fila).toEqual([{ estado: 'pendente', lotes: 1, linhas: 3, maisAntigo: '2026-11-22T09:00:00.000Z' }]);
      expect(corpo.entidades).toEqual(expect.arrayContaining([{ entidade: 'produto', fase: 'delta', ultimo_sucesso: null, bloqueada: false, lotes_na_fila: 0 }]));
      expect(JSON.stringify(corpo)).not.toMatch(/Produto P0|SKU/);
      const s = (await adm('SELECT ultimo_aceito_em, ultimo_http, politica_versao, proximo_sinal_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
      expect(s.ultimo_aceito_em.getTime()).toBe(AGORA.getTime());
      expect(s.ultimo_http).toBe(202);
      expect(s.politica_versao).toEqual({ versao_minima: '1.0.0', versao_recomendada: '1.4.0' });
      expect(s.proximo_sinal_em.getTime()).toBe(depois(60).getTime());
    });

    it('sinal: 503 adia sem pausar; 401 pausa todas as entidades', async () => {
      const { t } = await cenario('sin-b');
      await cursorEntidade(efemero.admin, t, 'produto', { proximoEm: depois(+9999), credencialId: null });
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [t, depois(-1), depois(+9999)]);
      await ciclo(banco, agenda, hubDuble({ 'POST /sinal': [retentavel(503)] }), AGORA, [t]);
      expect((await cur(t)).pausada_motivo).toBeNull();
      expect((await adm('SELECT ultimo_http FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!.ultimo_http).toBe(503);
      await adm('UPDATE integracao_fdv.sinal SET proximo_sinal_em = $2 WHERE tenant_id = $1', [t, depois(60)]);
      await ciclo(banco, agenda, hubDuble({ 'POST /sinal': [recusa(401)] }), depois(61), [t]);
      expect((await cur(t)).pausada_motivo).toBe('credencial');
    });

    it('reconciliação: contagem de ativos do espelho por entidade com sucesso, soma nula, próximo às 06h00 UTC do dia seguinte', async () => {
      const { t } = await cenario('rec-a');
      await espelho(efemero.admin, t, 'produto', payloadProduto('INATIVO', { ativo: false }), { ativo: false });
      await adm("UPDATE integracao_fdv.cursor_entidade SET ultimo_sucesso_em = $2, proximo_em = $3 WHERE tenant_id = $1", [t, AGORA, depois(+9999)]);
      await cursorEntidade(efemero.admin, t, 'cliente', { proximoEm: depois(+9999) }); // sem sucesso: não reconcilia
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [t, depois(+9999), depois(-1)]);
      const hub = hubDuble({ 'POST /reconciliacoes': [ok({ situacao: 'ok' })] });
      await ciclo(banco, agenda, hub, AGORA, [t]);
      expect(hub.chamadas.map((c) => c.pedido.corpo)).toEqual([{ versao_contrato: 'v1', entidade: 'produto', data_referencia: '2026-11-22', contagem: 3, soma: null }]);
      expect(await adm('SELECT entidade, data_referencia::text AS d, contagem, soma, resposta_http FROM integracao_fdv.reconciliacao WHERE tenant_id = $1', [t])).toEqual([{ entidade: 'produto', d: '2026-11-22', contagem: 3, soma: null, resposta_http: 202 }]);
      const s = (await adm('SELECT proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
      expect(s.proxima_reconciliacao_em.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    });

    it('reconciliação: 503 reagenda sem gravar; o mesmo dia já feito não repete', async () => {
      const { t } = await cenario('rec-b');
      await adm("UPDATE integracao_fdv.cursor_entidade SET ultimo_sucesso_em = $2, proximo_em = $3 WHERE tenant_id = $1", [t, AGORA, depois(+9999)]);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [t, depois(+9999), depois(-1)]);
      await ciclo(banco, agenda, hubDuble({ 'POST /reconciliacoes': [retentavel(503)] }), AGORA, [t]);
      expect(await adm('SELECT 1 FROM integracao_fdv.reconciliacao WHERE tenant_id = $1', [t])).toHaveLength(0);
      expect((await adm('SELECT proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!.proxima_reconciliacao_em.getTime()).toBe(depois(65).getTime());
      const hub = hubDuble({ 'POST /reconciliacoes': [ok({})] });
      await ciclo(banco, agenda, hub, depois(66), [t]);
      await adm('UPDATE integracao_fdv.sinal SET proxima_reconciliacao_em = $2 WHERE tenant_id = $1', [t, depois(60)]);
      await ciclo(banco, agenda, hub, depois(200), [t]);
      expect(hub.chamadas).toHaveLength(1);
    });

    it('reconciliação: ErroClienteHub é defeito do ERP: adia para o dia seguinte, pausa só se a credencial é a culpada', async () => {
      const a = await cenario('rec-c');
      await adm("UPDATE integracao_fdv.cursor_entidade SET ultimo_sucesso_em = $2, proximo_em = $3 WHERE tenant_id = $1", [a.t, AGORA, depois(+9999)]);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [a.t, depois(+9999), depois(-1)]);
      await ciclo(banco, agenda, hubDuble({ 'POST /reconciliacoes': [() => { throw new ErroClienteHub('pedido_invalido'); }] }), AGORA, [a.t]);
      expect((await cur(a.t)).pausada_motivo).toBeNull();
      expect((await adm('SELECT proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [a.t]))[0]!.proxima_reconciliacao_em.toISOString()).toBe('2026-11-23T06:00:00.000Z');
      const b = await cenario('rec-d');
      await adm("UPDATE integracao_fdv.cursor_entidade SET ultimo_sucesso_em = $2, proximo_em = $3 WHERE tenant_id = $1", [b.t, AGORA, depois(+9999)]);
      await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em) VALUES ($1, $2, $3)', [b.t, depois(+9999), depois(-1)]);
      await ciclo(banco, agenda, hubDuble({ 'POST /reconciliacoes': [() => { throw new ErroClienteHub('credencial_invalida'); }] }), AGORA, [b.t]);
      expect((await cur(b.t)).pausada_motivo).toBe('credencial');
      expect((await adm('SELECT proxima_reconciliacao_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [b.t]))[0]!.proxima_reconciliacao_em.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    });
  });

  describe('multi-tenant', () => {
    it('cada tenant envia só os próprios registros, com a própria credencial; um não enxerga o outro', async () => {
      const A = await cenario('mt-a', { produtos: 2 });
      const B = await cenario('mt-b', { produtos: 3 });
      const hub = hubDuble({ 'POST /lotes': [ok(aceito())] });
      await ciclo(banco, agenda, hub, AGORA, [A.t, B.t]);
      const posts = hub.chamadas.filter((c) => c.pedido.metodo === 'POST');
      expect(posts).toHaveLength(2);
      const porConector = new Map(posts.map((p) => [p.cred.conectorId, (p.pedido.corpo as { registros: unknown[] }).registros.length]));
      expect(porConector.get('conector-mt-a')).toBe(2);
      expect(porConector.get('conector-mt-b')).toBe(3);
      expect(await lotes(A.t)).toHaveLength(1);
      expect(await lotes(B.t)).toHaveLength(1);
      expect((await lotes(A.t))[0]!.corpo.registros.map((r: { external_id: string }) => r.external_id)).toEqual(A.chaves);
      // RLS do papel do worker: no tenant A o lote do B não existe
      const visiveis = await banco.comTenant(A.t, (tx) => tx.consultar<{ tenant_id: string }>('SELECT tenant_id FROM integracao_fdv.lote_envio'));
      expect(new Set(visiveis.map((v) => v.tenant_id))).toEqual(new Set([A.t]));
      expect(await credencialDoTenant(A.t)).toHaveLength(1);
    });
  });
});
