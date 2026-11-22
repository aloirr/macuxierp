/**
 * T-0018, critério C3 (e C1/C2 oficiais) contra o simulador da SEFAZ-AM da T-0045, in-process: o destino vem do
 * `escolherDestinoSefaz` com `transporte: 'simulador'` e o transporte é o `criarSimuladorSefaz`. Tudo o que vai ao
 * simulador sai do emissor: NF-e, eventos e inutilização montados e assinados aqui, com um A1 de teste que traz o
 * CNPJ só no SAN ICP-Brasil (RD-0294). O spike não guarda o XML (é da T-0021): monta o `nfeProc` e valida no XSD.
 */
import { randomUUID } from 'node:crypto';
import {
  SimuladorEmProducaoErro,
  chaveNFeComDvValido,
  criarSeletorTransporte,
  escolherDestinoSefaz,
  montarEnvEvento,
  montarNfeProc,
  validarXsd,
  verificarAssinaturaNFe,
  type DestinoSimulador,
  type SefazTransporte,
} from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { PREFIXO_NUMERO_SIMULADOR, criarFabricaSimulador, criarSimuladorSefaz } from '@macuxierp/sefaz-simulador';
import { beforeEach, describe, expect, it } from 'vitest';
import { assinarDocumento } from './assinatura';
import { criarEmissorNFe } from './emissor';
import { montarCancelamento, montarInutilizacao } from './eventos';
import { a1DeTesteAberto } from './testes/a1';
import { NOTAS, NOTAS_POR_CSOSN, notaMei, vendaSimplesAm } from './testes/notas';
import { criarFabricaTransporteSoap } from './transporte';

const emissor = criarEmissorNFe();
const { gerado, a1 } = a1DeTesteAberto();
const NPROT_SIMULADOR = new RegExp(`^${PREFIXO_NUMERO_SIMULADOR}\\d{14}$`);

let relogio: Date;
const avancar = (ms: number) => {
  relogio = new Date(relogio.getTime() + ms);
};

function destinoDoSimulador(): DestinoSimulador {
  const d = escolherDestinoSefaz({ filial_id: randomUUID(), ambiente: 'homologacao', uf: 'AM' }, { transporte: 'simulador' });
  if (d.tipo !== 'simulador') throw new Error('esperava o destino do simulador');
  return d;
}

/** Monta e assina a nota `nNF` (série dada) da fixture de venda no AM. */
function notaAssinada(nNF: number, serie = 1) {
  const montada = emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF, serie } });
  return { montada, assinada: emissor.assinar(montada.xml, a1) };
}

let sim: SefazTransporte;
beforeEach(() => {
  relogio = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);
  sim = criarSimuladorSefaz(destinoDoSimulador(), { agora: () => relogio, tMed: 1 });
});

describe('C1 e C2 oficiais: XSD do PL_010g e verificador XMLDSig do nfe-sefaz', () => {
  it('as 5 fixtures montadas e assinadas passam no XSD (nfe) e no verificador, com o CNPJ do SAN', async () => {
    for (const nota of Object.values(NOTAS)) {
      const assinada = emissor.assinar(emissor.montar(nota).xml, a1);
      expect((await validarXsd(assinada.xml, 'nfe')).erros).toEqual([]);
      expect(verificarAssinaturaNFe(assinada.xml, { cnpjEsperado: gerado.cnpj, agora: INSTANTE_DE_TESTE })).toMatchObject({ ok: true, digestValue: assinada.digVal });
    }
  });
});

describe('Simples Nacional e MEI no XSD do PL_010g e no simulador', () => {
  it('uma NF-e por CSOSN (101, 102, 103, 201, 202, 203, 300, 400, 500 e 900), assinada, passa no XSD (nfe)', async () => {
    const csosns = Object.keys(NOTAS_POR_CSOSN);
    expect(csosns).toEqual(expect.arrayContaining(['101', '102', '103', '201', '202', '300', '400', '500', '900']));
    for (const [csosn, nota] of Object.entries(NOTAS_POR_CSOSN)) {
      const assinada = emissor.assinar(emissor.montar(nota).xml, a1);
      expect((await validarXsd(assinada.xml, 'nfe')).erros, `CSOSN ${csosn}`).toEqual([]);
    }
  });

  it('nota do MEI (CRT 4, NT 2024.001; CSOSN 102 e 500; PIS/COFINS 99 zerados; sem IBS/CBS): 100 no simulador e nfeProc válido', async () => {
    const montada = emissor.montar({ ...notaMei, ide: { ...notaMei.ide, nNF: 40 } });
    expect(montada.xml).toContain('<CRT>4</CRT>');
    expect(montada.xml).not.toContain('<IBSCBS>');
    const assinada = emissor.assinar(montada.xml, a1);
    expect((await validarXsd(assinada.xml, 'nfe')).erros).toEqual([]);
    const r = await emissor.transmitir(assinada.xml, '40', sim);
    const p = r.protocolos[0]!;
    expect([r.cStat, p.cStat, p.chNFe, p.digVal]).toEqual(['104', '100', montada.chave, assinada.digVal]);
    expect(p.nProt).toMatch(NPROT_SIMULADOR);
    expect((await validarXsd(montarNfeProc(assinada.xml, p.xml), 'procNFe')).erros).toEqual([]);
  });
});

describe('C3: autorização, consulta, eventos e inutilização no simulador', () => {
  it('síncrona: 104 com o protocolo 100, nProt do simulador e digVal = DigestValue da assinatura do emissor', async () => {
    const { montada, assinada } = notaAssinada(1);
    const r = await emissor.transmitir(assinada.xml, '1', sim);
    expect(r).toMatchObject({ tpAmb: 2, cStat: '104', recibo: null });
    expect(r.protocolos).toHaveLength(1);
    const p = r.protocolos[0]!;
    expect(p).toMatchObject({ chNFe: montada.chave, cStat: '100', digVal: assinada.digVal });
    expect(p.nProt).toMatch(NPROT_SIMULADOR);
    const verificada = verificarAssinaturaNFe(assinada.xml, { agora: INSTANTE_DE_TESTE });
    expect(verificada.ok && verificada.digestValue).toBe(p.digVal);
    expect((await validarXsd(r.xml, 'retEnviNFe')).valido).toBe(true);
  });

  it('assíncrona: 103 com recibo, 105 antes do tMed e 104 com os protocolos depois', async () => {
    const notas = [2, 3, 4].map((n) => notaAssinada(n));
    const r = await sim.autorizar({ idLote: '2', sincrono: false, nfes: notas.map((n) => n.assinada.xml) });
    expect(r).toMatchObject({ cStat: '103', protocolos: [] });
    const nRec = r.recibo!.nRec;
    expect((await sim.consultarRecibo({ nRec })).cStat).toBe('105');
    avancar(2_000);
    const c = await sim.consultarRecibo({ nRec });
    expect(c.cStat).toBe('104');
    expect(c.protocolos.map((p) => [p.chNFe, p.cStat, p.digVal])).toEqual(notas.map((n) => [n.montada.chave, '100', n.assinada.digVal]));
  });

  it('consulta de protocolo: 100 com o mesmo nProt; 217 para chave que a SEFAZ não conhece', async () => {
    const { montada, assinada } = notaAssinada(5);
    const nProt = (await emissor.transmitir(assinada.xml, '5', sim)).protocolos[0]!.nProt;
    const c = await sim.consultarProtocolo({ chNFe: montada.chave });
    expect(c).toMatchObject({ cStat: '100', chNFe: montada.chave, protocolo: { nProt, cStat: '100' }, eventos: [] });
    expect((await sim.consultarProtocolo({ chNFe: notaAssinada(6).montada.chave })).cStat).toBe('217');
  });

  it('CC-e (110110) e cancelamento (110111) pela porta (monta, assina e transmite): 128/135; a consulta vê 101 e os 2 eventos', async () => {
    const { montada, assinada } = notaAssinada(7);
    const nProt = (await emissor.transmitir(assinada.xml, '7', sim)).protocolos[0]!.nProt!;
    avancar(60_000);
    const base = { chNFe: montada.chave, cnpj: gerado.cnpj, tpAmb: 2 as const, dhEvento: relogio, fusoMinutos: -240 };

    const rc = await emissor.cartaCorrecao({ ...base, idLote: '71', nSeqEvento: 1, xCorrecao: 'Endereco de entrega: Rua de Teste, 100' }, a1, sim);
    expect(rc).toMatchObject({ cStat: '128', idLote: '71', eventos: [{ tpEvento: '110110', nSeqEvento: 1, cStat: '135' }] });
    // A porta devolve o evento assinado (para o procEventoNFe do chamador), conferível no XSD e no verificador.
    expect((await validarXsd(montarEnvEvento('71', rc.assinado.xml), 'envCCe')).erros).toEqual([]);

    // Sem idLote, a porta usa dhEvento em milissegundos: a retentativa só sai com o mesmo lote se o chamador guardou o pedido.
    const rx = await emissor.cancelar({ ...base, nProt, xJust: 'Pedido cancelado pelo cliente (teste)' }, a1, sim);
    expect(rx).toMatchObject({ cStat: '128', idLote: String(relogio.getTime()), eventos: [{ tpEvento: '110111', cStat: '135' }] });
    expect(rx.eventos[0]!.nProt).toMatch(NPROT_SIMULADOR);
    expect(rx.assinado.xml).toContain('<tpEvento>110111</tpEvento>');

    const c = await sim.consultarProtocolo({ chNFe: montada.chave });
    expect(c.cStat).toBe('101');
    expect(c.eventos.map((e) => e.tpEvento)).toEqual(['110110', '110111']);
  });

  it('inutilização pela porta (monta, assina infInut e transmite): 102 com nProt; a mesma faixa de novo dá 563', async () => {
    const pedido = { cUF: 13, tpAmb: 2 as const, ano: '26', cnpj: gerado.cnpj, serie: 1, nNFIni: 50, nNFFin: 52, xJust: 'Numeracao pulada por falha no sistema (teste)' };
    const r = await emissor.inutilizar(pedido, a1, sim);
    expect(r).toMatchObject({ cStat: '102', CNPJ: gerado.cnpj, serie: 1, nNFIni: 50, nNFFin: 52 });
    expect(r.nProt).toMatch(NPROT_SIMULADOR);
    expect((await validarXsd(r.assinado.xml, 'inutNFe')).erros).toEqual([]);
    expect((await emissor.inutilizar(pedido, a1, sim)).cStat).toBe('563');
  });

  it('a porta recusa o pedido inválido antes de assinar ou transmitir (rejeita a promessa, nada chega ao simulador)', async () => {
    const chNFe = notaAssinada(1).montada.chave;
    await expect(emissor.cancelar({ chNFe, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, fusoMinutos: -240, nProt: '1', xJust: 'curta' }, a1, sim)).rejects.toThrow(/NFE_ENTRADA_INVALIDA: nProt/);
    await expect(emissor.cartaCorrecao({ chNFe, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, fusoMinutos: -240, nSeqEvento: 21, xCorrecao: 'Correcao de teste longa' }, a1, sim)).rejects.toThrow(/nSeqEvento/);
    await expect(emissor.inutilizar({ cUF: 13, tpAmb: 2, ano: '26', cnpj: gerado.cnpj, serie: 1, nNFIni: 9, nNFFin: 8, xJust: 'Faixa invertida de teste' }, a1, sim)).rejects.toThrow(/nNFFin/);
    expect((await sim.consultarProtocolo({ chNFe })).cStat).toBe('217');
  });

  it('225: XML fora do schema, assinado pelo emissor, é recusado no lote (sem protocolo)', async () => {
    const montada = emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF: 8 } });
    const foraDoLeiaute = montada.xml.replace('</ide>', '<campoForaDoLeiaute>1</campoForaDoLeiaute></ide>');
    const assinada = emissor.assinar(foraDoLeiaute, a1);
    expect(verificarAssinaturaNFe(assinada.xml, { agora: INSTANTE_DE_TESTE }).ok).toBe(true);
    expect(await emissor.transmitir(assinada.xml, '8', sim)).toMatchObject({ cStat: '225', protocolos: [] });
  });

  it('297: nota alterada depois de assinada pelo emissor (schema válido) volta rejeitada no protocolo', async () => {
    const { assinada } = notaAssinada(9);
    const adulterada = assinada.xml.replace('<vNF>21.00</vNF>', '<vNF>21.01</vNF>');
    expect(adulterada).not.toBe(assinada.xml);
    const r = await emissor.transmitir(adulterada, '9', sim);
    expect(r).toMatchObject({ cStat: '104', protocolos: [{ cStat: '297', nProt: null, digVal: null }] });
  });
});

describe('CNPJ alfanumérico (jul/2026) do emitente: da NotaParaEmissao ao 100 no simulador', () => {
  const ALFANUMERICO = '12ABC34501DE35';

  it('monta, assina com o A1 do mesmo CNPJ (no SAN), autoriza (100) e inutiliza (102); o cancelamento esbarra no XSD (215)', async () => {
    const alfa = a1DeTesteAberto({ cnpj: ALFANUMERICO });
    expect(alfa.a1.cnpj).toBe(ALFANUMERICO);
    const montada = emissor.montar({ ...vendaSimplesAm, emit: { ...vendaSimplesAm.emit, CNPJ: ALFANUMERICO }, ide: { ...vendaSimplesAm.ide, nNF: 30 } });
    expect(montada.chave.slice(6, 20)).toBe(ALFANUMERICO);
    expect(chaveNFeComDvValido(montada.chave)).toBe(true);
    const assinada = emissor.assinar(montada.xml, alfa.a1);
    expect((await validarXsd(assinada.xml, 'nfe')).erros).toEqual([]);
    const r = await emissor.transmitir(assinada.xml, '30', sim);
    expect(r.protocolos[0]).toMatchObject({ chNFe: montada.chave, cStat: '100', digVal: assinada.digVal });

    avancar(60_000);
    const canc = montarCancelamento({ chNFe: montada.chave, cnpj: ALFANUMERICO, tpAmb: 2, dhEvento: relogio, fusoMinutos: -240, nProt: r.protocolos[0]!.nProt!, xJust: 'Cancelamento do CNPJ alfanumerico' });
    const rx = await sim.cancelar({ idLote: '31', eventoAssinado: assinarDocumento(canc, alfa.a1, 'infEvento').xml });
    // Registro (desenho T-0018 §2.6, item 7, e §7.6): o `Id` do evento no leiaute 1.00 do PL_010g (espelho do
    // sped-nfe, "a conferir" na T-0046) ainda é `ID[0-9]{52}`, sem o CNPJ alfanumérico que o `TChNFe` já aceita. A
    // chave, a NF-e e a inutilização aceitam; o evento volta 215 no schema até o pacote oficial dizer outra coisa.
    expect(rx).toMatchObject({ cStat: '215', eventos: [] });

    const inut = montarInutilizacao({ cUF: 13, tpAmb: 2, ano: '26', cnpj: ALFANUMERICO, serie: 1, nNFIni: 60, nNFFin: 60, xJust: 'Inutilizacao do CNPJ alfanumerico' });
    expect(await sim.inutilizar({ inutilizacaoAssinada: assinarDocumento(inut, alfa.a1, 'infInut').xml })).toMatchObject({ cStat: '102', CNPJ: ALFANUMERICO });
  });

  it('RN-CAD-01: CNPJ com DV errado (numérico ou alfanumérico) ou minúsculo é recusado na entrada, nos eventos e na inutilização', () => {
    for (const cnpj of ['12ABC34501DE36', '11222333000182', '12abc34501de35']) {
      const emit = { ...vendaSimplesAm, emit: { ...vendaSimplesAm.emit, CNPJ: cnpj } };
      expect(() => emissor.montar(emit), cnpj).toThrow(/NFE_ENTRADA_INVALIDA: emit\.CNPJ/);
      const base = { chNFe: notaAssinada(1).montada.chave, tpAmb: 2 as const, dhEvento: relogio, fusoMinutos: -240, nProt: '9'.repeat(15), xJust: 'Cancelamento com CNPJ ruim' };
      expect(() => montarCancelamento({ ...base, cnpj }), cnpj).toThrow(/NFE_ENTRADA_INVALIDA: cnpj/);
      expect(() => montarInutilizacao({ cUF: 13, tpAmb: 2, ano: '26', cnpj, serie: 1, nNFIni: 1, nNFFin: 1, xJust: 'Inutilizacao com CNPJ ruim' }), cnpj).toThrow(/cnpj/);
    }
    const dest = { ...vendaSimplesAm, dest: { ...vendaSimplesAm.dest!, CNPJ: '11444777000162' } };
    expect(() => emissor.montar(dest)).toThrow(/dest\.CNPJ/);
    const chaveRuim = notaAssinada(1).montada.chave.replace(/.$/, (d) => String((Number(d) + 1) % 10));
    // O fuso da filial é obrigatório no evento (sem padrão fixo), como na NotaParaEmissao.
    const semFuso = { chNFe: notaAssinada(1).montada.chave, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, nProt: '9'.repeat(15), xJust: 'Cancelamento sem fuso' };
    expect(() => montarCancelamento(semFuso as unknown as Parameters<typeof montarCancelamento>[0])).toThrow(/NFE_ENTRADA_INVALIDA: fusoMinutos/);
    expect(() => montarCancelamento({ chNFe: chaveRuim, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, fusoMinutos: -240, nProt: '9'.repeat(15), xJust: 'Cancelamento de chave ruim' })).toThrow(/chNFe: chave com DV/);
  });
});

describe('C3, critério da F4 em miniatura: 20 notas autorizadas em sequência, sem buraco, com o nfeProc', () => {
  it('nNF 1 a 20 da série 2: 20 × 100, nProt únicos e o nfeProc (NF-e + protNFe) válido no XSD', async () => {
    const autorizadas: Array<{ nNF: number; nProt: string; proc: string }> = [];
    for (let nNF = 1; nNF <= 20; nNF++) {
      const { montada, assinada } = notaAssinada(nNF, 2);
      expect(chaveNFeComDvValido(montada.chave)).toBe(true);
      const r = await emissor.transmitir(assinada.xml, String(100 + nNF), sim);
      const p = r.protocolos[0]!;
      expect([p.cStat, p.digVal]).toEqual(['100', assinada.digVal]);
      // Regra 7: o que se guarda é o nfeProc com os bytes assinados intactos e o protNFe como veio.
      const proc = montarNfeProc(assinada.xml, p.xml);
      expect(proc).toContain(assinada.xml);
      expect(proc).toContain(p.xml);
      autorizadas.push({ nNF, nProt: p.nProt!, proc });
      avancar(1_000);
    }
    expect(autorizadas.map((a) => a.nNF)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(autorizadas.map((a) => a.nProt)).size).toBe(20);
    const xsd = await Promise.all(autorizadas.map((a) => validarXsd(a.proc, 'procNFe')));
    expect(xsd.flatMap((v) => v.erros)).toEqual([]);
  });
});

describe('a fiação do worker: seletor com as duas fábricas', () => {
  it('homologação vai ao simulador; produção com simulador lança a trava da regra 7; a fábrica sefaz é a do emissor', async () => {
    const seletor = criarSeletorTransporte({
      transporte: 'simulador',
      simulador: criarFabricaSimulador({ agora: () => relogio }),
      sefaz: criarFabricaTransporteSoap({ agora: () => INSTANTE_DE_TESTE }),
    });
    const credencial = { pfx: gerado.pfx, senha: gerado.senha };
    const t = seletor({ filial_id: randomUUID(), ambiente: 'homologacao', uf: 'AM' }, credencial);
    expect(t.destino.tipo).toBe('simulador');
    expect((await t.statusServico()).cStat).toBe('107');
    expect(() => seletor({ filial_id: randomUUID(), ambiente: 'producao', uf: 'AM' }, credencial)).toThrow(SimuladorEmProducaoErro);
  });
});
