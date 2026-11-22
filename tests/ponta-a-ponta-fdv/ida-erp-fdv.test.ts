/**
 * T-0012 (F2): ida ERP → FDV de ponta a ponta. Critério de aceite: o tenant de teste recebe tudo sem erro e o reenvio
 * não duplica. Plano, matriz e como rodar: docs/testes/T-0012.md.
 *
 * O mesmo arquivo roda contra o dublê (padrão) ou contra o tenant de TESTE do FDV (`MACUXI_HUB_ALVO=real`, com a trava
 * de `apoio/config.ts`). Os cenários só usam a porta `LadoErp` e o que o Hub responde; a inspeção direta do estado
 * (`alvo.duble`) é checagem a mais, só no dublê. No dublê, os cenários rodam com os dois adaptadores do lado ERP
 * (`conector`, o código do ERP; `emissor-minimo`, o do arnês); no real, só com o de `MACUXI_HUB_LADO_ERP`. Os cenários
 * que forçam falha no Hub (429, 503, 426) só existem no dublê (`it.runIf(DUBLE)`): no tenant real não há como provocá-las.
 *
 * Perfil `thathyany-seguro` (decisão de 21/11/2026 23h12 de Manaus): os cenários com a massa sintética e o A-01 não
 * rodam; só rodam "carga idêntica" e "reenvio idempotente", com a massa do kit (`MACUXI_HUB_MASSA_KIT`) e lotes pequenos
 * (último bloco deste arquivo). No dublê, o mesmo par roda "como na thathyany hoje" (o kit dono de tudo) e depois de
 * uma virada parcial, com uma massa do kit fictícia.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { EVENTOS } from '../../modules/cadastros/contracts/index';
import { mapearFilial } from '../../modules/integracao-fdv/domain/mapeamento';
import { CONECTOR_DUBLE, prepararAlvo, type Alvo } from './apoio/alvo';
import {
  cenarioPermitido,
  exigirCenario,
  lerConfigHub,
  LIMITE_LOTE_SEGURO_PADRAO,
  type NomeCenario,
} from './apoio/config';
import { ORDEM_CARGA_HUB, ORDEM_DO_ERP, type EntidadeHub, type RegistroHub } from './apoio/contrato-hub';
import type { LadoErp, LoteEnviado, NomeLadoErp } from './apoio/lado-erp';
import {
  cnpjFicticio,
  criarRodada,
  massaKitFicticia,
  montarMassa,
  titulosEmMassa,
  type Massa,
} from './apoio/massa';
import { lerMassaKit, type MassaKit } from './apoio/massa-kit';
import {
  cargaIdentica,
  reenvioIdempotente,
  valoresDaMassa,
  type ResultadoCargaIdentica,
} from './apoio/modo-seguro';

const config = lerConfigHub();
const DUBLE = config.alvo === 'duble';
const PRAZO = DUBLE ? 60_000 : 15 * 60_000;
const INICIO_DUBLE = new Date('2026-11-21T15:00:00.000Z');
/** Base dos `alterado_em` da massa (UTC). Datas posteriores (delta, títulos em volume) somam a partir dela. */
const BASE_MASSA = new Date('2026-11-21T12:00:00.000Z');
const depois = (min: number) => new Date(BASE_MASSA.getTime() + min * 60_000);
/** Rodada desta execução: todo código de filial sai do mesmo contador (sem colisão dentro da rodada). */
const RODADA = criarRodada();
const LADOS: readonly NomeLadoErp[] = DUBLE ? ['conector', 'emissor-minimo'] : [config.ladoErp];
/** Os cenários com a massa sintética nunca rodam no perfil thathyany-seguro (só no dublê e no tenant de teste). */
const LADOS_SINTETICOS = cenarioPermitido(config, 'carga-sintetica') ? LADOS : [];
/** Segunda barreira, dentro de cada cenário: recusa o que o perfil não permite. */
const exigir = (...nomes: NomeCenario[]) => nomes.forEach((n) => exigirCenario(config, n));

const ultimoPar = (rs: readonly RegistroHub[]) => {
  const u = [...rs]
    .sort(
      (a, b) =>
        a.alterado_em.localeCompare(b.alterado_em) ||
        Buffer.compare(Buffer.from(a.external_id), Buffer.from(b.external_id)),
    )
    .at(-1)!;
  return { alterado_em: u.alterado_em, external_id: u.external_id };
};

/** Todo lote aceito (202), concluído sem erro por linha. */
function semErro(lotes: readonly LoteEnviado[]): void {
  expect(lotes.length).toBeGreaterThan(0);
  for (const l of lotes) {
    expect({ entidade: l.entidade, recusa: l.recusa, pausada: l.pausada, http: l.http }).toEqual({
      entidade: l.entidade,
      recusa: null,
      pausada: null,
      http: 202,
    });
    expect({ entidade: l.entidade, status: l.resultado?.status, erros: l.resultado?.erros }).toEqual({
      entidade: l.entidade,
      status: 'concluido',
      erros: [],
    });
    expect(l.resultado?.contagens.com_erro).toBe(0);
  }
}
const soma = (lotes: readonly LoteEnviado[], campo: 'novas' | 'atualizadas' | 'inalteradas' | 'recebidas') =>
  lotes.reduce((s, l) => s + (l.resultado?.contagens[campo] ?? 0), 0);

/** A espera nunca é menor que o `Retry-After` pedido pelo Hub (o conector pode esperar mais: curva de 5 s em diante). */
function respeitouRetryAfter(l: LoteEnviado, status: number): void {
  expect(l.tentativas.map((t) => t.status)).toEqual([status]);
  const t = l.tentativas[0]!;
  expect(t.retryAfterMs).not.toBeNull();
  expect(t.esperouMs).toBeGreaterThanOrEqual(t.retryAfterMs!);
}

describe.each(LADOS_SINTETICOS)(
  `T-0012 — ida ERP → FDV de ponta a ponta (alvo: ${config.alvo}, lado ERP: %s)`,
  (lado) => {
    let alvo: Alvo;
    let erp: LadoErp;
    let massa: Massa;
    let saidaPadrao: MockInstance;
    let saidaErro: MockInstance;
    const carga = new Map<EntidadeHub, LoteEnviado[]>();
    const registrosDe = (e: EntidadeHub): RegistroHub[] => massa.registros[e] ?? [];

    beforeAll(async () => {
      saidaPadrao = vi.spyOn(process.stdout, 'write');
      saidaErro = vi.spyOn(process.stderr, 'write');
      alvo = await prepararAlvo(config, { inicioDuble: INICIO_DUBLE });
      erp = alvo.criarLadoErp(lado);
      massa = montarMassa(BASE_MASSA, RODADA);
    });

    afterAll(async () => {
      saidaPadrao.mockRestore();
      saidaErro.mockRestore();
      await alvo?.encerrar();
    });

    it(
      'carga completa na ordem do Hub: filial → vendedor → formas e prazos → produtos e unidades → preços → estoque → clientes e endereços → títulos, tudo sem erro',
      { timeout: PRAZO },
      async () => {
        exigir(
          'carga-sintetica',
          ...(config.modoCarga === 'completo' ? (['carga-completa', 'inativacao'] as const) : []),
        );
        for (const entidade of ORDEM_DO_ERP) {
          const lotes = await erp.publicar({
            entidade,
            modo: config.modoCarga,
            registros: registrosDe(entidade),
          });
          carga.set(entidade, lotes);
          semErro(lotes);
          expect(soma(lotes, 'novas')).toBe(registrosDe(entidade).length);
          expect(await erp.consultarCursor(entidade)).toEqual(ultimoPar(registrosDe(entidade)));
        }
        const ordem = alvo.logs.filter((l) => l.evento === 'lote_aceito').map((l) => l.entidade);
        expect(ordem).toEqual(ORDEM_DO_ERP);
        if (alvo.duble) {
          for (const e of ORDEM_DO_ERP) expect(alvo.duble.contar(alvo.tenant, e)).toBe(registrosDe(e).length);
          // a carteira vai no cliente (D7): o vendedor do cliente é o da carteira do ERP
          expect(
            alvo.duble.registro(alvo.tenant, 'cliente', massa.ids.clientes[0])?.vendedor_external_id,
          ).toBe(massa.ids.vendedores[0]);
          expect(
            alvo.duble.registro(alvo.tenant, 'cliente', massa.ids.clientes[2])?.vendedor_external_id,
          ).toBeUndefined();
        }
      },
    );

    it.runIf(DUBLE)(
      'toda chamada leva X-Macuxi-Conector-Versao 1.4.0, o Conector e User-Agent macuxierp/<versão do ERP>',
      () => {
        expect(alvo.duble!.requisicoes.length).toBeGreaterThan(0);
        for (const r of alvo.duble!.requisicoes) {
          expect(r.cabecalhos).toMatchObject({
            'x-macuxi-conector-versao': '1.4.0',
            'x-macuxi-conector-id': alvo.credencial.conectorId,
            'user-agent': `macuxierp/${config.versaoErp}`,
            authorization: 'Bearer mxc_***',
          });
          expect(r.status).toBeLessThan(400);
          if (r.metodo === 'POST') expect(r.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
        }
      },
    );

    it(
      'reenvio idêntico (mesmo corpo, mesma Idempotency-Key): Idempotent-Replay, mesmo lote_id, nada muda',
      { timeout: PRAZO },
      async () => {
        exigir('reenvio-identico');
        const antes = alvo.duble ? ORDEM_DO_ERP.map((e) => alvo.duble!.contar(alvo.tenant, e)) : [];
        for (const entidade of ORDEM_DO_ERP) {
          const cursor = await erp.consultarCursor(entidade);
          for (const original of carga.get(entidade)!) {
            const r = await erp.reenviar(original);
            expect({ entidade, replay: r.replay, http: r.http, loteId: r.loteId }).toEqual({
              entidade,
              replay: true,
              http: 202,
              loteId: original.loteId,
            });
            expect(r.resultado?.contagens).toEqual(original.resultado?.contagens);
          }
          expect(await erp.consultarCursor(entidade)).toEqual(cursor);
        }
        if (alvo.duble) expect(ORDEM_DO_ERP.map((e) => alvo.duble!.contar(alvo.tenant, e))).toEqual(antes);
      },
    );

    it(
      'remontagem do mesmo conteúdo (geração nova, chave nova): o Hub não duplica — tudo inalterado, nada novo',
      { timeout: PRAZO },
      async () => {
        exigir('remontagem', ...(config.modoCarga === 'completo' ? (['carga-completa'] as const) : []));
        for (const entidade of ORDEM_DO_ERP) {
          const lotes = await erp.publicar({
            entidade,
            modo: config.modoCarga,
            registros: registrosDe(entidade),
            geracao: 2,
          });
          semErro(lotes);
          expect(lotes.every((l) => !l.replay)).toBe(true);
          expect({
            entidade,
            novas: soma(lotes, 'novas'),
            atualizadas: soma(lotes, 'atualizadas'),
            inalteradas: soma(lotes, 'inalteradas'),
          }).toEqual({
            entidade,
            novas: 0,
            atualizadas: 0,
            inalteradas: registrosDe(entidade).length,
          });
          if (alvo.duble) {
            expect(alvo.duble.contar(alvo.tenant, entidade)).toBe(registrosDe(entidade).length);
            if (config.modoCarga === 'completo')
              expect(lotes.at(-1)?.resultado?.inativacao).toEqual({
                situacao: 'nada_a_inativar',
                quantidade: 0,
              });
          }
        }
      },
    );

    it(
      'delta: só o que mudou vai; alteração, inativação e registro novo; o cursor avança',
      { timeout: PRAZO },
      async () => {
        exigir('delta', 'dado-novo', 'inativacao');
        const cliente = {
          ...registrosDe('cliente')[0]!,
          alterado_em: depois(30).toISOString(),
          nome_fantasia: `Mercadinho Novo ${massa.execucao}`,
        };
        const titulo = { ...registrosDe('titulo')[2]!, alterado_em: depois(31).toISOString(), ativo: false };
        const prazo = {
          ...registrosDe('prazo_pagamento')[1]!,
          external_id: crypto.randomUUID(),
          alterado_em: depois(32).toISOString(),
          codigo: `35-${massa.execucao}`,
          parcelas_dias: '35',
          descricao: 'Boleto 35',
        };
        const casos: [EntidadeHub, RegistroHub, 'atualizadas' | 'novas'][] = [
          ['prazo_pagamento', prazo, 'novas'],
          ['cliente', cliente, 'atualizadas'],
          ['titulo', titulo, 'atualizadas'],
        ];
        for (const [entidade, registro, campo] of casos) {
          const lotes = await erp.publicar({ entidade, modo: 'delta', registros: [registro] });
          semErro(lotes);
          expect(lotes.map((l) => [l.modo, l.registros, l.parte])).toEqual([['delta', 1, null]]);
          expect({ entidade, n: soma(lotes, campo), total: soma(lotes, 'recebidas') }).toEqual({
            entidade,
            n: 1,
            total: 1,
          });
          expect(await erp.consultarCursor(entidade)).toEqual({
            alterado_em: registro.alterado_em,
            external_id: registro.external_id,
          });
        }
        if (alvo.duble) {
          expect(alvo.duble.registro(alvo.tenant, 'cliente', cliente.external_id)?.nome_fantasia).toBe(
            cliente.nome_fantasia,
          );
          expect(alvo.duble.contar(alvo.tenant, 'titulo', { ativos: true })).toBe(
            registrosDe('titulo').length - 1,
          );
          expect(alvo.duble.contar(alvo.tenant, 'prazo_pagamento')).toBe(
            registrosDe('prazo_pagamento').length + 1,
          );
        }
      },
    );

    it(
      'lote de 5.001 registros: o ERP divide em 5.000 + 1 (partes da mesma sessão na carga completa) e o Hub aceita tudo',
      { timeout: PRAZO },
      async () => {
        exigir('divisao-5001', 'dado-novo');
        const titulos = titulosEmMassa(massa, 5001, depois(60));
        const lotes = await erp.publicar({ entidade: 'titulo', modo: config.modoCarga, registros: titulos });
        semErro(lotes);
        expect(lotes.map((l) => l.registros)).toEqual([5000, 1]);
        if (config.modoCarga === 'completo') {
          expect(lotes.map((l) => [l.parte, l.ultimo])).toEqual([
            [1, false],
            [2, true],
          ]);
          const sessoes = lotes.map((l) => (JSON.parse(l.corpo) as { sessao: { id: string } }).sessao.id);
          expect(new Set(sessoes).size).toBe(1);
        }
        expect(soma(lotes, 'novas')).toBe(5001);
        expect(await erp.consultarCursor('titulo')).toEqual(ultimoPar(titulos));
      },
    );

    // o emissor é sempre o do arnês: no dublê roda uma vez só (no bloco do emissor-minimo), no real roda no lado configurado
    it.runIf(lado === 'emissor-minimo' || !DUBLE)(
      'sem a divisão (emissor do arnês, de propósito), o Hub recusa o lote de 5.001 inteiro (422 acima_do_limite) e nada é criado',
      { timeout: PRAZO },
      async () => {
        exigir('sem-divisao');
        const semDivisao = alvo.criarLadoErp('emissor-minimo', { limiteRegistros: 6000 });
        const titulos = titulosEmMassa(massa, 5001, depois(90));
        const antes = alvo.duble?.contar(alvo.tenant, 'titulo');
        const lotes = await semDivisao.publicar({ entidade: 'titulo', modo: 'delta', registros: titulos });
        expect(lotes.map((l) => [l.registros, l.recusa, l.loteId])).toEqual([
          [5001, { status: 422, codigo: 'acima_do_limite' }, null],
        ]);
        if (alvo.duble) expect(alvo.duble.contar(alvo.tenant, 'titulo')).toBe(antes);
      },
    );

    it(
      'ordem quebrada: vendedor e cliente antes da filial viram referencia_ausente (reprocessável); depois da filial, entram',
      { timeout: PRAZO },
      async () => {
        exigir('ordem-quebrada', 'dado-novo');
        const [filial] = registrosDe('filial');
        const ordem = RODADA.proximoCodigoFilial();
        const novaFilial = {
          ...filial!,
          external_id: crypto.randomUUID(),
          alterado_em: depois(120).toISOString(),
          codigo: ordem,
          cnpj: cnpjFicticio(ordem),
          nome: `Filial Teste ${massa.execucao} 3`,
        };
        const vendedor = {
          ...registrosDe('vendedor')[0]!,
          external_id: crypto.randomUUID(),
          alterado_em: depois(121).toISOString(),
          filial_external_id: novaFilial.external_id,
        };
        const cliente = {
          ...registrosDe('cliente')[2]!,
          external_id: crypto.randomUUID(),
          alterado_em: depois(122).toISOString(),
          filial_external_id: novaFilial.external_id,
        };
        const quebrados = [
          ['vendedor', vendedor],
          ['cliente', cliente],
        ] as const;

        for (const [entidade, registro] of quebrados) {
          const [l] = await erp.publicar({ entidade, modo: 'delta', registros: [registro] });
          expect({ entidade, http: l?.http, status: l?.resultado?.status }).toEqual({
            entidade,
            http: 202,
            status: 'concluido_com_erros',
          });
          expect(l?.resultado?.erros.map((e) => [e.external_id, e.codigo, e.campo, e.reprocessavel])).toEqual(
            [[registro.external_id, 'referencia_ausente', 'filial_external_id', true]],
          );
        }
        semErro(await erp.publicar({ entidade: 'filial', modo: 'delta', registros: [novaFilial] }));
        for (const [entidade, registro] of quebrados) {
          // M6: a linha volta a pendente quando a referência confirma; o ERP remonta o lote (geração nova)
          const lotes = await erp.publicar({ entidade, modo: 'delta', registros: [registro], geracao: 2 });
          semErro(lotes);
          // no Hub real a linha pode já ter sido reprocessada pelo Monitor: entra como nova ou inalterada, nunca com erro
          expect(soma(lotes, 'novas') + soma(lotes, 'inalteradas')).toBe(1);
          if (alvo.duble)
            expect(alvo.duble.registro(alvo.tenant, entidade, registro.external_id)?.filial_external_id).toBe(
              novaFilial.external_id,
            );
        }
      },
    );

    it.runIf(DUBLE)(
      'Retry-After: 429 e 503 são repetidos só depois do tempo pedido, com o mesmo corpo e a mesma Idempotency-Key',
      async () => {
        exigir('retry-after-forcado', 'dado-novo');
        const d = alvo.duble!;
        const rel = alvo.relogioDeTeste!;
        rel.avancar(10 * 60_000); // balde de taxa cheio de novo: só as falhas programadas entram na conta
        d.programarFalha({ rota: 'POST /lotes', status: 429, retryAfter: '7' });
        d.programarFalha({ rota: 'GET /lotes', status: 503, retryAfter: '3' });
        const forma = {
          ...registrosDe('forma_pagamento')[0]!,
          external_id: crypto.randomUUID(),
          alterado_em: depois(200).toISOString(),
          codigo: `BOLETO2-${massa.execucao}`,
        };
        const desde = d.requisicoes.length;
        const logsAntes = alvo.logs.length;
        const [l] = await erp.publicar({ entidade: 'forma_pagamento', modo: 'delta', registros: [forma] });
        semErro([l!]);
        respeitouRetryAfter(l!, 429);
        expect(l!.tentativas[0]).toMatchObject({ codigo: 'limite_de_taxa', retryAfterMs: 7000 });
        const retentativas = alvo.logs.slice(logsAntes).filter((e) => e.evento === 'retentativa');
        expect(retentativas.map((e) => [e.http, e.retry_after_ms])).toEqual([
          [429, 7000],
          [503, 3000],
        ]);
        for (const e of retentativas)
          expect(Number(e.espera_ms)).toBeGreaterThanOrEqual(Number(e.retry_after_ms));
        const posts = d.requisicoes.slice(desde).filter((r) => r.metodo === 'POST');
        expect(posts.map((p) => p.status)).toEqual([429, 202]);
        expect(new Set(posts.map((p) => p.idempotencyKey)).size).toBe(1);
        expect(new Set(posts.map((p) => p.corpoSha256)).size).toBe(1);
        expect(Date.parse(posts[1]!.em) - Date.parse(posts[0]!.em)).toBeGreaterThanOrEqual(7000);
      },
    );

    it.runIf(DUBLE)(
      'Retry-After: balde de taxa do Hub vazio (429 natural) e Retry-After em data HTTP também são respeitados',
      async () => {
        exigir('retry-after-forcado');
        const outro = await prepararAlvo(config, {
          inicioDuble: INICIO_DUBLE,
          duble: { taxa: { lotes: { balde: 1, porMinuto: 20 } } },
        });
        try {
          const ladoErp = outro.criarLadoErp(lado);
          semErro(
            await ladoErp.publicar({ entidade: 'filial', modo: 'delta', registros: registrosDe('filial') }),
          );
          const [l] = await ladoErp.publicar({
            entidade: 'vendedor',
            modo: 'delta',
            registros: registrosDe('vendedor'),
          });
          semErro([l!]);
          respeitouRetryAfter(l!, 429);
          expect(l!.tentativas[0]!.codigo).toBe('limite_de_taxa');
          outro.relogioDeTeste!.avancar(60_000);
          const quando = new Date(outro.relogio.agora().getTime() + 10_000).toUTCString();
          outro.duble!.programarFalha({ rota: 'POST /lotes', status: 503, retryAfter: quando });
          // a porta do SDK mede a data HTTP pelo relógio do sistema: só o Date fica no instante do relógio do teste
          vi.useFakeTimers({ toFake: ['Date'], now: outro.relogio.agora() });
          const [m] = await ladoErp
            .publicar({
              entidade: 'forma_pagamento',
              modo: 'delta',
              registros: registrosDe('forma_pagamento'),
            })
            .finally(() => vi.useRealTimers());
          semErro([m!]);
          respeitouRetryAfter(m!, 503);
          expect(m!.tentativas[0]!.retryAfterMs).toBe(10_000);
        } finally {
          await outro.encerrar();
        }
      },
    );

    it.runIf(DUBLE)(
      '426 (versão abaixo da mínima para uma entidade) pausa só aquela entidade; as outras seguem',
      async () => {
        exigir('versao-426');
        const outro = await prepararAlvo(config, {
          inicioDuble: INICIO_DUBLE,
          duble: { versaoMinimaPorEntidade: { produto: '9.0.0' } },
        });
        try {
          const ladoErp = outro.criarLadoErp(lado);
          const r: Partial<Record<EntidadeHub, LoteEnviado[]>> = {};
          for (const e of ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento', 'produto'] as const)
            r[e] = await ladoErp.publicar({ entidade: e, modo: 'delta', registros: registrosDe(e) });
          expect(r.produto?.map((l) => [l.http, l.pausada])).toEqual([[426, 'versao']]);
          expect([...ladoErp.pausadas]).toEqual(['produto']);
          for (const e of ['filial', 'vendedor', 'forma_pagamento', 'prazo_pagamento'] as const)
            semErro(r[e]!);
          const postsAntes = outro.duble!.requisicoes.filter((q) => q.metodo === 'POST').length;
          expect(
            await ladoErp.publicar({ entidade: 'produto', modo: 'delta', registros: registrosDe('produto') }),
          ).toEqual([]);
          expect(outro.duble!.requisicoes.filter((q) => q.metodo === 'POST').length).toBe(postsAntes);
        } finally {
          await outro.encerrar();
        }
      },
    );

    it('sem dado pessoal em log: nem o payload, nem a chave saem no log do ERP, do Hub ou na saída do processo', () => {
      exigir('lgpd');
      const chave = alvo.credencial.chaveParaCabecalho();
      const saida = [...saidaPadrao.mock.calls, ...saidaErro.mock.calls].map((c) => String(c[0])).join('\n');
      const texto = [
        JSON.stringify(alvo.logs),
        saida,
        ...(alvo.duble ? [alvo.duble.log.join('\n'), JSON.stringify(alvo.duble.requisicoes)] : []),
      ].join('\n');
      expect(alvo.logs.length).toBeGreaterThan(0);
      expect(texto.includes(chave)).toBe(false);
      expect(massa.sensiveis.length).toBeGreaterThan(5);
      // por índice, nunca pelo valor: a falha não pode mostrar o dado pessoal
      expect(massa.sensiveis.flatMap((s, i) => (texto.includes(s) ? [i] : []))).toEqual([]);
      const permitidas = new Set([
        'evento',
        'entidade',
        'modo',
        'parte',
        'registros',
        'lote_id',
        'replay',
        'http',
        'status',
        'recebidas',
        'com_erro',
        'novas',
        'atualizadas',
        'inalteradas',
        'indice',
        'codigo',
        'campo',
        'reprocessavel',
        'caminho',
        'retry_after_ms',
        'espera_ms',
        'motivo',
      ]);
      expect(
        [...new Set(alvo.logs.flatMap((l) => Object.keys(l)))].filter((k) => !permitidas.has(k)),
      ).toEqual([]);
      // a linha com erro sai só com índice e código: o external_id do kit pode ser CPF ou CNPJ
      const linhas = alvo.logs.filter((l) => l.evento === 'linha_com_erro');
      expect(linhas.length).toBeGreaterThan(0);
      expect(linhas.filter((l) => 'external_id' in l)).toHaveLength(0);
    });
  },
);

/**
 * Achado A-01 (docs/testes/T-0012.md), corrigido pelo #123 (T-0011 L2a): o `mapearFilial` do `integracao-fdv` e o
 * `FilialHub` do C-6 passaram a mandar o CNPJ e o endereço da filial, que o Hub exige (RN-CORE-39 do FDV). Este teste
 * guarda a correção: a filial mapeada pelo ERP é aceita sem erro de linha.
 */
describe.runIf(cenarioPermitido(config, 'filial-mapeada-a01'))(
  `T-0012 — filial mapeada pelo ERP (mapearFilial) no Hub (alvo: ${config.alvo})`,
  () => {
    let alvo: Alvo;
    /** Filial mapeada pelo código do ERP, montada fora do `it` (erro de montagem não se confunde com recusa do Hub). */
    let mapeada: RegistroHub;
    const filialMapeada = (ordem: string): RegistroHub => {
      const ev = EVENTOS['cadastros.filial.alterada@1'].parse({
        id: crypto.randomUUID(),
        cnpj: cnpjFicticio(ordem),
        razao_social: 'Filial Ficticia de Teste Ltda',
        crt: '1',
        endereco: {
          logradouro: 'Avenida Ficticia',
          numero: '10',
          bairro: 'Centro',
          municipio_ibge: '1400100',
          uf: 'RR',
          cep: '69301000',
          municipio_nome: 'Boa Vista',
        },
        inativo: false,
      });
      const { registro } = mapearFilial(ev, BASE_MASSA.toISOString());
      return { ...registro.payload, alterado_em: registro.alterado_em } as RegistroHub;
    };

    beforeAll(async () => {
      exigir('filial-mapeada-a01', 'dado-novo');
      alvo = await prepararAlvo(config, { inicioDuble: INICIO_DUBLE });
      const codigo = RODADA.proximoCodigoFilial();
      mapeada = filialMapeada(codigo);
      expect(mapeada).toMatchObject({ codigo, logradouro: 'Avenida Ficticia', numero: '10', cep: '69301000' });
      expect(mapeada.cnpj).toMatch(new RegExp(`^\\d{8}${codigo}\\d{2}$`));
    });
    afterAll(async () => {
      await alvo?.encerrar();
    });

    it(
      '[A-01] a filial que o ERP mapeia do cadastros.filial.alterada@1 é aceita pelo Hub',
      { timeout: PRAZO },
      async () => {
        semErro(
          await alvo
            .criarLadoErp('conector')
            .publicar({ entidade: 'filial', modo: 'delta', registros: [mapeada] }),
        );
      },
    );
  },
);

// ---------------------------------------------------------------- perfil thathyany-seguro --------------------------------

/** Carga idêntica: todo lote pequeno, em delta, aceito e concluído sem erro; nada novo nem atualizado (o FDV não muda). */
function semMudancaNoFdv(
  r: ResultadoCargaIdentica,
  massa: MassaKit,
  entidades: readonly EntidadeHub[],
  limite: number,
): void {
  expect(r.interrompida).toBeNull();
  for (const entidade of entidades) {
    const lotes = r.porEntidade.get(entidade) ?? [];
    expect({ entidade, recebidas: soma(lotes, 'recebidas') }).toEqual({
      entidade,
      recebidas: massa.registros[entidade]?.length,
    });
    for (const l of lotes) {
      const c = l.resultado?.contagens;
      expect({
        entidade,
        modo: l.modo,
        pequeno: l.registros <= limite,
        http: l.http,
        status: l.resultado?.status,
        novas: c?.novas,
        atualizadas: c?.atualizadas,
        com_erro: c?.com_erro,
      }).toEqual({
        entidade,
        modo: 'delta',
        pequeno: true,
        http: 202,
        status: 'concluido',
        novas: 0,
        atualizadas: 0,
        com_erro: 0,
      });
      expect((c?.inalteradas ?? 0) + (c?.obsoletas ?? 0)).toBe(l.registros);
    }
  }
}

/** Reenvio idempotente: mesmo corpo e mesma chave = `Idempotent-Replay`, mesmo `lote_id`, mesmas contagens. */
function reenvioSemMudanca(
  pares: readonly { original: LoteEnviado; reenvio: LoteEnviado }[],
  lotes: number,
): void {
  expect(pares).toHaveLength(lotes);
  for (const { original, reenvio } of pares) {
    expect({
      entidade: original.entidade,
      replay: reenvio.replay,
      http: reenvio.http,
      loteId: reenvio.loteId,
      chave: reenvio.chave,
    }).toEqual({
      entidade: original.entidade,
      replay: true,
      http: 202,
      loteId: original.loteId,
      chave: original.chave,
    });
    expect(reenvio.resultado?.contagens).toEqual(original.resultado?.contagens);
  }
}

/** Nenhum valor da massa do kit (fora identificadores) no log do arnês e, no dublê, no log e nas requisições vistas. */
function semValorDaMassaEmLog(alvo: Alvo, massa: MassaKit): void {
  const valores = valoresDaMassa(massa);
  expect(valores.length).toBeGreaterThan(0);
  const texto = [
    JSON.stringify(alvo.logs),
    ...(alvo.duble ? [alvo.duble.log.join('\n'), JSON.stringify(alvo.duble.requisicoes)] : []),
  ].join('\n');
  // por índice, nunca pelo valor: a falha não pode mostrar o dado do kit
  expect(valores.flatMap((v, i) => (texto.includes(v) ? [i] : []))).toEqual([]);
  expect(texto.includes(alvo.credencial.chaveParaCabecalho())).toBe(false);
}

describe.each(DUBLE ? LADOS : [])(
  'T-0012 — modo seguro (perfil thathyany-seguro) provado no dublê, lado ERP: %s',
  (lado) => {
    const ENTIDADES: readonly EntidadeHub[] = ['forma_pagamento', 'prazo_pagamento'];
    const LIMITE = LIMITE_LOTE_SEGURO_PADRAO;
    let pasta: string;
    let massa: MassaKit;

    beforeAll(() => {
      // massa do kit FICTÍCIA, num arquivo fora do repositório, lida pelo mesmo leitor do perfil real
      pasta = mkdtempSync(join(tmpdir(), 't0012-kit-'));
      const caminho = join(pasta, 'kit.json');
      writeFileSync(caminho, JSON.stringify(massaKitFicticia(BASE_MASSA, 120)));
      massa = lerMassaKit(caminho);
    });
    afterAll(() => rmSync(pasta, { recursive: true, force: true }));

    /** Tenant com o kit dono de tudo menos `doErp`, e os dados do kit já carregados (o FDV de hoje). */
    async function tenantComKit(
      doErp: readonly EntidadeHub[],
      semente: (e: EntidadeHub, r: readonly RegistroHub[]) => readonly RegistroHub[] = (_e, r) => r,
    ) {
      const alvo = await prepararAlvo(config, {
        inicioDuble: INICIO_DUBLE,
        topologiaDuble: { kit: ORDEM_CARGA_HUB.filter((e) => !doErp.includes(e)), erp: doErp },
      });
      for (const e of ENTIDADES) alvo.duble!.semear(alvo.tenant, e, semente(e, massa.registros[e]!));
      return alvo;
    }
    const foto = (alvo: Alvo) =>
      JSON.stringify(
        ENTIDADES.map((e) =>
          massa.registros[e]!.map((r) => alvo.duble!.registro(alvo.tenant, e, r.external_id)),
        ),
      );
    const posts = (alvo: Alvo) => alvo.duble!.requisicoes.filter((q) => q.metodo === 'POST');

    it('como na thathyany hoje (o kit dono de tudo): o Conector do ERP recebe 422 entidade_de_outro_conector no lote-sonda e o arnês para, sem insistir', async () => {
      exigir('carga-identica');
      const alvo = await tenantComKit([]);
      try {
        const erp = alvo.criarLadoErp(lado, { limiteRegistros: LIMITE });
        const antes = foto(alvo);
        const r = await cargaIdentica(erp, massa, ENTIDADES, LIMITE);
        expect(r.interrompida).toEqual({ motivo: 'topologia', entidade: 'forma_pagamento' });
        expect(
          r.lotes.map((l) => [l.entidade, l.registros, l.http, l.pausada, l.loteId, l.tentativas.length]),
        ).toEqual([['forma_pagamento', 1, 422, 'topologia', null, 0]]);
        expect(erp.parado).toBe('topologia');
        expect(posts(alvo).map((p) => [p.status, p.cabecalhos['x-macuxi-conector-id']])).toEqual([
          [422, CONECTOR_DUBLE],
        ]);
        expect(foto(alvo)).toBe(antes);
        expect(alvo.duble!.estado(alvo.tenant).lotes.size).toBe(0);
        // parado: nada mais vai ao Hub, nem outra entidade, nem reenvio
        const vistas = alvo.duble!.requisicoes.length;
        expect(
          await erp.publicar({
            entidade: 'prazo_pagamento',
            modo: 'delta',
            registros: massa.registros.prazo_pagamento!,
          }),
        ).toEqual([]);
        await expect(erp.reenviar(r.lotes[0]!)).rejects.toThrow(/Arnês parado \(topologia\)/);
        expect(alvo.duble!.requisicoes.length).toBe(vistas);
        expect(alvo.logs.filter((l) => l.evento === 'entidade_pausada')).toEqual([
          { evento: 'entidade_pausada', entidade: 'forma_pagamento', motivo: 'topologia', http: 422 },
        ]);
        semValorDaMassaEmLog(alvo, massa);
      } finally {
        await alvo.encerrar();
      }
    });

    it('depois da virada de forma e prazo: lote-sonda de 1 por entidade e carga idêntica em lotes de até 50 não mudam nada; o reenvio idempotente devolve Idempotent-Replay', async () => {
      exigir('carga-identica', 'reenvio-idempotente');
      const alvo = await tenantComKit(ENTIDADES);
      try {
        const erp = alvo.criarLadoErp(lado, { limiteRegistros: LIMITE });
        const antes = foto(alvo);
        const r = await cargaIdentica(erp, massa, ENTIDADES, LIMITE);
        semMudancaNoFdv(r, massa, ENTIDADES, LIMITE);
        // as sondas (1 + 1) saem antes de qualquer fatia; depois, o resto de cada entidade
        expect(r.lotes.map((l) => [l.entidade, l.registros])).toEqual([
          ['forma_pagamento', 1],
          ['prazo_pagamento', 1],
          ['forma_pagamento', 50],
          ['forma_pagamento', 50],
          ['forma_pagamento', 19],
          ['prazo_pagamento', 3],
        ]);
        expect(foto(alvo)).toBe(antes);
        const lotes = alvo.duble!.estado(alvo.tenant).lotes.size;
        reenvioSemMudanca(await reenvioIdempotente(erp, r.lotes), 6);
        expect(alvo.duble!.estado(alvo.tenant).lotes.size).toBe(lotes);
        expect(foto(alvo)).toBe(antes);
        // só as entidades viradas foram enviadas; nenhuma do kit
        expect(new Set(posts(alvo).map((p) => p.status))).toEqual(new Set([202]));
        expect(alvo.duble!.contar(alvo.tenant, 'produto')).toBe(0);
        semValorDaMassaEmLog(alvo, massa);
      } finally {
        await alvo.encerrar();
      }
    });

    it('o arquivo diverge do que o kit carregou: a carga para no primeiro lote que mudaria o FDV e o lote seguinte não sai', async () => {
      exigir('carga-identica');
      const divergente = massa.registros.forma_pagamento![60]!.external_id;
      const alvo = await tenantComKit(ENTIDADES, (e, regs) =>
        e === 'forma_pagamento'
          ? regs.map((r) => (r.external_id === divergente ? { ...r, nome: 'Nome Diferente no FDV' } : r))
          : regs,
      );
      try {
        const erp = alvo.criarLadoErp(lado, { limiteRegistros: LIMITE });
        const r = await cargaIdentica(erp, massa, ENTIDADES, LIMITE);
        expect(r.interrompida).toEqual({ motivo: 'mudaria_o_fdv', entidade: 'forma_pagamento' });
        // o lote que dispara a parada (o 4º) JÁ FOI APLICADO no FDV: a atualização entrou
        expect(r.lotes.map((l) => [l.entidade, l.registros, l.resultado?.contagens.atualizadas])).toEqual([
          ['forma_pagamento', 1, 0],
          ['prazo_pagamento', 1, 0],
          ['forma_pagamento', 50, 0],
          ['forma_pagamento', 50, 1],
        ]);
        expect(posts(alvo)).toHaveLength(4);
      } finally {
        await alvo.encerrar();
      }
    });

    it('a divergência no 1º registro da entidade: o lote-sonda para a carga com 1 registro aplicado; nenhuma fatia nem outra entidade sai', async () => {
      exigir('carga-identica');
      const primeiro = massa.registros.forma_pagamento![0]!.external_id;
      const alvo = await tenantComKit(ENTIDADES, (e, regs) =>
        e === 'forma_pagamento'
          ? regs.map((r) => (r.external_id === primeiro ? { ...r, nome: 'Nome Diferente no FDV' } : r))
          : regs,
      );
      try {
        const erp = alvo.criarLadoErp(lado, { limiteRegistros: LIMITE });
        const r = await cargaIdentica(erp, massa, ENTIDADES, LIMITE);
        expect(r.interrompida).toEqual({ motivo: 'mudaria_o_fdv', entidade: 'forma_pagamento' });
        expect(r.lotes.map((l) => [l.entidade, l.registros, l.resultado?.contagens.atualizadas])).toEqual([
          ['forma_pagamento', 1, 1],
        ]);
        expect(posts(alvo)).toHaveLength(1);
      } finally {
        await alvo.encerrar();
      }
    });
  },
);

const SEGURO = config.alvo === 'real' && config.perfil === 'thathyany-seguro' ? config : null;

describe.runIf(SEGURO !== null)(
  `T-0012 — modo seguro no FDV real (perfil thathyany-seguro, tenant: ${SEGURO?.tenant ?? '-'})`,
  () => {
    let alvo: Alvo;
    let erp: LadoErp;
    let carga: ResultadoCargaIdentica | null = null;

    beforeAll(async () => {
      exigir('carga-identica', 'reenvio-idempotente');
      alvo = await prepararAlvo(config, { inicioDuble: INICIO_DUBLE });
      erp = alvo.criarLadoErp(undefined, { limiteRegistros: SEGURO!.limiteLote });
    });
    afterAll(async () => {
      await alvo?.encerrar();
    });

    it(
      'carga idêntica: os dados do kit, em lotes pequenos e em delta, não mudam nada no FDV',
      { timeout: PRAZO },
      async () => {
        exigir('carga-identica');
        carga = await cargaIdentica(erp, SEGURO!.massaKit, SEGURO!.entidades, SEGURO!.limiteLote);
        semMudancaNoFdv(carga, SEGURO!.massaKit, SEGURO!.entidades, SEGURO!.limiteLote);
      },
    );

    it(
      'reenvio idempotente: mesmo corpo e mesma Idempotency-Key devolvem Idempotent-Replay, sem mudar nada',
      { timeout: PRAZO },
      async () => {
        exigir('reenvio-idempotente');
        expect(carga?.interrompida ?? 'carga não rodou').toBeNull();
        reenvioSemMudanca(await reenvioIdempotente(erp, carga!.lotes), carga!.lotes.length);
      },
    );

    it('sem dado pessoal em log: nenhum valor da massa do kit nem a chave no log do arnês', () => {
      semValorDaMassaEmLog(alvo, SEGURO!.massaKit);
    });
  },
);
