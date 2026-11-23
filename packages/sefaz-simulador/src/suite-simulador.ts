/**
 * Suíte do simulador da SEFAZ-AM (T-0045, etapas 2 a 4; contingência da T-0021, ADR 0011): serviços, rejeições,
 * eventos, inutilização, contingência SVC-RS e EPEC, controles de teste e a trava da regra 7. Toda resposta é conferida no contrato (Zod) e no XSD PL_010g do
 * retorno. No fim, a cobertura: todo `cStat` da tabela `MOTIVO` apareceu em algum teste.
 * Roda nas DUAS portas de estado (lote B): em memória (`simulador.test.ts`) e no Postgres (`simulador.db.test.ts`).
 * Não é teste por si (sem `.test.` no nome): só as duas entradas a registram.
 */
import {
  CSTAT_FALHA_ASSINATURA,
  ErroSefaz,
  FalhaTransporteSefaz,
  RespostaAutorizacao,
  RespostaConsultaProtocolo,
  RespostaConsultaRecibo,
  RespostaEvento,
  RespostaInutilizacao,
  RespostaStatusServico,
  SimuladorEmProducaoErro,
  criarSeletorTransporte,
  montarNfeProc,
  validarXsd,
  type DestinoSimulador,
  type EsquemaXsd,
} from '@macuxierp/nfe-sefaz';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CNPJ_EMITENTE_DE_TESTE,
  CNPJ_OUTRO_DE_TESTE,
  CSTAT_VISTOS,
  FILIAL,
  HORA,
  INICIO,
  a1DeTeste,
  autorizarUma,
  cancelamentoAssinado,
  cceAssinada,
  destinoDe,
  epecAssinada,
  inutilizacaoAssinada,
  nfeAssinada,
  novoSimulador as novoSimuladorBase,
  vistos,
} from './apoio-teste';
import type { EstadoSimuladorRepo, FonteEstadoSimulador } from './estado';
import {
  CSTAT_DO_SIMULADOR,
  VER_APLIC_SIMULADOR,
  criarFabricaSimulador,
  criarRegistroSimulador,
  criarSimuladorSefaz,
} from './index';

export interface PortaDeTeste {
  readonly nome: string;
  /** Estado novo e isolado (um por simulador do teste, como antes um registro por cenário). */
  novoEstado(): EstadoSimuladorRepo | FonteEstadoSimulador;
  /** O sequencial do `nProt` vem de uma sequência que não volta ao início (Postgres): o XML só repete fora dele. */
  readonly sequenciaGlobal: boolean;
  /**
   * A porta guarda EPEC? Só a memória (testes). O Postgres é o simulador do worker, de filial simulada, que não entra
   * em contingência (RN-FAT-10): lá a EPEC é recusada (ADR 0011).
   */
  readonly guardaEpec: boolean;
}

/** `cStat` que só a EPEC guardada produz (fora da cobertura da porta que não guarda EPEC). */
const CSTAT_SO_COM_EPEC = new Set(['136', '467']);

/** O sequencial (9 dígitos finais) do `nProt`/`nRec` do simulador, mascarado. */
const semSequencial = (xml: string) => xml.replace(/(?<!\d)(9\d{5})\d{9}(?!\d)/g, '$1#########');

async function xsdOk(xml: string, esquema: EsquemaXsd) {
  const r = await validarXsd(xml, esquema);
  expect(r.erros).toEqual([]);
}

const ev = (chave: string, minutos = 1) => ({
  chave,
  dhEvento: new Date(INICIO.getTime() + minutos * 60_000),
});

export function registrarSuiteSimulador(porta: PortaDeTeste): void {
  /** O `novoSimulador` do apoio, com o estado novo da porta em teste. */
  const novoSimulador = (o: Omit<NonNullable<Parameters<typeof novoSimuladorBase>[0]>, 'estado'> = {}) =>
    novoSimuladorBase({ ...o, estado: porta.novoEstado() });

  describe(`simulador (estado: ${porta.nome})`, () => {
    beforeAll(() => {
      a1DeTeste(); // gera os dois A1 uma vez (RSA 2048)
    });

    describe('trava da regra 7 e status', () => {
      it('statusServico responde 107, tpAmb 2, no contrato e no XSD', async () => {
        const { s } = novoSimulador();
        const r = vistos(await s.statusServico());
        expect(RespostaStatusServico.parse(r)).toMatchObject({
          tpAmb: 2,
          cStat: '107',
          cUF: 13,
          verAplic: VER_APLIC_SIMULADOR,
          dhRecbto: '2026-11-21T22:59:00-04:00',
        });
        await xsdOk(r.xml, 'retConsStatServ');
      });

      it.each([
        ['ambiente de produção', { ambiente: 'producao' }],
        ['tpAmb 1', { tpAmb: 1 }],
        ['tipo sefaz', { tipo: 'sefaz' }],
      ])('recusa destino forjado com %s', (_n, troca) => {
        const forjado = { ...destinoDe(), ...troca } as unknown as DestinoSimulador;
        expect(() => criarSimuladorSefaz(forjado)).toThrow(SimuladorEmProducaoErro);
      });

      it('XML com tpAmb 1 (produção) é rejeitado com 252: a terceira camada da trava', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 1, tpAmb: 1 });
        expect(await autorizarUma(s, n.xml)).toMatchObject({ cStat: '252', nProt: null, digVal: null });
      });

      it('pedido fora do contrato não sai (SEFAZ_PEDIDO_INVALIDO)', async () => {
        const { s } = novoSimulador();
        await expect(
          s.autorizar({ idLote: '1', sincrono: true, nfes: ['<NFe/>', '<NFe/>'] }),
        ).rejects.toMatchObject({ codigo: 'SEFAZ_PEDIDO_INVALIDO' });
      });
    });

    describe('autorização síncrona (indSinc 1)', () => {
      it('100 com nProt do simulador, digVal = DigestValue da NF-e, retorno e nfeProc no XSD', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 1, comIS: true });
        const r = await s.autorizar({
          idLote: '1',
          sincrono: true,
          nfes: [`<?xml version="1.0" encoding="UTF-8"?>${n.xml}`],
        });
        RespostaAutorizacao.parse(r);
        expect(vistos(r)).toMatchObject({
          cStat: '104',
          tpAmb: 2,
          recibo: null,
          verAplic: 'MACUXI-SIMULADOR-0.1',
        });
        const p = vistos(r.protocolos[0]!);
        expect(p).toMatchObject({
          cStat: '100',
          chNFe: n.chave,
          dhRecbto: '2026-11-21T22:59:00-04:00',
          xMotivo: 'Autorizado o uso da NF-e',
        });
        expect(p.nProt).toMatch(/^911326\d{9}$/);
        expect(p.digVal).toBe(/<DigestValue>([^<]+)<\/DigestValue>/.exec(n.xml)![1]);
        await xsdOk(r.xml, 'retEnviNFe');
        await xsdOk(montarNfeProc(n.xml, p.xml), 'procNFe');
      });

      it('225: lote fora do schema (sem assinatura ou grupo faltando) volta sem protocolo', async () => {
        const { s } = novoSimulador();
        const semAssinatura = (await import('@macuxierp/nfe-sefaz/teste')).montarNFeDeTeste({
          nNF: 1,
          dhEmi: INICIO,
        }).xml;
        for (const xml of [
          semAssinatura,
          nfeAssinada({ nNF: 2 }, { ajustar: (x) => x.replace(/<pag>.*<\/pag>/, '') }).xml,
        ]) {
          const r = vistos(await s.autorizar({ idLote: '1', sincrono: true, nfes: [xml] }));
          expect(r).toMatchObject({ cStat: '225', protocolos: [], recibo: null });
          await xsdOk(r.xml, 'retEnviNFe');
        }
      });

      it.each([
        ['226 UF do emitente diverge', { cUF: 14 }, {}, '226'],
        ['570 tpEmis de contingência no autorizador normal', { modo: 'svc-rs' as const }, {}, '570'],
        ['207 CNPJ do emitente com DV inválido', { cnpj: '11222333000182' }, {}, '207'],
        ['213 CNPJ-base do certificado diferente do emitente', {}, { outro: true }, '213'],
      ])('%s', async (_n, o, x: { outro?: boolean }, cStat) => {
        const { s } = novoSimulador();
        const a1 = x.outro ? a1DeTeste().outro : undefined;
        const n = nfeAssinada({ nNF: 3, ...o }, a1 ? { a1 } : {});
        expect(await autorizarUma(s, n.xml)).toMatchObject({ cStat, nProt: null });
      });

      it('502 Id fora da concatenação e 253 DV da chave', async () => {
        const { s } = novoSimulador();
        const id502 = nfeAssinada({ nNF: 4 }, { ajustar: (x) => x.replace('<nNF>4</nNF>', '<nNF>5</nNF>') });
        expect(await autorizarUma(s, id502.xml)).toMatchObject({ cStat: '502' });
        const dv = nfeAssinada(
          { nNF: 4 },
          {
            ajustar: (x) =>
              x.replace(/<cDV>(\d)<\/cDV>/, (_m, d: string) => `<cDV>${(Number(d) + 1) % 10}</cDV>`),
          },
        );
        expect(await autorizarUma(s, dv.xml)).toMatchObject({ cStat: '253' });
      });

      it('assinatura: o simulador repassa o cStat do verificador (297 aqui; os demais em xmldsig.test.ts)', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 6 });
        expect(
          await autorizarUma(s, n.xml.replace('<vPag>10.00</vPag>', '<vPag>99.00</vPag>')),
        ).toMatchObject({ cStat: '297' });
      });

      it('214: lote acima de 500 KB volta sem protocolo, antes do schema', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 12 });
        const gorda = n.xml.replace('</NFe>', `${' '.repeat(260_000)}</NFe>`);
        const r = vistos(await s.autorizar({ idLote: '1', sincrono: false, nfes: [gorda, gorda] }));
        expect(r).toMatchObject({
          cStat: '214',
          protocolos: [],
          recibo: null,
          xMotivo: 'Rejeicao: Tamanho da mensagem excedeu o limite estabelecido',
        });
        await xsdOk(r.xml, 'retEnviNFe');
        expect((await s.consultarProtocolo({ chNFe: n.chave })).cStat).toBe('217');
      });

      it('DOCTYPE (qualquer caixa) é recusado antes do parse: 225 na NF-e, 215 no evento e na inutilização', async () => {
        const { s } = novoSimulador();
        const dtd = '<!doctype NFe [<!ENTITY x SYSTEM "file:///etc/passwd">]>';
        const n = nfeAssinada({ nNF: 13 });
        expect(await s.autorizar({ idLote: '1', sincrono: true, nfes: [`${dtd}${n.xml}`] })).toMatchObject({
          cStat: '225',
          protocolos: [],
        });
        const p = await autorizarUma(s, n.xml);
        const canc = await s.cancelar({
          idLote: '2',
          eventoAssinado: `${dtd.replace('NFe', 'evento')}${cancelamentoAssinado({ ...ev(n.chave), nProt: p.nProt! })}`,
        });
        expect(canc).toMatchObject({ cStat: '215', eventos: [] });
        const inut = await s.inutilizar({
          inutilizacaoAssinada: `<!DOCTYPE inutNFe>${inutilizacaoAssinada({ ano: '26', nNFIni: 900, nNFFin: 901 })}`,
        });
        expect(inut).toMatchObject({ cStat: '215', nProt: null });
      });

      it('703 emissão no futuro e 228 emissão muito atrasada', async () => {
        const { s } = novoSimulador();
        expect(
          await autorizarUma(s, nfeAssinada({ nNF: 8, dhEmi: new Date(INICIO.getTime() + HORA) }).xml),
        ).toMatchObject({ cStat: '703' });
        expect(
          await autorizarUma(
            s,
            nfeAssinada({ nNF: 8, dhEmi: new Date(INICIO.getTime() - 31 * 24 * HORA) }).xml,
          ),
        ).toMatchObject({ cStat: '228' });
      });

      it('204 duplicidade (mesma chave) e 539 (mesmo número, outra chave), com o nProt original', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 9 });
        const p = await autorizarUma(s, n.xml);
        expect(await autorizarUma(s, n.xml)).toMatchObject({
          cStat: '204',
          xMotivo: `Duplicidade de NF-e [nProt:${p.nProt}][dhAut:${p.dhRecbto}]`,
        });
        const outra = await autorizarUma(s, nfeAssinada({ nNF: 9, cNF: '87654321' }).xml);
        expect(outra.cStat).toBe('539');
        expect(outra.xMotivo).toContain(`[chNFe:${n.chave}]`);
      });

      it('301/302 uso denegado: tem nProt, consulta dá 110, cancelamento dá 205 e reenvio dá 205', async () => {
        const { s } = novoSimulador();
        s.controles.denegar(CNPJ_OUTRO_DE_TESTE, 'destinatario');
        const n = nfeAssinada({ nNF: 10 });
        const p = await autorizarUma(s, n.xml);
        expect(p).toMatchObject({ cStat: '302' });
        expect(p.nProt).toMatch(/^9/);
        expect(vistos(await s.consultarProtocolo({ chNFe: n.chave }))).toMatchObject({
          cStat: '110',
          protocolo: { cStat: '302' },
        });
        const c = await s.cancelar({
          idLote: '2',
          eventoAssinado: cancelamentoAssinado({ ...ev(n.chave), nProt: p.nProt! }),
        });
        expect(vistos(c.eventos[0]!)).toMatchObject({ cStat: '205', nProt: null });
        expect(await autorizarUma(s, n.xml)).toMatchObject({ cStat: '205' });

        const { s: s2 } = novoSimulador();
        s2.controles.denegar(CNPJ_EMITENTE_DE_TESTE, 'emitente');
        expect(
          await autorizarUma(s2, nfeAssinada({ nNF: 11, docDestinatario: '12345678909' }).xml),
        ).toMatchObject({ cStat: '301' });
      });
    });

    describe('autorização assíncrona (recibo e tMed)', () => {
      it('103 com recibo; 105 antes do tMed; 104 depois; 106 recibo desconhecido; XSD dos retornos', async () => {
        const { s, relogio } = novoSimulador({ tMed: 3 });
        const notas = [nfeAssinada({ nNF: 20 }), nfeAssinada({ nNF: 21 })];
        const r = vistos(await s.autorizar({ idLote: '7', sincrono: false, nfes: notas.map((n) => n.xml) }));
        expect(r).toMatchObject({ cStat: '103', protocolos: [], recibo: { tMed: 3 } });
        await xsdOk(r.xml, 'retEnviNFe');
        const nRec = r.recibo!.nRec;
        expect(nRec).toMatch(/^911326\d{9}$/);

        relogio.avancar(2_000);
        const cedo = vistos(await s.consultarRecibo({ nRec }));
        expect(RespostaConsultaRecibo.parse(cedo)).toMatchObject({ cStat: '105', protocolos: [] });
        relogio.avancar(1_000);
        const pronto = vistos(await s.consultarRecibo({ nRec }));
        expect(pronto.cStat).toBe('104');
        expect(pronto.protocolos.map((p) => [p.chNFe, p.cStat])).toEqual(notas.map((n) => [n.chave, '100']));
        await xsdOk(pronto.xml, 'retConsReciNFe');

        const nada = vistos(await s.consultarRecibo({ nRec: '913260000000999' }));
        expect(nada.cStat).toBe('106');
        await xsdOk(nada.xml, 'retConsReciNFe');
      });

      it('atrasarRecibo: 105 mesmo depois do tMed, nas consultas pedidas', async () => {
        const { s, relogio } = novoSimulador({ tMed: 1 });
        const r = await s.autorizar({ idLote: '8', sincrono: false, nfes: [nfeAssinada({ nNF: 22 }).xml] });
        s.controles.atrasarRecibo(2);
        relogio.avancar(10_000);
        expect((await s.consultarRecibo({ nRec: r.recibo!.nRec })).cStat).toBe('105');
        expect((await s.consultarRecibo({ nRec: r.recibo!.nRec })).cStat).toBe('105');
        expect((await s.consultarRecibo({ nRec: r.recibo!.nRec })).cStat).toBe('104');
      });
    });

    describe('consulta de protocolo', () => {
      it('100 autorizada, 217 não consta, 236 DV inválido, 226 outra UF; XSD do retorno', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 30 });
        await autorizarUma(s, n.xml);
        const c = vistos(await s.consultarProtocolo({ chNFe: n.chave }));
        expect(RespostaConsultaProtocolo.parse(c)).toMatchObject({
          cStat: '100',
          protocolo: { cStat: '100', chNFe: n.chave },
          eventos: [],
        });
        await xsdOk(c.xml, 'retConsSitNFe');
        const naoConsta = nfeAssinada({ nNF: 31 }).chave;
        expect(vistos(await s.consultarProtocolo({ chNFe: naoConsta })).cStat).toBe('217');
        const dvErrado = naoConsta.slice(0, 43) + String((Number(naoConsta[43]) + 1) % 10);
        expect(vistos(await s.consultarProtocolo({ chNFe: dvErrado })).cStat).toBe('236');
        const outraUf = nfeAssinada({ nNF: 31, cUF: 14 }).chave;
        expect(vistos(await s.consultarProtocolo({ chNFe: outraUf })).cStat).toBe('226');
      });
    });

    describe('cancelamento (110111)', () => {
      it('135 no prazo; consulta dá 101 com o procEventoNFe; repetir dá 573; CC-e depois dá 218', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 40 });
        const p = await autorizarUma(s, n.xml);
        const r = vistos(
          await s.cancelar({
            idLote: '3',
            eventoAssinado: cancelamentoAssinado({ ...ev(n.chave), nProt: p.nProt! }),
          }),
        );
        expect(RespostaEvento.parse(r)).toMatchObject({ cStat: '128', cOrgao: 13, idLote: '3' });
        const e = vistos(r.eventos[0]!);
        expect(e).toMatchObject({ cStat: '135', tpEvento: '110111', nSeqEvento: 1, chNFe: n.chave });
        expect(e.nProt).toMatch(/^9/);
        await xsdOk(r.xml, 'retEnvEventoCancNFe');

        const c = vistos(await s.consultarProtocolo({ chNFe: n.chave }));
        expect(c).toMatchObject({ cStat: '101', eventos: [{ cStat: '135', tpEvento: '110111' }] });
        await xsdOk(c.xml, 'retConsSitNFe');

        const de_novo = await s.cancelar({
          idLote: '4',
          eventoAssinado: cancelamentoAssinado({ ...ev(n.chave, 2), nProt: p.nProt! }),
        });
        expect(vistos(de_novo.eventos[0]!).cStat).toBe('573');
        const cce = await s.cartaCorrecao({
          idLote: '5',
          eventoAssinado: cceAssinada({ ...ev(n.chave, 3), nSeqEvento: 1 }),
        });
        expect(vistos(cce.eventos[0]!).cStat).toBe('218');
      });

      it('501 depois de 24 h; 222 com nProt diferente', async () => {
        const { s, relogio } = novoSimulador();
        const n = nfeAssinada({ nNF: 41 });
        const p = await autorizarUma(s, n.xml);
        const errado = await s.cancelar({
          idLote: '6',
          eventoAssinado: cancelamentoAssinado({ ...ev(n.chave), nProt: '913260000099999' }),
        });
        expect(vistos(errado.eventos[0]!).cStat).toBe('222');
        relogio.avancar(24 * HORA + 60_000);
        const tarde = await s.cancelar({
          idLote: '7',
          eventoAssinado: cancelamentoAssinado({ ...ev(n.chave, 24 * 60 + 1), nProt: p.nProt! }),
        });
        expect(vistos(tarde.eventos[0]!).cStat).toBe('501');
      });

      it('operação errada para o tpEvento é erro de quem chama, não rejeição', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 42 });
        await expect(
          s.cancelar({ idLote: '1', eventoAssinado: cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }) }),
        ).rejects.toBeInstanceOf(ErroSefaz);
      });
    });

    describe('carta de correção (110110)', () => {
      it('135 por nSeqEvento; nSeq repetido dá 573; XSD do retorno', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 50 });
        await autorizarUma(s, n.xml);
        const r1 = await s.cartaCorrecao({
          idLote: '1',
          eventoAssinado: cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }),
        });
        expect(vistos(r1.eventos[0]!)).toMatchObject({ cStat: '135', nSeqEvento: 1 });
        await xsdOk(r1.xml, 'retEnvCCe');
        const rep = await s.cartaCorrecao({
          idLote: '2',
          eventoAssinado: cceAssinada({ ...ev(n.chave, 2), nSeqEvento: 1 }),
        });
        expect(vistos(rep.eventos[0]!).cStat).toBe('573');
        const r2 = await s.cartaCorrecao({
          idLote: '3',
          eventoAssinado: cceAssinada({ ...ev(n.chave, 3), nSeqEvento: 2 }),
        });
        expect(r2.eventos[0]).toMatchObject({ cStat: '135', nSeqEvento: 2 });
        expect((await s.consultarProtocolo({ chNFe: n.chave })).eventos.map((e) => e.nSeqEvento)).toEqual([
          1, 2,
        ]);
      });

      it('rejeições do evento: 215, 252, 250, 455, 572, 494, 574, 578, 577 e a assinatura (297)', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 51 });
        await autorizarUma(s, n.xml);
        const enviar = async (xml: string) =>
          vistos(await s.cartaCorrecao({ idLote: '9', eventoAssinado: xml }));
        const e = (r: { eventos: { cStat: string }[] }) => vistos(r.eventos[0]!).cStat;

        expect(
          (
            await enviar(
              cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }, undefined, (x) =>
                x.replace(/<xCorrecao>[^<]*/, '<xCorrecao>curta'),
              ),
            )
          ).cStat,
        ).toBe('215');
        expect(e(await enviar(cceAssinada({ ...ev(n.chave), nSeqEvento: 1, tpAmb: 1 })))).toBe('252');
        expect(e(await enviar(cceAssinada({ ...ev(n.chave), nSeqEvento: 1, cOrgao: 14 })))).toBe('250');
        const chaveRr = nfeAssinada({ nNF: 51, cUF: 14 }).chave;
        expect(e(await enviar(cceAssinada({ ...ev(chaveRr), nSeqEvento: 1 })))).toBe('455');
        expect(
          e(
            await enviar(
              cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }, undefined, (x) =>
                x.replace(/Id="ID110110(\d{44})01"/, 'Id="ID110110$102"'),
              ),
            ),
          ),
        ).toBe('572');
        expect(e(await enviar(cceAssinada({ ...ev(nfeAssinada({ nNF: 52 }).chave), nSeqEvento: 1 })))).toBe(
          '494',
        );
        expect(
          e(
            await enviar(
              cceAssinada({ ...ev(n.chave), nSeqEvento: 1, cnpj: CNPJ_OUTRO_DE_TESTE }, a1DeTeste().outro),
            ),
          ),
        ).toBe('574');
        expect(e(await enviar(cceAssinada({ ...ev(n.chave, 60), nSeqEvento: 1 })))).toBe('578');
        expect(e(await enviar(cceAssinada({ ...ev(n.chave, -30), nSeqEvento: 1 })))).toBe('577');
        // assinatura do evento: alterado depois de assinado
        expect(
          e(
            await enviar(
              cceAssinada({ ...ev(n.chave), nSeqEvento: 1 }).replace(
                'Correcao de teste:',
                'Correcao de testX:',
              ),
            ),
          ),
        ).toBe('297');
      });
    });

    describe('inutilização', () => {
      it('102 com nProt; 563 mesma faixa; 256 cruza outra; 241 número usado; 206 emitir número inutilizado; XSD', async () => {
        const { s } = novoSimulador();
        const r = vistos(
          await s.inutilizar({
            inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 100, nNFFin: 110 }),
          }),
        );
        expect(RespostaInutilizacao.parse(r)).toMatchObject({
          cStat: '102',
          CNPJ: CNPJ_EMITENTE_DE_TESTE,
          serie: 1,
          nNFIni: 100,
          nNFFin: 110,
          ano: '26',
          mod: '55',
        });
        expect(r.nProt).toMatch(/^9/);
        await xsdOk(r.xml, 'retInutNFe');
        expect(
          vistos(
            await s.inutilizar({
              inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 100, nNFFin: 110 }),
            }),
          ).cStat,
        ).toBe('563');
        expect(
          vistos(
            await s.inutilizar({
              inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 105, nNFFin: 120 }),
            }),
          ).cStat,
        ).toBe('256');
        expect(await autorizarUma(s, nfeAssinada({ nNF: 105 }).xml)).toMatchObject({ cStat: '206' });
        await autorizarUma(s, nfeAssinada({ nNF: 130 }).xml);
        expect(
          vistos(
            await s.inutilizar({
              inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 125, nNFFin: 135 }),
            }),
          ).cStat,
        ).toBe('241');
      });

      it('224, 453, 454, 252, 226, 213 e 215', async () => {
        const { s } = novoSimulador();
        const inut = async (
          o: Parameters<typeof inutilizacaoAssinada>[0],
          a1?: Parameters<typeof inutilizacaoAssinada>[1],
        ) => vistos(await s.inutilizar({ inutilizacaoAssinada: inutilizacaoAssinada(o, a1) })).cStat;
        expect(await inut({ ano: '26', nNFIni: 9, nNFFin: 8 })).toBe('224');
        expect(await inut({ ano: '27', nNFIni: 1, nNFFin: 1 })).toBe('453');
        expect(await inut({ ano: '05', nNFIni: 1, nNFFin: 1 })).toBe('454');
        expect(await inut({ ano: '26', nNFIni: 1, nNFFin: 1, tpAmb: 1 })).toBe('252');
        expect(await inut({ ano: '26', nNFIni: 1, nNFFin: 1, cUF: 14 })).toBe('226');
        expect(await inut({ ano: '26', nNFIni: 1, nNFFin: 1 }, a1DeTeste().outro)).toBe('213');
        expect(await inut({ ano: '26', nNFIni: 1, nNFFin: 1, xJust: 'curta' })).toBe('215');
      });
    });

    describe('contingência SVC-RS', () => {
      it('autoriza NF-e com tpEmis 7 (protocolo 97...), recusa tpEmis 1 (570) e não tem inutilização', async () => {
        const { s } = novoSimulador({ modo: 'svc-rs' });
        expect(s.destino).toMatchObject({ modo: 'svc-rs', tpEmis: 7, tpAmb: 2 });
        const p = await autorizarUma(s, nfeAssinada({ nNF: 60, modo: 'svc-rs' }).xml);
        expect(p.cStat).toBe('100');
        expect(p.nProt).toMatch(/^971326\d{9}$/);
        expect(await autorizarUma(s, nfeAssinada({ nNF: 61 }).xml)).toMatchObject({ cStat: '570' });
        const erro = await s
          .inutilizar({ inutilizacaoAssinada: inutilizacaoAssinada({ ano: '26', nNFIni: 1, nNFFin: 1 }) })
          .catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(FalhaTransporteSefaz);
        expect(erro).toMatchObject({ retentavel: false });
      });
    });

    describe('contingência: dhCont e xJust no ide (ADR 0011)', () => {
      it('556 normal com justificativa, 557 contingência sem, 558 entrada depois do recebimento', async () => {
        const { s } = novoSimulador();
        const antes = new Date(INICIO.getTime() - 120_000);
        expect(await autorizarUma(s, nfeAssinada({ nNF: 90, contingencia: { dhCont: antes } }).xml)).toMatchObject({ cStat: '556', nProt: null });
        const svc = novoSimulador({ modo: 'svc-rs' }).s;
        expect(await autorizarUma(svc, nfeAssinada({ nNF: 91, modo: 'svc-rs', contingencia: null }).xml)).toMatchObject({ cStat: '557' });
        const depois = { dhCont: new Date(INICIO.getTime() + HORA) };
        expect(await autorizarUma(svc, nfeAssinada({ nNF: 92, modo: 'svc-rs', contingencia: depois }).xml)).toMatchObject({ cStat: '558' });
      });

      it('nota EPEC (tpEmis 4): na SVC dá 570; no autorizador normal, sem EPEC registrada, 468', async () => {
        expect(await autorizarUma(novoSimulador({ modo: 'svc-rs' }).s, nfeAssinada({ nNF: 93, tpEmis: 4 }).xml)).toMatchObject({ cStat: '570' });
        expect(await autorizarUma(novoSimulador().s, nfeAssinada({ nNF: 94, tpEmis: 4 }).xml)).toMatchObject({ cStat: '468', nProt: null });
      });
    });

    describe('EPEC (110140) no Ambiente Nacional e a volta à normal (ADR 0011)', () => {
      it.runIf(porta.guardaEpec)('136 com a SEFAZ da UF paralisada; 573 na repetida; na volta a nota EPEC dá 100 com a EPEC vinculada', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 100, tpEmis: 4 });
        s.controles.paralisar('108');
        const r = vistos(await s.epec({ idLote: '1', eventoAssinado: epecAssinada(n.xml) }));
        expect(RespostaEvento.parse(r)).toMatchObject({ cStat: '128', cOrgao: 91, tpAmb: 2, idLote: '1' });
        expect(vistos(r.eventos[0]!)).toMatchObject({ cStat: '136', tpEvento: '110140', chNFe: n.chave, nSeqEvento: 1, nProt: expect.stringMatching(/^9/) });
        await xsdOk(r.xml, 'retEnvEPEC');
        const repetida = await s.epec({ idLote: '2', eventoAssinado: epecAssinada(n.xml, { dhEvento: new Date(INICIO.getTime() + 60_000) }) });
        expect(vistos(repetida.eventos[0]!)).toMatchObject({ cStat: '573', nProt: null });
        await expect(autorizarUma(s, n.xml)).rejects.toBeInstanceOf(FalhaTransporteSefaz); // UF ainda paralisada
        s.controles.paralisar(null);
        const p = await autorizarUma(s, n.xml);
        expect(p).toMatchObject({ cStat: '100', chNFe: n.chave });
        const c = vistos(await s.consultarProtocolo({ chNFe: n.chave }));
        expect(c.cStat).toBe('100');
        expect(c.eventos.map((e) => [e.tpEvento, e.cStat])).toEqual([['110140', '136']]);
        expect(c.xml).toContain('<procEventoNFe versao="1.00"><evento');
        await xsdOk(c.xml, 'retConsSitNFe');
        expect(await autorizarUma(s, n.xml, '3')).toMatchObject({ cStat: '204' }); // sem dobrar o número
      });

      it.runIf(porta.guardaEpec)('467: a NF-e transmitida na volta diverge da EPEC registrada', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 101, tpEmis: 4 });
        const r = await s.epec({ idLote: '1', eventoAssinado: epecAssinada(n.xml, { dhEvento: INICIO, ajustar: (d) => ({ ...d, vNF: '99.99' }) }) });
        expect(r.eventos[0]?.cStat).toBe('136');
        expect(await autorizarUma(s, n.xml)).toMatchObject({ cStat: '467', nProt: null });
      });

      it.runIf(porta.guardaEpec)('rejeições da EPEC: 252, 250, 574, 455, 578, 577 e 215 no lote', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 102, tpEmis: 4 });
        const cStat = async (o: Parameters<typeof epecAssinada>[1], a1?: Parameters<typeof epecAssinada>[2]) =>
          vistos((await s.epec({ idLote: '1', eventoAssinado: epecAssinada(n.xml, o, a1) })).eventos[0]!).cStat;
        expect(await cStat({ dhEvento: INICIO, tpAmb: 1 })).toBe('252');
        expect(await cStat({ dhEvento: INICIO, cOrgao: 13 })).toBe('250');
        expect(await cStat({ dhEvento: INICIO, cnpj: CNPJ_OUTRO_DE_TESTE }, a1DeTeste().outro)).toBe('574');
        expect(await cStat({ dhEvento: INICIO, ajustar: (d) => ({ ...d, cOrgaoAutor: '14' }) })).toBe('455');
        expect(await cStat({ dhEvento: new Date(INICIO.getTime() + HORA) })).toBe('578');
        expect(await cStat({ dhEvento: new Date(INICIO.getTime() - HORA) })).toBe('577');
        const lote = vistos(await s.epec({ idLote: '1', eventoAssinado: epecAssinada(n.xml, { dhEvento: INICIO, ajustar: (d) => ({ ...d, vNF: 'abc' }) }) }));
        expect(lote).toMatchObject({ cStat: '215', eventos: [] });
        await xsdOk(lote.xml, 'retEnvEPEC');
      });

      it.runIf(!porta.guardaEpec)('RN-FAT-10: a porta do simulador do worker não guarda EPEC (SEFAZ_CONTINGENCIA_SIMULADA)', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 103, tpEmis: 4 });
        await expect(s.epec({ idLote: '1', eventoAssinado: epecAssinada(n.xml) })).rejects.toMatchObject({ codigo: 'SEFAZ_CONTINGENCIA_SIMULADA' });
      });

      it('EPEC no destino de SVC e evento de outro tipo são erro de quem chama, nada é registrado', async () => {
        const n = nfeAssinada({ nNF: 104, tpEmis: 4 });
        await expect(novoSimulador({ modo: 'svc-rs' }).s.epec({ idLote: '1', eventoAssinado: epecAssinada(n.xml) })).rejects.toMatchObject({
          codigo: 'SEFAZ_CONTINGENCIA_INVALIDA',
        });
        const cancelamento = cancelamentoAssinado({ ...ev(n.chave), nProt: '913260000000001' });
        await expect(novoSimulador().s.epec({ idLote: '1', eventoAssinado: cancelamento })).rejects.toMatchObject({ codigo: 'SEFAZ_PEDIDO_INVALIDO' });
      });
    });

    describe('controles de teste', () => {
      it('paralisar: status 108/109 e as demais operações falham como rede (retentável)', async () => {
        const { s } = novoSimulador();
        s.controles.paralisar('108');
        expect(vistos(await s.statusServico())).toMatchObject({ cStat: '108', xObs: expect.any(String) });
        await expect(
          s.autorizar({ idLote: '1', sincrono: true, nfes: [nfeAssinada({ nNF: 70 }).xml] }),
        ).rejects.toMatchObject({ retentavel: true });
        s.controles.paralisar('109');
        const r = vistos(await s.statusServico());
        expect(r.cStat).toBe('109');
        await xsdOk(r.xml, 'retConsStatServ');
        s.controles.paralisar(null);
        expect((await s.statusServico()).cStat).toBe('107');
      });

      it('resposta perdida: falha depois de processar, a consulta acha 100 e o reenvio dá 204 (desenho §3.3)', async () => {
        const { s } = novoSimulador();
        const n = nfeAssinada({ nNF: 71 });
        s.controles.falharTransporte(1, { aposProcessar: true });
        await expect(s.autorizar({ idLote: '1', sincrono: true, nfes: [n.xml] })).rejects.toBeInstanceOf(
          FalhaTransporteSefaz,
        );
        expect((await s.consultarProtocolo({ chNFe: n.chave })).cStat).toBe('100');
        expect(await autorizarUma(s, n.xml, '2')).toMatchObject({ cStat: '204' });

        s.controles.falharTransporte(1);
        const m = nfeAssinada({ nNF: 72 });
        await expect(s.autorizar({ idLote: '3', sincrono: true, nfes: [m.xml] })).rejects.toBeInstanceOf(
          FalhaTransporteSefaz,
        );
        expect((await s.consultarProtocolo({ chNFe: m.chave })).cStat).toBe('217');
      });
    });

    describe('estado por destino e determinismo', () => {
      it('a fábrica do seletor compartilha o estado do destino; nProt nunca repete entre filiais', async () => {
        const seletor = criarSeletorTransporte({
          transporte: 'simulador',
          simulador: criarFabricaSimulador({ agora: () => INICIO, estado: porta.novoEstado() }),
        });
        const cred = { pfx: new Uint8Array(), senha: '' };
        const outraFilial = '2b0e8a7c-1d3f-4e5a-8b6c-9d0e1f2a3b4c';
        const n = nfeAssinada({ nNF: 80 });
        const p = await autorizarUma(
          seletor({ filial_id: FILIAL, ambiente: 'homologacao', uf: 'AM' }, cred) as never,
          n.xml,
        );
        expect(
          (
            await seletor({ filial_id: FILIAL, ambiente: 'homologacao', uf: 'AM' }, cred).consultarProtocolo({
              chNFe: n.chave,
            })
          ).cStat,
        ).toBe('100');
        const q = await autorizarUma(
          seletor({ filial_id: outraFilial, ambiente: 'homologacao', uf: 'AM' }, cred) as never,
          n.xml,
        );
        expect(q.cStat).toBe('100'); // outra filial, outro estado
        expect(q.nProt).not.toBe(p.nProt);
        expect(() => seletor({ filial_id: FILIAL, ambiente: 'producao', uf: 'AM' }, cred)).toThrow(
          SimuladorEmProducaoErro,
        );
      });

      it('mesmas entradas e mesmo relógio dão o mesmo XML de resposta (no Postgres, salvo o sequencial, que nunca repete)', async () => {
        const n = nfeAssinada({ nNF: 81 });
        const uma = () =>
          criarSimuladorSefaz(destinoDe(), {
            agora: () => INICIO,
            registro: criarRegistroSimulador(),
            estado: porta.novoEstado(),
          });
        const um = await uma().autorizar({ idLote: '1', sincrono: true, nfes: [n.xml] });
        const dois = await uma().autorizar({ idLote: '1', sincrono: true, nfes: [n.xml] });
        if (porta.sequenciaGlobal) {
          expect(dois.protocolos[0]?.nProt).not.toBe(um.protocolos[0]?.nProt);
          expect(semSequencial(dois.xml)).toBe(semSequencial(um.xml));
        } else expect(dois.xml).toBe(um.xml);
      });
    });

    afterAll(() => {
      // Cobertura: cada cStat que o simulador sabe devolver apareceu em algum teste deste arquivo. Os da assinatura e do
      // certificado (298, 202, 290, 291, 292...) são provados no verificador (`packages/nfe-sefaz/src/xmldsig.test.ts`):
      // o simulador só repassa o `cStat` dele, e aqui fica um caso por caminho (NF-e, evento e inutilização).
      const doVerificador = new Set<string>(Object.values(CSTAT_FALHA_ASSINATURA));
      const foraDaPorta = (c: string) => !porta.guardaEpec && CSTAT_SO_COM_EPEC.has(c);
      expect(CSTAT_DO_SIMULADOR.filter((c) => !CSTAT_VISTOS.has(c) && !doVerificador.has(c) && !foraDaPorta(c))).toEqual([]);
    });
  });
}
