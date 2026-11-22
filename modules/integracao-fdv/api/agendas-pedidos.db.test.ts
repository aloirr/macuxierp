/**
 * Agendas do recebimento e do retorno de pedidos do FDV contra o PostgreSQL real (papel macuxierp_worker, RLS), com o DUBLÊ do
 * `ClienteHub` do `apoio-conector-teste` (sem rede, sem FDV). Sem Postgres o teste pula (`bash db/scripts/pg-local.sh`).
 * T-0013 §5 e §6; T-0016; RN-PED-01, RN-PED-05, RN-INF-04; contrato C-9 (reserva, posse, margem).
 */
import { POSSE_AGENDA_MS, type ClienteHub, type Relogio } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import { criarBancoEfemero, criarTenant, PG_DISPONIVEL, type BancoEfemero } from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntidadeChaveErp } from '../contracts';
import { AGENDA_BUSCA_PEDIDOS_ID, AGENDA_RETORNO_PEDIDOS_ID, criarAgendasPedidosFdv } from './agendas-pedidos';
import { AGORA, CHAVE_CLARA, ErroClienteHub, U, admSql, ciclo, contextoDaAgenda, criarCredencial, cursorEntidade, dubleLogAlertas, hubDuble, ok, recusa, retentavel } from './apoio-conector-teste';
import { mais } from './conector-comum';
import { agendarEnvio } from './espelho';
import type { RecebedorPedidoFdv, ResolvedorChaveErp } from './portas';
import { agendarRetorno, gravarRetorno } from './util-pedidos';

const depois = (s: number): Date => mais(AGORA, s);
const ids = { cliente: U(), vendedor: U(), produto: U(), filial: U() };

describe.skipIf(!PG_DISPONIVEL)('agendas de pedidos do FDV no PostgreSQL real', () => {
  let efemero: BancoEfemero;
  let banco: BancoPg;
  let adm: ReturnType<typeof admSql>;
  const relogio = { t: AGORA, agora(): Date { return this.t; } } satisfies Relogio & { t: Date };
  const { logs, alertas, log, alertar } = dubleLogAlertas();
  const tabela: Record<string, string> = { [ids.cliente]: U(), [ids.vendedor]: U(), [ids.produto]: U() };
  const resolvedor: ResolvedorChaveErp = {
    resolver: async (_tx, _e: EntidadeChaveErp, chaves) => new Map(chaves.filter((c) => tabela[c]).map((c) => [c, tabela[c]!])),
  };
  const criados: string[] = [];
  const recebedor: RecebedorPedidoFdv = {
    receber: async (_tx, e) => {
      criados.push(e.pedido_uuid);
      return { resultado: 'criado', pedido_id: U(), numero: 1, status: 'aprovado' };
    },
  };
  const [busca, retorno] = [
    () => criarAgendasPedidosFdv({ recebedor, resolvedor, alertar, log, relogio }).find((a) => a.id === AGENDA_BUSCA_PEDIDOS_ID)!,
    () => criarAgendasPedidosFdv({ recebedor, resolvedor, alertar, log, relogio }).find((a) => a.id === AGENDA_RETORNO_PEDIDOS_ID)!,
  ];
  const pedidoDoHub = (uuid: string) => ({
    pedido_uuid: uuid, cliente_external_id: ids.cliente, vendedor_external_id: ids.vendedor, criado_em: '2026-11-21T14:00:00Z', total_cents: 2500, tentativa: 1,
    itens: [{ sequencia: 1, produto_external_id: ids.produto, quantidade: 2.5, preco_unitario_cents: 1000, total_cents: 2500 }],
  });
  const sinal = async (t: string) =>
    (await adm('SELECT proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em FROM integracao_fdv.sinal WHERE tenant_id = $1', [t]))[0]!;
  const retornos = (t: string) => adm('SELECT pedido_uuid, status, estado, tentativas, resposta_http FROM integracao_fdv.retorno_enviado WHERE tenant_id = $1 ORDER BY created_at', [t]);

  /** Tenant com licença, credencial (chave própria), a linha do sinal com as 4 colunas pedidas e a filial padrão. */
  async function cenario(slug: string, o: Partial<Record<'busca' | 'retorno', Date | null>> = {}, credencial = true): Promise<{ t: string; chave: string; conector: string }> {
    const t = await criarTenant(efemero.admin, slug, ['integracao-fdv', 'pedido']);
    const chave = `${CHAVE_CLARA}-${slug}`;
    const conector = `conector-${slug}`;
    if (credencial) await criarCredencial(efemero.admin, t, { conector, chave });
    await adm('INSERT INTO integracao_fdv.sinal (tenant_id, proximo_sinal_em, proxima_reconciliacao_em, proxima_busca_pedidos_em, proximo_retorno_em) VALUES ($1, $2, $2, $3, $4)', [
      t, depois(+9999), o.busca === undefined ? null : o.busca, o.retorno === undefined ? null : o.retorno,
    ]);
    await adm(`INSERT INTO integracao_fdv.referencia (tenant_id, tipo, erp_id, fonte_ocorrido_em) VALUES ($1, 'filial_padrao', $2, $3)`, [t, ids.filial, AGORA]);
    return { t, chave, conector };
  }

  /** Pedido já entregue e com um retorno `integrado` pendente (a fila do envio), vencido há 10 s. */
  async function pedidoComRetorno(t: string): Promise<string> {
    const uuid = U();
    await adm(`INSERT INTO integracao_fdv.pedido_recebido (tenant_id, pedido_uuid, payload, hash, estado) VALUES ($1, $2, '{}', repeat('b', 64), 'entregue')`, [t, uuid]);
    await banco.comTenant(t, (tx) => gravarRetorno(tx, t, { versao_contrato: 'v1', pedido_uuid: uuid, status: 'integrado', numero_erp: '42', ocorrido_em: AGORA.toISOString() }, AGORA));
    await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [t, depois(-10)]);
    return uuid;
  }

  beforeAll(async () => {
    efemero = await criarBancoEfemero();
    adm = admSql(efemero);
    banco = efemero.banco('macuxierp_worker', 6);
  });
  afterAll(async () => {
    await efemero?.remover();
  });

  describe('busca de pedidos', () => {
    it('RN-PED-01: os pendentes do Hub são recebidos e entregues ao recebedor; próxima busca em 1 min', async () => {
      const { t, chave, conector } = await cenario('bp-ok', { busca: depois(-5) });
      const [u1, u2] = [U(), U()];
      const hub = hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [pedidoDoHub(u1), pedidoDoHub(u2)] })] });
      const antes = criados.length;
      const itens = await ciclo(banco, busca(), hub, AGORA, [t]);
      expect(itens).toEqual([{ tenant_id: t, tarefa: 'busca', chave: null }]);
      expect(criados.slice(antes).sort()).toEqual([u1, u2].sort());
      expect((await adm("SELECT pedido_uuid FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND estado = 'entregue'", [t])).length).toBe(2);
      expect(hub.chamadas).toHaveLength(1);
      expect(hub.chamadas[0]!.pedido).toMatchObject({ metodo: 'GET', caminho: '/pedidos/pendentes?limite=50' });
      expect(hub.chamadas[0]!.cred).toEqual({ conectorId: conector, chave, ambiente: 'teste' });
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(60).getTime());
      expect((await adm('SELECT ultimo_uso_em FROM integracao_fdv.credencial WHERE tenant_id = $1', [t]))[0]!.ultimo_uso_em).not.toBeNull();
    });

    it('RN-PED-01: lote cheio (50) busca de novo já; lista vazia espera o intervalo', async () => {
      const { t } = await cenario('bp-cheio', { busca: depois(-5) });
      const cheio = Array.from({ length: 50 }, () => pedidoDoHub(U()));
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: cheio })] }), AGORA, [t]);
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(AGORA.getTime());
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [] })] }), AGORA, [t]);
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(60).getTime());
    });

    it('RN-INF-04: 429 com Retry-After (ceil de ms para s) e 503 sem ele adiam pela curva, sem receber nada', async () => {
      const { t } = await cenario('bp-429', { busca: depois(-5) });
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [retentavel(429, 300_001)] }), AGORA, [t]);
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(301).getTime());
      await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [retentavel(503)] }), AGORA, [t]);
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(60).getTime());
      await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [retentavel(null, null, 'rede')] }), AGORA, [t]);
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(60).getTime());
    });

    it('RN-INF-03: 401 pausa a credencial e adia 1 h; depois disso o Hub nem é chamado', async () => {
      const { t } = await cenario('bp-401', { busca: depois(-5) });
      await cursorEntidade(efemero.admin, t, 'produto', { proximoEm: depois(+9999) });
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [recusa(401)] }), AGORA, [t]);
      expect((await adm("SELECT pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1", [t]))[0]!.pausada_motivo).toBe('credencial');
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(3600).getTime());
      await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      const hub = hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [] })] });
      await ciclo(banco, busca(), hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(0);
    });

    it('RN-PED-01: sem credencial não chama o Hub e volta em 1 h; erro da porta (credencial inválida) pausa', async () => {
      const a = await cenario('bp-sem', { busca: depois(-5) }, false);
      const hubA = hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [] })] });
      await ciclo(banco, busca(), hubA, AGORA, [a.t]);
      expect(hubA.chamadas).toHaveLength(0);
      expect((await sinal(a.t)).proxima_busca_pedidos_em.getTime()).toBe(depois(3600).getTime());
      const b = await cenario('bp-erro', { busca: depois(-5) });
      await cursorEntidade(efemero.admin, b.t, 'produto', { proximoEm: depois(+9999) });
      const lancador: ClienteHub = { chamar: async () => { throw new ErroClienteHub('credencial_invalida'); } };
      await ciclo(banco, busca(), lancador, AGORA, [b.t]);
      expect((await adm('SELECT pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [b.t]))[0]!.pausada_motivo).toBe('credencial');
      expect((await sinal(b.t)).proxima_busca_pedidos_em.getTime()).toBe(depois(3600).getTime());
    });

    it('RN-PED-01: módulo pedido sem licença no recebedor adia a busca 1 h (não desliga) e ela se recupera sozinha com a licença', async () => {
      const { t } = await cenario('bp-deslig', { busca: depois(-5) });
      let licenca = false;
      const recebedorLicenca: RecebedorPedidoFdv = {
        receber: async (_tx, e) => (licenca ? recebedor.receber(_tx, e) : { resultado: 'recusado', codigo: 'modulo_pedido_inativo' }),
      };
      const ag = criarAgendasPedidosFdv({ recebedor: recebedorLicenca, resolvedor, alertar, log, relogio }).find((a) => a.id === AGENDA_BUSCA_PEDIDOS_ID)!;
      const u = U();
      const hub = () => hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [pedidoDoHub(u)] })] });
      await ciclo(banco, ag, hub(), AGORA, [t]);
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(3600).getTime());
      expect(alertas).toContain(`${t}:recebimento_pedidos_desligado:{}`);
      licenca = true;
      expect(await ciclo(banco, ag, hub(), depois(3599), [t])).toEqual([]); // ainda dentro da hora
      await ciclo(banco, ag, hub(), depois(3600), [t]);
      expect((await adm('SELECT estado FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1 AND pedido_uuid = $2', [t, u]))[0]!.estado).toBe('entregue');
    });

    it('A4: a linha do sinal nasce com a busca de pedidos ligada (agora) e a coluna nula de linha antiga é ligada; valor já gravado não muda', async () => {
      const t = await criarTenant(efemero.admin, 'bp-nasce', ['integracao-fdv', 'pedido']);
      await banco.comTenant(t, (tx) => agendarEnvio(tx, t, new Set(), AGORA));
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(AGORA.getTime());
      await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [t, depois(500)]);
      await banco.comTenant(t, (tx) => agendarEnvio(tx, t, new Set(), depois(10)));
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(500).getTime());
      await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = NULL WHERE tenant_id = $1', [t]);
      await banco.comTenant(t, (tx) => agendarEnvio(tx, t, new Set(), depois(10)));
      expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(10).getTime());
    });

    it('V1: resposta de pendentes que não é { pedidos } (lista solta, itens) é erro: nada é recebido, a busca reagenda e loga pendentes_fora_do_contrato', async () => {
      const { t } = await cenario('bp-contrato', { busca: depois(-5) });
      const u = U();
      for (const corpo of [[pedidoDoHub(u)], { itens: [pedidoDoHub(u)] }]) {
        await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
        await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok(corpo)] }), AGORA, [t]);
        expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(depois(60).getTime());
      }
      expect(await adm('SELECT 1 FROM integracao_fdv.pedido_recebido WHERE tenant_id = $1', [t])).toEqual([]);
      expect(logs.join('\n')).toContain('pendentes_fora_do_contrato');
    });

    it('V3: perto do fim da posse (MARGEM) a busca não chama o Hub e volta já', async () => {
      const { t } = await cenario('bp-margem', { busca: depois(-5) });
      const hub = hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [pedidoDoHub(U())] })] });
      relogio.t = depois(POSSE_AGENDA_MS / 1000 - 30);
      try {
        await ciclo(banco, busca(), hub, AGORA, [t]);
        expect(hub.chamadas).toHaveLength(0);
        expect((await sinal(t)).proxima_busca_pedidos_em.getTime()).toBe(relogio.t.getTime());
      } finally {
        relogio.t = AGORA;
      }
    });
  });

  describe('retorno de pedidos', () => {
    it('RN-PED-05: o retorno pendente é enviado, confirmado e a agenda se desliga', async () => {
      const { t, chave } = await cenario('rp-ok', { retorno: depois(-10) });
      const uuid = await pedidoComRetorno(t);
      const hub = hubDuble({ [`POST /pedidos/${uuid}/retorno`]: [ok({ repetido: false })] });
      const itens = await ciclo(banco, retorno(), hub, AGORA, [t]);
      expect(itens).toEqual([{ tenant_id: t, tarefa: 'retorno', chave: null }]);
      expect(hub.chamadas[0]!.pedido).toMatchObject({ metodo: 'POST', caminho: `/pedidos/${uuid}/retorno`, corpo: { status: 'integrado', numero_erp: '42', pedido_uuid: uuid } });
      expect(hub.chamadas[0]!.cred.chave).toBe(chave);
      expect(await retornos(t)).toEqual([{ pedido_uuid: uuid, status: 'integrado', estado: 'enviado', tentativas: 1, resposta_http: 202 }]);
      expect((await sinal(t)).proximo_retorno_em).toBeNull();
    });

    it('RN-INF-04: 429 com Retry-After e 5xx reagendam pela curva do domain e contam tentativa', async () => {
      const { t } = await cenario('rp-429', { retorno: depois(-10) });
      const uuid = await pedidoComRetorno(t);
      const chave = `POST /pedidos/${uuid}/retorno`;
      await ciclo(banco, retorno(), hubDuble({ [chave]: [retentavel(429, 90_001)] }), AGORA, [t]);
      expect((await retornos(t))[0]).toMatchObject({ estado: 'pendente', tentativas: 1, resposta_http: 429 });
      expect((await sinal(t)).proximo_retorno_em.getTime()).toBe(depois(91).getTime()); // max(curva 5 s, ceil(90,001 s))
      await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, retorno(), hubDuble({ [chave]: [retentavel(503)] }), AGORA, [t]);
      expect((await retornos(t))[0]).toMatchObject({ estado: 'pendente', tentativas: 2, resposta_http: 503 });
      expect((await sinal(t)).proximo_retorno_em.getTime()).toBe(depois(10).getTime()); // 2ª tentativa: 10 s
      await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, retorno(), hubDuble({ [chave]: [retentavel(null, null, 'rede')] }), AGORA, [t]);
      expect((await retornos(t))[0]).toMatchObject({ tentativas: 3, resposta_http: null });
      expect((await sinal(t)).proximo_retorno_em.getTime()).toBe(depois(20).getTime());
    });

    it('RN-PED-05: 422 do Hub é definitivo (falhou) e 403 modulo_inativo pausa a credencial (licenca_fdv) sem gastar tentativa', async () => {
      const a = await cenario('rp-422', { retorno: depois(-10) });
      const ua = await pedidoComRetorno(a.t);
      await ciclo(banco, retorno(), hubDuble({ [`POST /pedidos/${ua}/retorno`]: [recusa(422, 'transicao_invalida')] }), AGORA, [a.t]);
      expect((await retornos(a.t))[0]).toMatchObject({ estado: 'falhou', resposta_http: 422 });
      expect(alertas).toContain(`${a.t}:retorno_recusado_pelo_hub:${JSON.stringify({ pedido_uuid: ua, codigo: 'transicao_invalida' })}`);
      const b = await cenario('rp-401', { retorno: depois(-10) });
      await cursorEntidade(efemero.admin, b.t, 'produto', { proximoEm: depois(+9999) });
      const ub = await pedidoComRetorno(b.t);
      await ciclo(banco, retorno(), hubDuble({ [`POST /pedidos/${ub}/retorno`]: [recusa(403, 'modulo_inativo')] }), AGORA, [b.t]);
      expect((await retornos(b.t))[0]).toMatchObject({ estado: 'pendente', tentativas: 0 });
      expect((await adm('SELECT pausada_motivo FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [b.t]))[0]!.pausada_motivo).toBe('licenca_fdv');
      expect((await sinal(b.t)).proximo_retorno_em.getTime()).toBe(depois(3600).getTime());
    });

    it('RN-INF-04: posse perdida (outra reserva já regravou) não é desfeita pela regravação final nem pelo desligar', async () => {
      const { t } = await cenario('rp-posse', { retorno: depois(-10) });
      const uuid = await pedidoComRetorno(t);
      const outra = depois(+500);
      // durante o HTTP outro worker pega o item (posse vencida): `proximo_retorno_em` já não é o `posseAte` desta reserva
      const hub: ClienteHub = {
        chamar: async () => {
          await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [t, outra]);
          return retentavel(429, 60_000);
        },
      };
      await ciclo(banco, retorno(), hub, AGORA, [t]);
      expect((await retornos(t))[0]).toMatchObject({ pedido_uuid: uuid, estado: 'pendente' });
      expect((await sinal(t)).proximo_retorno_em.getTime()).toBe(outra.getTime());
      // sucesso com a posse perdida no meio: o envio é confirmado, a fila esvazia, mas o desligar (NULL) não passa por cima do outro
      const b = await cenario('rp-posse-ok', { retorno: depois(-10) });
      const ub = await pedidoComRetorno(b.t);
      const hubOk: ClienteHub = {
        chamar: async () => {
          await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [b.t, outra]);
          return ok({});
        },
      };
      await ciclo(banco, retorno(), hubOk, AGORA, [b.t]);
      expect((await retornos(b.t))[0]).toMatchObject({ pedido_uuid: ub, estado: 'enviado' });
      expect((await sinal(b.t)).proximo_retorno_em.getTime()).toBe(outra.getTime());
    });

    it('A1: um agendarRetorno durante o envio tira a posse: a segunda rodada não chama o Hub nem regrava', async () => {
      const { t } = await cenario('rp-a1', { retorno: depois(-10) });
      const uuid = await pedidoComRetorno(t);
      await banco.comTenant(t, (tx) => gravarRetorno(tx, t, { versao_contrato: 'v1', pedido_uuid: uuid, status: 'cancelado', motivo: 'sem estoque', ocorrido_em: AGORA.toISOString() }, AGORA));
      await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [t, depois(-10)]);
      const hub = hubDuble({ [`POST /pedidos/${uuid}/retorno`]: [() => ok({})] });
      const chamar = hub.chamar.bind(hub);
      hub.chamar = async (cred, p) => {
        const r = await chamar(cred, p);
        await banco.comTenant(t, (tx) => agendarRetorno(tx, t, AGORA)); // `least(posse, agora)`: a coluna deixa de ser o `posseAte`
        return r;
      };
      await ciclo(banco, retorno(), hub, AGORA, [t]);
      expect(hub.chamadas).toHaveLength(1); // o 'integrado' (cabeça da fila); o 'cancelado' esperou e a 2ª rodada parou
      expect((await retornos(t)).map((x) => x.estado)).toEqual(['enviado', 'pendente']);
      expect((await sinal(t)).proximo_retorno_em.getTime()).toBe(AGORA.getTime()); // o wakeup do agendarRetorno vale
    });

    it('A2: o UPDATE do resultado é preso a estado = pendente: retorno que outro worker já resolveu não é regravado', async () => {
      const a = await cenario('rp-a2-ok', { retorno: depois(-10) });
      const ua = await pedidoComRetorno(a.t);
      const resolverFora = (t: string): Promise<unknown> => adm("UPDATE integracao_fdv.retorno_enviado SET estado = 'falhou', tentativas = 7, resposta_http = 422 WHERE tenant_id = $1", [t]);
      await ciclo(banco, retorno(), { chamar: async () => { await resolverFora(a.t); return ok({}); } }, AGORA, [a.t]);
      expect((await retornos(a.t))[0]).toMatchObject({ pedido_uuid: ua, estado: 'falhou', tentativas: 7, resposta_http: 422 });
      const b = await cenario('rp-a2-5xx', { retorno: depois(-10) });
      await pedidoComRetorno(b.t);
      await ciclo(banco, retorno(), { chamar: async () => { await resolverFora(b.t); return retentavel(503); } }, AGORA, [b.t]);
      expect((await retornos(b.t))[0]).toMatchObject({ estado: 'falhou', tentativas: 7, resposta_http: 422 });
      const c = await cenario('rp-a2-422', { retorno: depois(-10) });
      await pedidoComRetorno(c.t);
      await ciclo(banco, retorno(), { chamar: async () => { await resolverFora(c.t); return recusa(400, 'corpo_invalido'); } }, AGORA, [c.t]);
      expect((await retornos(c.t))[0]).toMatchObject({ estado: 'falhou', tentativas: 7, resposta_http: 422 });
    });

    it('A3: só 400 e 422 são definitivos; 404 e 409 reagendam pela curva e alertam retorno_hub_status_inesperado', async () => {
      for (const [status, codigo, esperado] of [[404, null, 'http_404'], [409, 'conflito_de_estado', 'conflito_de_estado']] as const) {
        const { t } = await cenario(`rp-a3-${status}`, { retorno: depois(-10) });
        const uuid = await pedidoComRetorno(t);
        await ciclo(banco, retorno(), hubDuble({ [`POST /pedidos/${uuid}/retorno`]: [recusa(status, codigo)] }), AGORA, [t]);
        expect((await retornos(t))[0]).toMatchObject({ estado: 'pendente', tentativas: 1, resposta_http: status });
        expect((await sinal(t)).proximo_retorno_em.getTime()).toBe(depois(5).getTime());
        expect(alertas).toContain(`${t}:retorno_hub_status_inesperado:${JSON.stringify({ pedido_uuid: uuid, codigo: esperado })}`);
        expect(alertas.some((x) => x.startsWith(`${t}:retorno_recusado_pelo_hub`))).toBe(false);
      }
      const { t } = await cenario('rp-a3-400', { retorno: depois(-10) });
      const uuid = await pedidoComRetorno(t);
      await ciclo(banco, retorno(), hubDuble({ [`POST /pedidos/${uuid}/retorno`]: [recusa(400, 'corpo_invalido')] }), AGORA, [t]);
      expect((await retornos(t))[0]).toMatchObject({ estado: 'falhou', resposta_http: 400 });
    });

    it('RN-INF-04: perto do fim da posse (MARGEM) o envio para sem chamar o Hub e o item volta já; com a posse perdida não regrava', async () => {
      const a = await cenario('rp-margem', { retorno: depois(-10) });
      const ua = await pedidoComRetorno(a.t);
      const hub = hubDuble({ [`POST /pedidos/${ua}/retorno`]: [ok({})] });
      relogio.t = depois(POSSE_AGENDA_MS / 1000 - 30); // agora >= posseAte - margem
      try {
        await ciclo(banco, retorno(), hub, AGORA, [a.t]);
        expect(hub.chamadas).toHaveLength(0);
        expect((await retornos(a.t))[0]).toMatchObject({ estado: 'pendente', tentativas: 0 });
        expect((await sinal(a.t)).proximo_retorno_em.getTime()).toBe(relogio.t.getTime());

        const b = await cenario('rp-margem2', { retorno: depois(-10) });
        await pedidoComRetorno(b.t);
        const lost = depois(+700);
        const passivo: ClienteHub = { chamar: async () => { throw new Error('não deveria chamar'); } };
        const posse = mais(AGORA, 120);
        const ag = retorno();
        const itens = await banco.semTenant((tx) => ag.reservar(tx, 100, AGORA, posse));
        expect(itens.some((i) => i.tenant_id === b.t)).toBe(true);
        await adm('UPDATE integracao_fdv.sinal SET proximo_retorno_em = $2 WHERE tenant_id = $1', [b.t, lost]);
        const item = { tenant_id: b.t, tarefa: 'retorno', chave: null };
        await ag.executar(item, contextoDaAgenda(banco, item, passivo, AGORA, posse));
        expect((await sinal(b.t)).proximo_retorno_em.getTime()).toBe(lost.getTime());
      } finally {
        relogio.t = AGORA;
      }
    });
  });

  describe('reserva, isolamento e sigilo', () => {
    it('C-9: reserva só a coluna da própria agenda, só vencidos, e adia para a posse; as colunas do conector ficam intocadas', async () => {
      const { t } = await cenario('res-a', { busca: depois(-5), retorno: depois(-5) });
      await adm('UPDATE integracao_fdv.sinal SET proximo_sinal_em = $2, proxima_reconciliacao_em = $2 WHERE tenant_id = $1', [t, depois(-7)]);
      await cursorEntidade(efemero.admin, t, 'produto', { proximoEm: depois(-7) });
      const posse = depois(120);
      const b = (await banco.semTenant((tx) => busca().reservar(tx, 100, AGORA, posse))).filter((i) => i.tenant_id === t);
      expect(b).toEqual([{ tenant_id: t, tarefa: 'busca', chave: null }]);
      let s = await sinal(t);
      expect([s.proxima_busca_pedidos_em, s.proximo_retorno_em, s.proximo_sinal_em, s.proxima_reconciliacao_em].map((d: Date) => d.getTime())).toEqual([posse.getTime(), depois(-5).getTime(), depois(-7).getTime(), depois(-7).getTime()]);
      // não reserva de novo (a posse ainda vale)
      expect((await banco.semTenant((tx) => busca().reservar(tx, 100, AGORA, posse))).filter((i) => i.tenant_id === t)).toEqual([]);
      const r = (await banco.semTenant((tx) => retorno().reservar(tx, 100, AGORA, posse))).filter((i) => i.tenant_id === t);
      expect(r).toEqual([{ tenant_id: t, tarefa: 'retorno', chave: null }]);
      s = await sinal(t);
      expect([s.proximo_retorno_em, s.proximo_sinal_em, s.proxima_reconciliacao_em].map((d: Date) => d.getTime())).toEqual([posse.getTime(), depois(-7).getTime(), depois(-7).getTime()]);
      expect((await adm("SELECT proximo_em FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1 AND entidade = 'produto'", [t]))[0]!.proximo_em.getTime()).toBe(depois(-7).getTime());
    });

    it('C-9: desligada (nulo) ou futura não é reservada; semLicenca adia 1 h e não liga o que está desligado', async () => {
      const { t } = await cenario('res-b', { busca: null, retorno: depois(+300) });
      const itens = await banco.semTenant(async (tx) => [...(await busca().reservar(tx, 100, AGORA, depois(120))), ...(await retorno().reservar(tx, 100, AGORA, depois(120)))]);
      expect(itens.filter((i) => i.tenant_id === t)).toEqual([]);
      await banco.comTenant(t, (tx) => busca().semLicenca({ tenant_id: t, tarefa: 'busca', chave: null }, tx, AGORA));
      await banco.comTenant(t, (tx) => retorno().semLicenca({ tenant_id: t, tarefa: 'retorno', chave: null }, tx, AGORA));
      const s = await sinal(t);
      expect(s.proxima_busca_pedidos_em).toBeNull();
      expect(s.proximo_retorno_em.getTime()).toBe(depois(3600).getTime());
    });

    it('RLS e credencial própria: dois tenants no mesmo ciclo usam a própria chave e cada um só vê os próprios pedidos', async () => {
      const a = await cenario('mt-a', { busca: depois(-5), retorno: depois(-10) });
      const b = await cenario('mt-b', { busca: depois(-5), retorno: depois(-10) });
      const [ua, ub] = [await pedidoComRetorno(a.t), await pedidoComRetorno(b.t)];
      const hub = hubDuble({
        [`POST /pedidos/${ua}/retorno`]: [ok({})],
        [`POST /pedidos/${ub}/retorno`]: [ok({})],
      });
      await ciclo(banco, retorno(), hub, AGORA, [a.t, b.t]);
      const por = (uuid: string) => hub.chamadas.filter((c) => c.pedido.caminho.includes(uuid));
      expect(por(ua).map((c) => c.cred.chave)).toEqual([a.chave]);
      expect(por(ub).map((c) => c.cred.chave)).toEqual([b.chave]);
      expect(hub.chamadas).toHaveLength(2);
      expect((await retornos(a.t)).map((x) => x.pedido_uuid)).toEqual([ua]);
      expect((await retornos(b.t)).map((x) => x.pedido_uuid)).toEqual([ub]);
      // a busca de A não cria pedido para B
      const u = U();
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [pedidoDoHub(u)] })] }), AGORA, [a.t]);
      expect((await adm('SELECT tenant_id FROM integracao_fdv.pedido_recebido WHERE pedido_uuid = $1', [u])).map((x) => x.tenant_id)).toEqual([a.t]);
      expect(await banco.comTenant(b.t, (tx) => tx.consultar('SELECT 1 FROM integracao_fdv.pedido_recebido WHERE pedido_uuid = $1', [u]))).toEqual([]);
    });

    it('RN-SEG: a chave do conector nunca vai a log, alerta, evento nem às tabelas do módulo', async () => {
      const { t } = await cenario('seg', { busca: depois(-5), retorno: depois(-10) });
      await cursorEntidade(efemero.admin, t, 'produto', { proximoEm: depois(+9999) });
      const uuid = await pedidoComRetorno(t);
      await ciclo(banco, retorno(), hubDuble({ [`POST /pedidos/${uuid}/retorno`]: [retentavel(500, null, 'falha_interna')] }), AGORA, [t]);
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [ok({ pedidos: [{ pedido_uuid: U(), lixo: true }, pedidoDoHub(U())] })] }), AGORA, [t]);
      await adm('UPDATE integracao_fdv.sinal SET proxima_busca_pedidos_em = $2 WHERE tenant_id = $1', [t, depois(-1)]);
      await ciclo(banco, busca(), hubDuble({ 'GET /pedidos/pendentes?limite=50': [recusa(401)] }), AGORA, [t]);
      const todo = JSON.stringify([logs, alertas]);
      expect(todo).not.toContain(CHAVE_CLARA);
      for (const tabelaSql of ['sinal', 'retorno_enviado', 'pedido_recebido', 'cursor_entidade']) {
        expect(JSON.stringify(await adm(`SELECT * FROM integracao_fdv.${tabelaSql} WHERE tenant_id = $1`, [t]))).not.toContain(CHAVE_CLARA);
      }
      expect(JSON.stringify(await adm('SELECT * FROM plataforma.evento WHERE tenant_id = $1', [t]))).not.toContain(CHAVE_CLARA);
    });
  });
});
