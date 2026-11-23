/**
 * Simulador com a porta de estado no PostgreSQL (T-0045, lote B; schema `sefaz_simulador`, migração 0025), no papel
 * `macuxierp_worker` e com a RLS do tenant (`comTenant`):
 * 1. a suíte inteira do simulador (`suite-simulador.ts`), um tenant novo por simulador;
 * 2. reinício: novo repositório na mesma base não repete o `nProt`, acha a nota de antes, cancela nota gravada por
 *    outra instância (135) e responde o recibo assíncrono de outra instância;
 * 3. concorrência (duas transações, a 1ª segura o commit): faixa de inutilização (só uma grava), inutilização ×
 *    autorização do mesmo número (206 ou 241), autorização da mesma chave (SAVEPOINT no 23505: 204) e eventos da
 *    mesma nota (`FOR UPDATE`: 135 e 573; CC-e depois do cancelamento dá 218);
 * 4. RLS: outro tenant não vê nada; e a fonte por tenant do worker (`estadoSimuladorPorTenant`) grava no tenant do
 *    trabalho e recusa operação fora dele;
 * 5. a purga de 400 dias (`created_at`), por tenant;
 * 6. erro do banco sem dado da linha na mensagem e a sequência esgotada (2200H) como erro permanente (por último:
 *    mexe na sequência global).
 */
import { randomUUID } from 'node:crypto';
import { RespostaConsultaProtocolo } from '@macuxierp/nfe-sefaz';
import type { Transacao } from '@macuxierp/platform-sdk';
import type { BancoPg } from '@macuxierp/platform-sdk/pg';
import {
  criarBancoEfemero,
  criarTenant,
  PG_DISPONIVEL,
  type BancoEfemero,
} from '@macuxierp/platform-sdk/pg-testes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CNPJ_EMITENTE_DE_TESTE,
  HORA,
  INICIO,
  a1DeTeste,
  autorizarUma,
  cancelamentoAssinado,
  cceAssinada,
  criarRelogio,
  destinoDe,
  inutilizacaoAssinada,
  nfeAssinada,
} from './apoio-teste';
import {
  ErroEstadoSimuladorPg,
  SequenciaSimuladorEsgotadaErro,
  criarEstadoSimuladorPg,
  criarRegistroSimulador,
  criarFabricaSimulador,
  criarSimuladorSefaz,
  estadoSimuladorPorTenant,
  fonteEstadoSimuladorPg,
  purgarEstadoSimulador,
  type EstadoSimuladorRepo,
  type FaixaSimulada,
  type FonteEstadoSimulador,
  type SimuladorSefaz,
} from './index';
import { registrarSuiteSimulador } from './suite-simulador';

const DIA = 24 * HORA;

describe.skipIf(!PG_DISPONIVEL)('simulador com estado no PostgreSQL (sefaz_simulador, 0025)', () => {
  let b: BancoEfemero;
  let banco: BancoPg;

  beforeAll(async () => {
    b = await criarBancoEfemero();
    banco = b.banco('macuxierp_worker', 4);
    a1DeTeste();
  }, 60_000); // o banco efêmero migra tudo: com a suíte inteira em paralelo, passa dos 10 s padrão
  afterAll(async () => {
    await b?.remover();
  });

  const novoTenant = () => criarTenant(b.admin, `sim-${randomUUID().slice(0, 8)}`);
  /** Como o worker fará: uma transação do tenant por operação do simulador. */
  const fonteDo = (tenant: string) => fonteEstadoSimuladorPg((fn) => banco.comTenant(tenant, fn));
  /** Um "processo" novo do worker: registro, fonte e simulador novos, na mesma base. */
  const instancia = (tenant: string, agora: () => Date = () => INICIO, tMed = 1) =>
    criarSimuladorSefaz(destinoDe(), {
      agora,
      tMed,
      registro: criarRegistroSimulador(),
      estado: fonteDo(tenant),
    });
  const seq = (nProt: string | null) => Number(nProt?.slice(-9));
  /**
   * Quantas sessões desta base estão paradas esperando uma trava (advisory, linha ou índice único). Pelo `pid` da
   * sessão: a espera por outra transação (`transactionid`) não tem `database` no `pg_locks`.
   */
  const esperandoTrava = async () =>
    contar(
      `SELECT count(*) AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE a.datname = current_database() AND NOT l.granted`,
      [],
    );
  /** Espera a 2ª transação parar na trava da 1ª (e confere que parou mesmo); solta a 1ª de qualquer jeito. */
  const aguardarEspera = async (soltar: () => void) => {
    try {
      for (let i = 0; i < 100 && (await esperandoTrava()) < 1; i++) await new Promise((r) => setTimeout(r, 20));
      expect(await esperandoTrava()).toBe(1);
    } finally {
      soltar();
    }
  };
  /**
   * Um simulador cuja transação SEGURA o commit até `soltar()`: a operação processa (com as travas), `processada`
   * resolve e o commit espera. `semTravaDaFaixa` tira a trava da faixa (para a autorização chegar ao 23505).
   */
  const segurado = (tenant: string, o: { semTravaDaFaixa?: boolean } = {}) => {
    let soltar!: () => void;
    let processou!: () => void;
    const solta = new Promise<void>((r) => (soltar = r));
    const processada = new Promise<void>((r) => (processou = r));
    const fonte: FonteEstadoSimulador = (fn) =>
      banco.comTenant(tenant, async (tx) => {
        const r = await fn(porta(tx, o));
        processou();
        await solta;
        return r;
      });
    return {
      s: criarSimuladorSefaz(destinoDe(), {
        agora: () => INICIO,
        registro: criarRegistroSimulador(),
        estado: fonte,
      }),
      processada,
      soltar,
    };
  };
  const porta = (tx: Transacao, o: { semTravaDaFaixa?: boolean } = {}): EstadoSimuladorRepo => {
    const repo = criarEstadoSimuladorPg(tx);
    return o.semTravaDaFaixa ? { ...repo, travarFaixa: async () => {} } : repo;
  };
  const semTrava = (tenant: string) =>
    criarSimuladorSefaz(destinoDe(), {
      agora: () => INICIO,
      registro: criarRegistroSimulador(),
      estado: (fn) => banco.comTenant(tenant, (tx) => fn(porta(tx, { semTravaDaFaixa: true }))),
    });
  const contar = async (sql: string, parametros: unknown[]) =>
    Number((await b.admin.query<{ n: string }>(sql, parametros)).rows[0]?.n);

  describe('a suíte do simulador', () => {
    registrarSuiteSimulador({
      nome: 'PostgreSQL',
      sequenciaGlobal: true,
      guardaEpec: false,
      novoEstado: (): FonteEstadoSimulador => {
        // Um tenant novo por simulador (como um registro novo por cenário na memória), criado no primeiro uso.
        let tenant: Promise<string> | undefined;
        return async (fn) => {
          tenant ??= novoTenant();
          return fonteDo(await tenant)(fn);
        };
      },
    });
  });

  describe('reinício do worker (repositório novo, mesma base)', () => {
    it('o nProt não repete; a nota de antes é achada (100, 204), cancelada (135) e a CC-e depois dá 218', async () => {
      const t = await novoTenant();
      const n1 = nfeAssinada({ nNF: 1 });
      const p1 = await autorizarUma(instancia(t), n1.xml);
      expect(p1.cStat).toBe('100');

      const depois = instancia(t); // "reiniciou": nada em memória
      const p2 = await autorizarUma(depois, nfeAssinada({ nNF: 2 }).xml);
      expect(p2.nProt).not.toBe(p1.nProt);
      expect(seq(p2.nProt)).toBeGreaterThan(seq(p1.nProt));
      const c = RespostaConsultaProtocolo.parse(await depois.consultarProtocolo({ chNFe: n1.chave }));
      expect(c).toMatchObject({
        cStat: '100',
        protocolo: {
          nProt: p1.nProt,
          cStat: '100',
          xml: p1.xml,
          xMotivo: p1.xMotivo,
          tpAmb: 2,
          verAplic: p1.verAplic,
        },
      });
      expect(await autorizarUma(instancia(t), n1.xml)).toMatchObject({
        cStat: '204',
        xMotivo: `Duplicidade de NF-e [nProt:${p1.nProt}][dhAut:${p1.dhRecbto}]`,
      });

      const canc = await instancia(t).cancelar({
        idLote: '3',
        eventoAssinado: cancelamentoAssinado({
          chave: n1.chave,
          dhEvento: new Date(INICIO.getTime() + 60_000),
          nProt: p1.nProt!,
        }),
      });
      expect(canc.eventos[0]).toMatchObject({ cStat: '135', tpEvento: '110111' });
      expect(seq(canc.eventos[0]!.nProt)).toBeGreaterThan(seq(p2.nProt));
      const depoisDoCancelamento = await instancia(
        t,
        () => new Date(INICIO.getTime() + 2 * 60_000),
      ).consultarProtocolo({ chNFe: n1.chave });
      expect(depoisDoCancelamento).toMatchObject({
        cStat: '101',
        eventos: [{ cStat: '135', nProt: canc.eventos[0]!.nProt, xml: canc.eventos[0]!.xml }],
      });
      const cce = await instancia(t, () => new Date(INICIO.getTime() + 3 * 60_000)).cartaCorrecao({
        idLote: '4',
        eventoAssinado: cceAssinada({
          chave: n1.chave,
          dhEvento: new Date(INICIO.getTime() + 3 * 60_000),
          nSeqEvento: 1,
        }),
      });
      expect(cce.eventos[0]?.cStat).toBe('218');
    });

    it('o recibo assíncrono de uma instância é respondido por outra (104 com os protocolos)', async () => {
      const t = await novoTenant();
      const relogio = criarRelogio();
      const n = nfeAssinada({ nNF: 3 });
      const r = await instancia(t, relogio.agora, 2).autorizar({
        idLote: '5',
        sincrono: false,
        nfes: [n.xml],
      });
      expect(r.cStat).toBe('103');
      expect((await instancia(t, relogio.agora, 2).consultarRecibo({ nRec: r.recibo!.nRec })).cStat).toBe(
        '105',
      );
      relogio.avancar(2_000);
      const pronto = await instancia(t, relogio.agora, 2).consultarRecibo({ nRec: r.recibo!.nRec });
      expect(pronto).toMatchObject({
        cStat: '104',
        dhRecbto: r.dhRecbto,
        protocolos: [{ chNFe: n.chave, cStat: '100' }],
      });
    });
  });

  describe('inutilização concorrente', () => {
    const d = destinoDe();
    const faixa = (nNFIni: number, nNFFin: number): FaixaSimulada => ({
      cnpj: CNPJ_EMITENTE_DE_TESTE,
      serie: 1,
      ano: '26',
      nNFIni,
      nNFFin,
    });
    const nProtDe = (n: number) => `911326${String(n).padStart(9, '0')}`;

    it('faixas que se cruzam em duas transações: a segunda espera a trava da primeira e só uma grava', async () => {
      const t = await novoTenant();
      let travou!: () => void;
      let soltar!: () => void;
      const travada = new Promise<void>((r) => (travou = r));
      const solta = new Promise<void>((r) => (soltar = r));

      const a = banco.comTenant(t, async (tx) => {
        const repo = criarEstadoSimuladorPg(tx);
        await repo.travarFaixa(d, faixa(500, 510));
        if (await repo.faixaSobreposta(d, faixa(500, 510))) return 'recusou';
        travou();
        await solta; // segura a transação aberta, com a trava
        await repo.gravarInutilizacao(d, { ...faixa(500, 510), nProt: nProtDe(await repo.proximo('nProt')) });
        return 'gravou';
      });
      await travada;
      const bTx = banco.comTenant(t, async (tx) => {
        const repo = criarEstadoSimuladorPg(tx);
        await repo.travarFaixa(d, faixa(505, 520));
        if (await repo.faixaSobreposta(d, faixa(505, 520))) return 'recusou';
        await repo.gravarInutilizacao(d, { ...faixa(505, 520), nProt: nProtDe(await repo.proximo('nProt')) });
        return 'gravou';
      });
      // A segunda transação está parada na trava (pg_advisory_xact_lock), não lendo uma foto sem a faixa da primeira.
      await aguardarEspera(soltar);
      expect(await a).toBe('gravou');
      expect(await bTx).toBe('recusou');
      expect(
        await contar('SELECT count(*) AS n FROM sefaz_simulador.inutilizacao WHERE tenant_id = $1', [t]),
      ).toBe(1);
    });

    it('pelo simulador: duas inutilizações que se cruzam ao mesmo tempo dão um 102 e um 256', async () => {
      const t = await novoTenant();
      const r = await Promise.all([
        instancia(t).inutilizar({
          inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 600, nNFFin: 610 }),
        }),
        instancia(t).inutilizar({
          inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 605, nNFFin: 615 }),
        }),
      ]);
      expect(r.map((x) => x.cStat).sort()).toEqual(['102', '256']);
      expect(await autorizarUma(instancia(t), nfeAssinada({ nNF: 606 }).xml)).toMatchObject({ cStat: '206' });
    });

    it('inutilização segurando a trava: a autorização de um número da faixa espera e dá 206', async () => {
      const t = await novoTenant();
      const a = segurado(t);
      const inut = a.s.inutilizar({
        inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 900, nNFFin: 905 }),
      });
      await a.processada;
      const aut = autorizarUma(instancia(t), nfeAssinada({ nNF: 902 }).xml);
      await aguardarEspera(a.soltar);
      expect((await inut).cStat).toBe('102');
      expect((await aut).cStat).toBe('206');
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [t])).toBe(
        0,
      );
    });

    it('autorização segurando a trava: a inutilização da faixa com o número espera e dá 241', async () => {
      const t = await novoTenant();
      const a = segurado(t);
      const aut = autorizarUma(a.s, nfeAssinada({ nNF: 910 }).xml);
      await a.processada;
      const inut = instancia(t).inutilizar({
        inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 908, nNFFin: 912 }),
      });
      await aguardarEspera(a.soltar);
      expect((await aut).cStat).toBe('100');
      expect((await inut).cStat).toBe('241');
      expect(
        await contar('SELECT count(*) AS n FROM sefaz_simulador.inutilizacao WHERE tenant_id = $1', [t]),
      ).toBe(0);
    });
  });

  describe('autorização concorrente da mesma chave (SAVEPOINT no 23505)', () => {
    it('pela porta: a nota que já está (mesma chave ou mesmo número) volta no lugar do 23505, e a transação segue viva', async () => {
      const t = await novoTenant();
      const n = nfeAssinada({ nNF: 30 });
      const p = await autorizarUma(instancia(t), n.xml);
      const nota = (await banco.comTenant(t, (tx) =>
        criarEstadoSimuladorPg(tx).notaPorChave(destinoDe(), n.chave),
      ))!;
      // Mesma chave e outra chave do mesmo número, gravadas como se a 1ª ainda não existisse.
      for (const outra of [nota, { ...nota, chNFe: nfeAssinada({ nNF: 30, cNF: '87654321' }).chave }]) {
        const devolvida = await banco.comTenant(t, async (tx) => {
          const repo = criarEstadoSimuladorPg(tx);
          const r = await repo.gravarNota(destinoDe(), {
            ...outra,
            protocolo: { ...outra.protocolo, nProt: '911326999999990' },
          });
          // A transação continua utilizável depois do ROLLBACK TO SAVEPOINT.
          expect(await repo.notaPorChave(destinoDe(), n.chave)).toMatchObject({ chNFe: n.chave });
          return r;
        });
        expect(devolvida).toMatchObject({ chNFe: n.chave, protocolo: { nProt: p.nProt } });
      }
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [t])).toBe(
        1,
      );
    });

    it('pelo simulador, sem a trava da faixa: a 2ª espera o INSERT da 1ª e responde 204 com o nProt dela', async () => {
      const t = await novoTenant();
      const n = nfeAssinada({ nNF: 31 });
      const a = segurado(t, { semTravaDaFaixa: true });
      const primeira = autorizarUma(a.s, n.xml);
      await a.processada;
      const segunda = autorizarUma(semTrava(t), n.xml);
      await aguardarEspera(a.soltar);
      const p1 = await primeira;
      expect(p1.cStat).toBe('100');
      expect(await segunda).toMatchObject({
        cStat: '204',
        nProt: null,
        xMotivo: `Duplicidade de NF-e [nProt:${p1.nProt}][dhAut:${p1.dhRecbto}]`,
      });
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [t])).toBe(
        1,
      );
    });

    it('pelo simulador, ao mesmo tempo: um 100 e um 204', async () => {
      const t = await novoTenant();
      const n = nfeAssinada({ nNF: 32 });
      const r = await Promise.all([autorizarUma(instancia(t), n.xml), autorizarUma(instancia(t), n.xml)]);
      expect(r.map((x) => x.cStat).sort()).toEqual(['100', '204']);
    });
  });

  describe('eventos concorrentes da mesma nota (FOR UPDATE)', () => {
    const autorizada = async (t: string, nNF: number) => {
      const n = nfeAssinada({ nNF });
      return { chave: n.chave, p: await autorizarUma(instancia(t), n.xml) };
    };
    const dh = new Date(INICIO.getTime() + 60_000);

    it('dois cancelamentos simultâneos: o 1º dá 135 e o 2º, que esperou a nota, dá 573', async () => {
      const t = await novoTenant();
      const { chave, p } = await autorizada(t, 40);
      const evento = cancelamentoAssinado({ chave, dhEvento: dh, nProt: p.nProt! });
      const a = segurado(t);
      const primeiro = a.s.cancelar({ idLote: '1', eventoAssinado: evento });
      await a.processada;
      const segundo = instancia(t).cancelar({ idLote: '2', eventoAssinado: evento });
      await aguardarEspera(a.soltar);
      expect((await primeiro).eventos[0]?.cStat).toBe('135');
      expect((await segundo).eventos[0]?.cStat).toBe('573');
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.evento WHERE tenant_id = $1', [t])).toBe(
        1,
      );
    });

    it('CC-e simultânea a um cancelamento: espera, vê a nota cancelada e dá 218 (nenhum 135 em nota cancelada)', async () => {
      const t = await novoTenant();
      const { chave, p } = await autorizada(t, 41);
      const a = segurado(t);
      const canc = a.s.cancelar({
        idLote: '1',
        eventoAssinado: cancelamentoAssinado({ chave, dhEvento: dh, nProt: p.nProt! }),
      });
      await a.processada;
      const cce = instancia(t).cartaCorrecao({
        idLote: '2',
        eventoAssinado: cceAssinada({ chave, dhEvento: dh, nSeqEvento: 1 }),
      });
      await aguardarEspera(a.soltar);
      expect((await canc).eventos[0]?.cStat).toBe('135');
      expect((await cce).eventos[0]?.cStat).toBe('218');
      expect(
        await contar(
          "SELECT count(*) AS n FROM sefaz_simulador.evento WHERE tenant_id = $1 AND tp_evento = '110110'",
          [t],
        ),
      ).toBe(0);
    });
  });

  describe('RLS', () => {
    it('outro tenant não vê a nota, os eventos, a inutilização nem o recibo; e usa a mesma chave no próprio espaço', async () => {
      const t = await novoTenant();
      const u = await novoTenant();
      const n = nfeAssinada({ nNF: 7 });
      const p = await autorizarUma(instancia(t), n.xml);
      await instancia(t).cartaCorrecao({
        idLote: '1',
        eventoAssinado: cceAssinada({
          chave: n.chave,
          dhEvento: new Date(INICIO.getTime() + 60_000),
          nSeqEvento: 1,
        }),
      });
      await instancia(t).inutilizar({
        inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 700, nNFFin: 701 }),
      });
      const lote = await instancia(t).autorizar({
        idLote: '2',
        sincrono: false,
        nfes: [nfeAssinada({ nNF: 8 }).xml],
      });

      expect((await instancia(u).consultarProtocolo({ chNFe: n.chave })).cStat).toBe('217');
      expect(
        (
          await instancia(u, () => new Date(INICIO.getTime() + HORA)).consultarRecibo({
            nRec: lote.recibo!.nRec,
          })
        ).cStat,
      ).toBe('106');
      expect(
        (
          await instancia(u).inutilizar({
            inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 700, nNFFin: 701 }),
          })
        ).cStat,
      ).toBe('102');
      const q = await autorizarUma(instancia(u), n.xml);
      expect(q.cStat).toBe('100');
      expect(q.nProt).not.toBe(p.nProt);

      const visto = await banco.comTenant(u, (tx) =>
        tx.consultar<{ notas: string; eventos: string; inut: string; recibos: string }>(
          `SELECT (SELECT count(*) FROM sefaz_simulador.nota WHERE tenant_id = $1) AS notas,
                  (SELECT count(*) FROM sefaz_simulador.evento WHERE tenant_id = $1) AS eventos,
                  (SELECT count(*) FROM sefaz_simulador.inutilizacao WHERE tenant_id = $1) AS inut,
                  (SELECT count(*) FROM sefaz_simulador.recibo WHERE tenant_id = $1) AS recibos`,
          [t],
        ),
      );
      expect(visto[0]).toEqual({ notas: '0', eventos: '0', inut: '0', recibos: '0' });
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [t])).toBe(
        2,
      );
    });
  });

  describe('fonte por tenant do worker (estadoSimuladorPorTenant)', () => {
    it('uma fábrica para o processo: cada operação vai ao tenant do noTenant; fora dele, erro e nada gravado', async () => {
      const t = await novoTenant();
      const u = await novoTenant();
      const porTenant = estadoSimuladorPorTenant(banco);
      const fabrica = criarFabricaSimulador({ agora: () => INICIO, estado: porTenant.fonte });
      const n = nfeAssinada({ nNF: 9 });
      const p = await porTenant.noTenant(t, () =>
        autorizarUma(fabrica(destinoDe()) as SimuladorSefaz, n.xml),
      );
      expect(p.cStat).toBe('100');
      expect(
        (await porTenant.noTenant(t, () => fabrica(destinoDe()).consultarProtocolo({ chNFe: n.chave })))
          .cStat,
      ).toBe('100');
      expect(
        (await porTenant.noTenant(u, () => fabrica(destinoDe()).consultarProtocolo({ chNFe: n.chave })))
          .cStat,
      ).toBe('217');
      await expect(
        fabrica(destinoDe()).autorizar({ idLote: '2', sincrono: true, nfes: [nfeAssinada({ nNF: 10 }).xml] }),
      ).rejects.toThrow(/fora do tenant/);
      expect(
        await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = ANY($1)', [[t, u]]),
      ).toBe(1);
    });
  });

  describe('purga de 400 dias', () => {
    it('apaga do tenant o criado há mais de 400 dias (created_at): nota (e eventos), inutilização e recibo; o novo e o outro tenant ficam', async () => {
      const t = await novoTenant();
      const u = await novoTenant();
      const velha = nfeAssinada({ nNF: 10 });
      const cancelada = nfeAssinada({ nNF: 11 });
      const nova = nfeAssinada({ nNF: 12 });
      const depois = (min: number) => new Date(INICIO.getTime() + min * 60_000);
      await autorizarUma(instancia(t), velha.xml);
      await instancia(t).cartaCorrecao({
        idLote: '1',
        eventoAssinado: cceAssinada({ chave: velha.chave, dhEvento: depois(1), nSeqEvento: 1 }),
      });
      const pc = await autorizarUma(instancia(t), cancelada.xml);
      await instancia(t).cancelar({
        idLote: '2',
        eventoAssinado: cancelamentoAssinado({
          chave: cancelada.chave,
          dhEvento: depois(1),
          nProt: pc.nProt!,
        }),
      });
      await autorizarUma(instancia(t), nova.xml);
      await instancia(t).inutilizar({
        inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 800, nNFFin: 801 }),
      });
      await instancia(t).inutilizar({
        inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 802, nNFFin: 803 }),
      });
      const recibos = [];
      for (const nNF of [13, 14])
        recibos.push(
          (await instancia(t).autorizar({ idLote: '3', sincrono: false, nfes: [nfeAssinada({ nNF }).xml] }))
            .recibo!.nRec,
        );
      await autorizarUma(instancia(u), velha.xml);

      // Envelhece 401 dias (o dono, fora da RLS): as notas velha e cancelada, a 1ª inutilização, o 1º recibo e a nota do outro tenant.
      const antigo = new Date(INICIO.getTime() - 401 * DIA);
      await b.admin.query('UPDATE sefaz_simulador.nota SET created_at = $1 WHERE ch_nfe = ANY($2)', [
        antigo,
        [velha.chave, cancelada.chave],
      ]);
      await b.admin.query(
        'UPDATE sefaz_simulador.inutilizacao SET created_at = $1 WHERE tenant_id = $2 AND nnf_ini = 800',
        [antigo, t],
      );
      await b.admin.query('UPDATE sefaz_simulador.recibo SET created_at = $1 WHERE n_rec = $2', [
        antigo,
        recibos[0],
      ]);

      const antesDe = new Date(INICIO.getTime() - 400 * DIA);
      expect(await banco.comTenant(t, (tx) => purgarEstadoSimulador(tx, antesDe))).toEqual({
        notas: 2,
        eventos: 2,
        inutilizacoes: 1,
        recibos: 1,
      });
      // O que ficou: as notas 12, 13 e 14 do tenant (as 13 e 14 do lote assíncrono), a 2ª inutilização, o 2º recibo e o outro tenant.
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [t])).toBe(
        3,
      );
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.evento WHERE tenant_id = $1', [t])).toBe(
        0,
      );
      expect(
        await contar('SELECT count(*) AS n FROM sefaz_simulador.inutilizacao WHERE tenant_id = $1', [t]),
      ).toBe(1);
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.recibo WHERE tenant_id = $1', [t])).toBe(
        1,
      );
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [u])).toBe(
        1,
      );
      expect((await instancia(t).consultarProtocolo({ chNFe: velha.chave })).cStat).toBe('217');
      expect((await instancia(t).consultarProtocolo({ chNFe: nova.chave })).cStat).toBe('100');
      // Rodar de novo não apaga mais nada.
      expect(await banco.comTenant(t, (tx) => purgarEstadoSimulador(tx, antesDe))).toEqual({
        notas: 0,
        eventos: 0,
        inutilizacoes: 0,
        recibos: 0,
      });
    });
  });

  describe('erros do banco (por último: mexe na sequência global)', () => {
    it('erro do banco sai só com a operação e o SQLSTATE, sem valor da linha', async () => {
      const t = await novoTenant();
      const n = nfeAssinada({ nNF: 20 });
      const p = await autorizarUma(instancia(t), n.xml);
      const xCorrecao = 'Texto livre da correcao que nunca vai a log';
      await instancia(t).cartaCorrecao({
        idLote: '1',
        eventoAssinado: cceAssinada({
          chave: n.chave,
          dhEvento: new Date(INICIO.getTime() + 60_000),
          nSeqEvento: 1,
          xCorrecao,
        }),
      });
      const [evento] = await banco.comTenant(t, (tx) =>
        criarEstadoSimuladorPg(tx).eventosDaNota(destinoDe(), n.chave),
      );
      // O mesmo evento de novo: 23505 do evento_seq_uq, cujo detalhe no Postgres traz a chave.
      const erro = await banco
        .comTenant(t, (tx) => criarEstadoSimuladorPg(tx).gravarEvento(destinoDe(), n.chave, evento!))
        .catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroEstadoSimuladorPg);
      expect(erro).toMatchObject({ operacao: 'gravarEvento', sqlstate: '23505' });
      const texto = `${(erro as Error).message} ${JSON.stringify(erro)}`;
      for (const dado of [n.chave, CNPJ_EMITENTE_DE_TESTE, p.nProt!, xCorrecao])
        expect(texto).not.toContain(dado);
    });

    it('sequência esgotada (2200H): SequenciaSimuladorEsgotadaErro, permanente, e o lote não grava nada', async () => {
      const t = await novoTenant();
      await b.admin.query("SELECT setval('sefaz_simulador.seq_nprot', 999999999)");
      const erro = await banco
        .comTenant(t, (tx) => criarEstadoSimuladorPg(tx).proximo('nProt'))
        .catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(SequenciaSimuladorEsgotadaErro);
      expect(erro).toMatchObject({ codigo: 'SEFAZ_SIMULADOR_ESGOTADO', retentavel: false, tipo: 'nProt' });
      const n = nfeAssinada({ nNF: 21 });
      await expect(
        instancia(t).autorizar({ idLote: '1', sincrono: true, nfes: [n.xml] }),
      ).rejects.toBeInstanceOf(SequenciaSimuladorEsgotadaErro);
      expect(await contar('SELECT count(*) AS n FROM sefaz_simulador.nota WHERE tenant_id = $1', [t])).toBe(
        0,
      );
    });
  });
});
