/**
 * T-0108 (decisões 14 A, 16 A e 17 B do Alexandre; RN-CAD-15): de ponta a ponta, a rotina diária do worker
 * `cadastros.completar-prazo-medio` conserta a condição de pagamento legada que tinha ido ao Hub com o prazo médio vazio:
 * rotina → `cadastros.condicao_pagamento.alterada@1` → consumidor do espelho (`registro_publicado`) → agenda do conector →
 * Hub (dublê) aceita → o `lote_erro` antigo da mesma chave fica resolvido (`resolvido_em` e `resolvido_no_lote_envio_id`).
 *
 * Tudo é o código do `main` montado como o `apps/worker` monta: `montarRotinas` (com o interruptor
 * `completarPrazoMedioLigado`), `rodarRotinas`, `montarConsumidores` pelo despachante real da outbox, `montarAgendas` com o
 * envio ligado e `rodarAgendas`, o cliente HTTP do SDK contra o dublê do Hub (`apoio/duble-hub.ts`), PostgreSQL efêmero com
 * RLS (papéis `macuxierp_app` na API e `macuxierp_worker` no worker) e o relógio de teste numa linha do tempo só.
 * Só o estado legado é semeado por SQL: a condição com `prazo_medio_dias` nulo (o cadastro de hoje já calcula, T-0107) e a
 * linha do espelho dela sem `prazo_medio_dias`, como saía antes da RN-CAD-15 no conector. O primeiro lote (o que volta com o
 * erro por linha) é montado e enviado pelo próprio conector.
 * Casos: interruptor desligado não mexe; ligado completa só a vazia (a digitada fica, com a marca false); o lote aceito
 * resolve o erro antigo; a segunda rodada não gera evento nem lote. Dados fictícios. Sem Postgres pula; com
 * MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decifrarCampo } from '../../packages/platform-sdk/src/index';
import { LicencasPg, type BancoPg } from '../../packages/platform-sdk/src/pg';
import { PG_DISPONIVEL } from '../../packages/platform-sdk/src/pg-testes';
import { rodarAgendas } from '../../apps/worker/src/agenda';
import { completarPrazoMedioLigado, ROTINA_COMPLETAR_PRAZO_MEDIO } from '../../apps/worker/src/completar-prazo-medio';
import { montarAgendas, montarConsumidores, montarRotinas } from '../../apps/worker/src/modulos';
import { montarPedidosFdv } from '../../apps/worker/src/pedidos-fdv';
import { rodarRotinas, type EstadoRotinas } from '../../apps/worker/src/rotinas';
import { criarResolvedorChaveErp, repositoriosSql } from '../../modules/cadastros/api/index';
import { CHAVE_MESTRA, criarCredencial } from '../../modules/integracao-fdv/api/apoio-conector-teste';
import type { EstadoLote } from '../../modules/integracao-fdv/contracts/index';
import { hashRegistro, mapearCondicaoOpcional } from '../../modules/integracao-fdv/domain/index';
import { montarApiPg } from '../apoio/api-pg';
import { clienteDoSdk } from './apoio/adaptador-conector';
import { CredencialHub } from './apoio/config';
import { criarDubleHub, type DubleHub } from './apoio/duble-hub';
import { criarRegistroLgpd, despacharAteEsvaziar } from './apoio/erp-pedidos';
import { RelogioDeTeste } from './apoio/relogio';

const INICIO = new Date('2026-11-26T12:00:00.000Z');
const DIA_MS = 86_400_000;
const EVENTO = 'cadastros.condicao_pagamento.alterada@1';
/** Chaves do Hub (ADR 0010): a condição legada e a digitada; a forma é a do tPag 15 (boleto), comum às duas. */
const LEGADA = { id: randomUUID(), external_id: 'PZ-3045', codigo: '30-45', descricao: 'Boleto 30 e 45', prazos: [30, 45] };
const DIGITADA = { external_id: 'PZ-3060', codigo: '30-60', descricao: 'Boleto 30 e 60', prazos: [30, 60], medio: 40 };
/** Tenant B: condição legada, sem a licença do integracao-fdv (o espelho não grava, M9). */
const LEGADA_B = { id: randomUUID(), codigo: '28', descricao: 'Boleto 28', prazos: [28] };
const ESTADOS_FINAIS_LOTE_ENVIO: readonly EstadoLote[] = ['concluido', 'concluido_com_erros', 'falhou', 'recusado'];

type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!PG_DISPONIVEL)('T-0108 — prazo médio completado pela rotina resolve o lote_erro antigo (dublê do Hub + PostgreSQL)', () => {
  const relogio = new RelogioDeTeste(INICIO);
  const reg = criarRegistroLgpd();
  let api: Awaited<ReturnType<typeof montarApiPg<'A' | 'B'>>>;
  let worker: BancoPg;
  let duble: DubleHub;
  let hub: ReturnType<typeof clienteDoSdk>['cliente'];
  const estadoRotinas: EstadoRotinas = new Map();
  const adm = async (sql: string, p: unknown[] = []): Promise<Linha[]> => (await api.b.admin.query(sql, p)).rows;

  const condicao = async (t: string, id: string) =>
    (await adm('SELECT prazo_medio_dias, prazo_medio_calculado FROM cadastros.condicao_pagamento WHERE tenant_id = $1 AND id = $2', [t, id]))[0]!;
  const eventosDe = async (t: string, agregado: string) =>
    (await adm(`SELECT payload->'payload' AS dados FROM plataforma.evento WHERE tenant_id = $1 AND nome = $2 AND agregado_id = $3 ORDER BY ocorrido_em`, [t, EVENTO, agregado])).map((e) => e.dados as Linha);
  const espelho = async (chave: string) =>
    (await adm(
      `SELECT payload, hash, hash_confirmado, pendente, ultimo_lote_envio_id FROM integracao_fdv.registro_publicado
        WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND registro_external_id = $2 AND deleted_at IS NULL`,
      [api.t.A, chave],
    ))[0];
  const errosDe = (chave: string) =>
    adm(
      `SELECT lote_envio_id, origem, codigo, campo, resolvido_em, resolvido_no_lote_envio_id FROM integracao_fdv.lote_erro
        WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND registro_external_id = $2 ORDER BY created_at`,
      [api.t.A, chave],
    );
  const lotesDePrazo = () =>
    adm(`SELECT id, estado, corpo FROM integracao_fdv.lote_envio WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' ORDER BY created_at, geracao`, [api.t.A]);
  const postsDeLote = () => duble.requisicoes.filter((r) => r.metodo === 'POST' && r.caminho.endsWith('/lotes')).length;

  /** As rotinas diárias como o `main.ts` monta, com o interruptor lido do ambiente dado. */
  const rotinas = (env: Record<string, string | undefined>) => montarRotinas({ banco: worker, log: reg.pino, completarPrazoMedio: completarPrazoMedioLigado(env) });
  const despachar = () => despacharAteEsvaziar({ banco: worker, relogio, consumidores: montarConsumidores({ log: reg.pino, relogio }), log: reg.pino });
  /** Voltas do laço de agenda (envio ligado) até não sobrar lote em voo nem registro pendente no espelho do tenant A. */
  async function assentar(): Promise<void> {
    const pecas = montarPedidosFdv({ log: reg.pino as never, relogio, recebimento: 'desligado', resolvedor: criarResolvedorChaveErp(repositoriosSql), aditivosCliente: false });
    const agendas = montarAgendas({ log: reg.pino, relogio, pedidosFdv: pecas, envio: 'ligado' });
    const decifrarCredencial = (cifrada: Buffer, tenantId: string) => decifrarCampo({ chave: CHAVE_MESTRA, tenantId, cifrado: cifrada }).toString('utf8');
    for (let i = 0; i < 20; i++) {
      const r = await rodarAgendas(agendas, { banco: worker, licencas: new LicencasPg(), hub, decifrarCredencial: decifrarCredencial as never, relogio, log: reg.pino });
      expect(r.falhas, `volta ${i} da agenda`).toBe(0);
      const emVoo = (await lotesDePrazo()).filter((l) => !ESTADOS_FINAIS_LOTE_ENVIO.includes(l.estado as EstadoLote)).length;
      const pendentes = (await adm('SELECT count(*)::int AS n FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND pendente AND deleted_at IS NULL', [api.t.A]))[0]!.n as number;
      if (emVoo === 0 && pendentes === 0) return;
      relogio.avancar(16 * 60_000); // passa a curva longa da retentativa e a espera da consulta
    }
    const diag = {
      lotes: (await adm('SELECT entidade, estado, modo, ultimo_erro_codigo, contagens FROM integracao_fdv.lote_envio WHERE tenant_id = $1 ORDER BY created_at', [api.t.A])),
      cursores: await adm('SELECT entidade, proximo_em, pausada_motivo, cursor_external_id FROM integracao_fdv.cursor_entidade WHERE tenant_id = $1', [api.t.A]),
      pendentes: await adm('SELECT entidade, registro_external_id FROM integracao_fdv.registro_publicado WHERE tenant_id = $1 AND pendente', [api.t.A]),
      req: duble.requisicoes.map((r) => `${r.metodo} ${r.caminho} ${r.status}`),
      logs: reg.logs.slice(-10),
    };
    throw new Error(`a agenda não assentou em 20 voltas: ${JSON.stringify(diag)}`);
  }

  beforeAll(async () => {
    api = await montarApiPg({ A: ['cadastros', 'integracao-fdv'], B: ['cadastros'] }, { relogio });
    worker = api.b.banco('macuxierp_worker', 4);
    duble = await criarDubleHub({ relogio });
    const c = duble.registrarConector({ tenant: 'fdv-a', conectorId: 'macuxierp-a' });
    await criarCredencial(api.b.admin, api.t.A, { conector: c.conectorId, chave: c.chave });
    hub = clienteDoSdk({ url: duble.url, credencial: new CredencialHub(c.conectorId, c.chave), versaoErp: 'dev' }).cliente;

    // estado legado (antes da T-0107): condição gravada sem prazo médio, nos dois tenants
    const legada = (t: string, x: { id: string; codigo: string; descricao: string; prazos: number[] }, ext: string | null) =>
      adm(
        `INSERT INTO cadastros.condicao_pagamento (id, tenant_id, codigo, descricao, forma_tpag, prazos_dias, prazo_medio_dias, external_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '15', $5, NULL, $6, $7, $7)`,
        [x.id, t, x.codigo, x.descricao, x.prazos, ext, new Date(INICIO.getTime() - 30 * DIA_MS)],
      );
    await legada(api.t.A, LEGADA, LEGADA.external_id);
    await legada(api.t.B, LEGADA_B, null);
    // ... e a linha do espelho dela como o conector a montava antes da RN-CAD-15: sem `prazo_medio_dias`, pendente de envio
    const antigo = new Date(INICIO.getTime() - 2 * DIA_MS).toISOString();
    const ev = { id: LEGADA.id, codigo: LEGADA.codigo, descricao: LEGADA.descricao, forma_tpag: '15', prazos_dias: LEGADA.prazos, prazo_medio_dias: 0, parcelas_cartao: null, forma_external_id: null, forma_codigo: null, forma_nome: null, external_id: LEGADA.external_id, inativo: false };
    const { prazo } = mapearCondicaoOpcional(ev as never, antigo, { tenantId: api.t.A, formaAtiva: true });
    const { prazo_medio_dias: _sem, ...payload } = prazo!.payload;
    await adm(
      `INSERT INTO integracao_fdv.registro_publicado (tenant_id, entidade, registro_external_id, payload, hash, alterado_em, fonte_ocorrido_em, fonte_refs, ativo, pendente, erp_id)
       VALUES ($1, 'prazo_pagamento', $2, $3::jsonb, $4, $5, $5, '{}'::jsonb, true, true, $6)`,
      [api.t.A, LEGADA.external_id, JSON.stringify(payload), hashRegistro(payload), antigo, LEGADA.id],
    );
  }, 180_000);
  afterAll(async () => {
    await duble?.fechar();
    await api?.fechar();
  });

  it('pré-condição: a digitada entra pelo BKO e chega ao Hub; a legada vai sem prazo médio e o lote volta com erro por linha da chave dela', async () => {
    const r = await api.chamar('A', 'POST', '/v1/cadastros/condicoes-pagamento', {
      codigo: DIGITADA.codigo, descricao: DIGITADA.descricao, forma_tpag: '15', prazos_dias: DIGITADA.prazos, prazo_medio_dias: DIGITADA.medio, external_id: DIGITADA.external_id,
    });
    expect(r.statusCode, r.body).toBe(201);
    await despachar();
    await assentar();

    expect(duble.registro('fdv-a', 'prazo_pagamento', DIGITADA.external_id)).toMatchObject({ prazo_medio_dias: DIGITADA.medio });
    expect(duble.registro('fdv-a', 'prazo_pagamento', LEGADA.external_id)).toBeNull();
    const erros = await errosDe(LEGADA.external_id);
    expect(erros).toEqual([expect.objectContaining({ origem: 'erp', codigo: 'campo_obrigatorio', campo: 'prazo_medio_dias', resolvido_em: null, resolvido_no_lote_envio_id: null })]);
    const [lote] = (await lotesDePrazo()).filter((l) => l.id === erros[0]!.lote_envio_id);
    expect(lote!.estado).toBe('concluido_com_erros');
    // linha inválida firme: sai da fila até o cadastro mudar
    expect(await espelho(LEGADA.external_id)).toMatchObject({ pendente: false, hash_confirmado: null });
  });

  it('interruptor desligado (decisão 16 A): a rotina sai do laço e a condição legada, o espelho e o lote_erro ficam como estão', async () => {
    const lotesAntes = (await lotesDePrazo()).length;
    await rodarRotinas(rotinas({ MACUXIERP_COMPLETAR_PRAZO_MEDIO: 'desligado' }), new Map(), relogio.agora(), reg.pino);
    await despachar();
    await assentar();
    expect(await condicao(api.t.A, LEGADA.id)).toEqual({ prazo_medio_dias: null, prazo_medio_calculado: false });
    expect(await condicao(api.t.B, LEGADA_B.id)).toEqual({ prazo_medio_dias: null, prazo_medio_calculado: false });
    expect(await eventosDe(api.t.A, LEGADA.id)).toEqual([]);
    expect((await lotesDePrazo()).length).toBe(lotesAntes);
    expect((await errosDe(LEGADA.external_id)).map((e) => e.resolvido_em)).toEqual([null]);
  });

  it('ligado (padrão): completa só a vazia com a média das parcelas e a marca true (decisão 17 B); a digitada não é sobrescrita; um evento por condição completada', async () => {
    const digitadaId = (await adm('SELECT id FROM cadastros.condicao_pagamento WHERE tenant_id = $1 AND external_id = $2', [api.t.A, DIGITADA.external_id]))[0]!.id as string;
    const eventosDigitadaAntes = (await eventosDe(api.t.A, digitadaId)).length;

    expect(await rodarRotinas(rotinas({}).filter((x) => x.id === ROTINA_COMPLETAR_PRAZO_MEDIO), estadoRotinas, relogio.agora(), reg.pino)).toBe(1);

    expect(await condicao(api.t.A, LEGADA.id)).toEqual({ prazo_medio_dias: 38, prazo_medio_calculado: true }); // (30 + 45) / 2 = 37,5 → 38
    expect(await condicao(api.t.B, LEGADA_B.id)).toEqual({ prazo_medio_dias: 28, prazo_medio_calculado: true });
    expect(await condicao(api.t.A, digitadaId)).toEqual({ prazo_medio_dias: DIGITADA.medio, prazo_medio_calculado: false });
    expect(await eventosDe(api.t.A, LEGADA.id)).toEqual([expect.objectContaining({ id: LEGADA.id, prazo_medio_dias: 38, external_id: LEGADA.external_id })]);
    expect(await eventosDe(api.t.B, LEGADA_B.id)).toHaveLength(1);
    expect((await eventosDe(api.t.A, digitadaId)).length).toBe(eventosDigitadaAntes);
  });

  it('evento → espelho → lote aceito pelo Hub: o lote_erro antigo da mesma chave fica resolvido no lote novo', async () => {
    const antes = await espelho(LEGADA.external_id);
    await despachar();
    const depois = await espelho(LEGADA.external_id);
    expect(depois!.payload).toMatchObject({ external_id: LEGADA.external_id, prazo_medio_dias: 38, parcelas_dias: LEGADA.prazos });
    expect(depois!.hash).not.toBe(antes!.hash);
    expect(depois!.pendente).toBe(true);
    // tenant B sem a licença do integracao-fdv: nada no espelho
    expect(await adm('SELECT 1 FROM integracao_fdv.registro_publicado WHERE tenant_id = $1', [api.t.B])).toEqual([]);

    await assentar();

    expect(duble.registro('fdv-a', 'prazo_pagamento', LEGADA.external_id)).toMatchObject({ prazo_medio_dias: 38, parcelas_dias: LEGADA.prazos });
    const final = await espelho(LEGADA.external_id);
    expect(final).toMatchObject({ pendente: false, hash_confirmado: depois!.hash });
    const novo = (await lotesDePrazo()).find((l) => l.id === final!.ultimo_lote_envio_id)!;
    expect(novo.estado).toBe('concluido');
    expect((novo.corpo.registros as Linha[]).map((x) => x.external_id)).toContain(LEGADA.external_id);
    const erros = await errosDe(LEGADA.external_id);
    expect(erros).toHaveLength(1); // o lote novo não gera erro para a chave
    expect(erros[0]!.lote_envio_id).not.toBe(novo.id);
    expect(erros[0]!.resolvido_no_lote_envio_id).toBe(novo.id);
    expect(erros[0]!.resolvido_em).not.toBeNull();
    // nenhum erro de prazo aberto no tenant (o que o BKO mostra como pendência)
    expect(await adm(`SELECT 1 FROM integracao_fdv.lote_erro WHERE tenant_id = $1 AND entidade = 'prazo_pagamento' AND resolvido_em IS NULL`, [api.t.A])).toEqual([]);
  });

  it('idempotência: a rodada do dia seguinte não acha nada, não gera evento nem lote e não toca no erro resolvido', async () => {
    const resolvido = (await errosDe(LEGADA.external_id))[0]!;
    const [posts, lotes] = [postsDeLote(), (await lotesDePrazo()).length];
    // o mesmo dia: o laço não roda de novo
    expect(await rodarRotinas(rotinas({}).filter((x) => x.id === ROTINA_COMPLETAR_PRAZO_MEDIO), estadoRotinas, relogio.agora(), reg.pino)).toBe(0);
    relogio.avancar(DIA_MS);
    const [rotina] = rotinas({}).filter((x) => x.id === ROTINA_COMPLETAR_PRAZO_MEDIO);
    await rotina!.executar(relogio.agora());
    await despachar();
    await assentar();
    expect(await eventosDe(api.t.A, LEGADA.id)).toHaveLength(1);
    expect(await eventosDe(api.t.B, LEGADA_B.id)).toHaveLength(1);
    expect(await condicao(api.t.A, LEGADA.id)).toEqual({ prazo_medio_dias: 38, prazo_medio_calculado: true });
    expect((await lotesDePrazo()).length).toBe(lotes);
    expect(postsDeLote()).toBe(posts);
    expect((await errosDe(LEGADA.external_id))[0]).toEqual(resolvido);
  });

  it('LGPD: o log da bateria leva só contagens e ids, sem código nem descrição das condições', () => {
    expect(reg.logs.length).toBeGreaterThan(0);
    const textos = [LEGADA.descricao, DIGITADA.descricao, LEGADA_B.descricao];
    expect(reg.logs.filter((l) => textos.some((t) => l.includes(t)))).toEqual([]);
  });
});
