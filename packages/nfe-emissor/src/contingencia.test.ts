/**
 * Contingência da NF-e no emissor (T-0021, ADR 0011; RN-FAT-05, 08 e 09): `tpEmis` 1/4/6/7 com `dhCont` e `xJust` no
 * `ide`, chave com o `tpEmis`, o evento EPEC (110140) montado da própria NF-e e o transporte da EPEC (SOAP com mTLS ao
 * "Ambiente Nacional" local, que repassa ao simulador). Tudo com A1 gerado em tempo de execução, sem rede real.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Agent, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  ENDERECOS_EPEC,
  ErroSefaz,
  RespostaEvento,
  criarSeletorEpec,
  dadosEpecDaNFe,
  dadosEpecDoEvento,
  divergenciasEpec,
  escolherDestinoEpec,
  escolherDestinoSefaz,
  lerChaveNFe,
  montarEnvEvento,
  validarXsd,
  type DestinoSefazReal,
} from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { criarSimuladorSefaz, type SimuladorSefaz } from '@macuxierp/sefaz-simulador';
import { destinoDe } from '@macuxierp/sefaz-simulador/teste';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assinarDocumento } from './assinatura';
import { criarEmissorNFe } from './emissor';
import type { NotaParaEmissaoEntrada } from './entrada';
import { montarCancelamento, montarEpec } from './eventos';
import { ErroMontagemNFe } from './montar';
import { tipoConteudo } from './soap';
import { a1DeTesteAberto } from './testes/a1';
import { vendaSimplesAm } from './testes/notas';
import { agenteParaLocal, gerarServidorTlsDeTeste } from './testes/servidor-tls-de-teste';
import { criarFabricaTransporteEpecSoap, criarTransporteEpecSoap, criarTransporteSoap } from './transporte';

const emissor = criarEmissorNFe();
const { gerado, a1 } = a1DeTesteAberto();
/** Entrou em contingência 10 minutos antes da emissão (INSTANTE_DE_TESTE = 21/11/2026 22h59 em Manaus). */
const DH_CONT = new Date(INSTANTE_DE_TESTE.getTime() - 10 * 60_000).toISOString();
const XJUST = 'SEFAZ-AM fora do ar, status 108 (teste)';

function emContingencia(tpEmis: 4 | 6 | 7, nNF: number, extra: Partial<NotaParaEmissaoEntrada['ide']> = {}): NotaParaEmissaoEntrada {
  return { ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF, tpEmis, dhCont: DH_CONT, xJust: XJUST, ...extra } };
}

function ocorrencias(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroMontagemNFe) return e.ocorrencias;
    throw e;
  }
  return [];
}

const tag = (xml: string, nome: string) => new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(xml)?.[1];

describe('NF-e em contingência: tpEmis, dhCont e xJust (Manual 4.00; RN-FAT-08)', () => {
  it('SVC-RS (7): ide na ordem do schema, dhCont com o fuso da filial, chave com o 7, assinada passa no XSD', async () => {
    const m = emissor.montar(emContingencia(7, 50));
    const ide = /<ide>[\s\S]*?<\/ide>/.exec(m.xml)![0];
    expect([...ide.matchAll(/<(\w+)>/g)].map((x) => x[1]).slice(-5)).toEqual(['indPres', 'procEmi', 'verProc', 'dhCont', 'xJust']);
    expect(tag(ide, 'tpEmis')).toBe('7');
    expect(tag(ide, 'dhCont')).toBe('2026-11-21T22:49:00-04:00');
    expect(tag(ide, 'xJust')).toBe(XJUST);
    expect(lerChaveNFe(m.chave)?.tpEmis).toBe(7);
    expect((await validarXsd(emissor.assinar(m.xml, a1).xml, 'nfe')).erros).toEqual([]);
  });

  it('EPEC (4): chave com o 4; normal (1) segue sem dhCont e xJust', () => {
    expect(lerChaveNFe(emissor.montar(emContingencia(4, 51)).chave)?.tpEmis).toBe(4);
    const normal = emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF: 52 } });
    expect(normal.xml).not.toMatch(/<dhCont>|<xJust>/);
    expect(lerChaveNFe(normal.chave)?.tpEmis).toBe(1);
  });

  it('contingência sem dhCont/xJust, normal com eles, xJust fora de 15 a 256, dhCont depois da emissão: recusados', () => {
    const semJust = { ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, tpEmis: 7 as const } };
    expect(ocorrencias(() => emissor.montar(semJust))).toEqual([
      'ide.dhCont: RN-FAT-08: tpEmis 7 exige dhCont',
      'ide.xJust: RN-FAT-08: tpEmis 7 exige xJust',
    ]);
    const normalComJust = { ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, dhCont: DH_CONT, xJust: XJUST } };
    expect(ocorrencias(() => emissor.montar(normalComJust))).toEqual([
      'ide.dhCont: dhCont só vai em nota de contingência (tpEmis ≠ 1)',
      'ide.xJust: xJust só vai em nota de contingência (tpEmis ≠ 1)',
    ]);
    expect(ocorrencias(() => emissor.montar(emContingencia(7, 53, { xJust: 'curta demais' })))).toEqual([
      'ide.xJust: String must contain at least 15 character(s)',
    ]);
    expect(ocorrencias(() => emissor.montar(emContingencia(7, 53, { xJust: 'x'.repeat(257) })))).toEqual([
      'ide.xJust: String must contain at most 256 character(s)',
    ]);
    expect(emissor.montar(emContingencia(7, 53, { xJust: 'x'.repeat(256) })).xml).toContain(`<xJust>${'x'.repeat(256)}</xJust>`);
    const depois = new Date(INSTANTE_DE_TESTE.getTime() + 60_000).toISOString();
    expect(ocorrencias(() => emissor.montar(emContingencia(7, 53, { dhCont: depois })))).toEqual([
      'ide.dhCont: entrada em contingência depois da emissão',
    ]);
  });

  it('SVC-AN (6) não é a SVC do AM; FS-DA (5) fora da v1 (a lista toda do TpEmis está no teste do nfe-sefaz)', () => {
    expect(ocorrencias(() => emissor.montar(emContingencia(6, 54)))).toEqual(['ide.tpEmis: tpEmis 6 não é a SVC da UF do emitente']);
    const fora = { ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, tpEmis: 5, dhCont: DH_CONT, xJust: XJUST } } as unknown as NotaParaEmissaoEntrada;
    expect(ocorrencias(() => emissor.montar(fora)).some((o) => o.startsWith('ide.tpEmis'))).toBe(true);
  });
});

describe('evento EPEC (110140) montado da NF-e', () => {
  const nfe = emissor.montar(emContingencia(4, 60));

  it('cabeçalho do Ambiente Nacional (cOrgao 91), detEvento do leiaute e o mesmo resumo da NF-e; assinado passa no XSD', async () => {
    const xml = montarEpec({ nfe: nfe.xml, dhEvento: INSTANTE_DE_TESTE, fusoMinutos: -240 });
    expect(xml).toContain(`<infEvento Id="ID110140${nfe.chave}01"><cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>${gerado.cnpj}</CNPJ>`);
    expect(xml).toContain('<detEvento versao="1.00"><descEvento>EPEC</descEvento><cOrgaoAutor>13</cOrgaoAutor><tpAutor>1</tpAutor>');
    expect(divergenciasEpec(dadosEpecDaNFe(nfe.xml)!, dadosEpecDoEvento(xml)!)).toEqual([]);
    const assinado = assinarDocumento(xml, a1, 'infEvento').xml;
    expect((await validarXsd(montarEnvEvento('1', assinado), 'envEPEC')).erros).toEqual([]);
  });

  it('NF-e que não é EPEC ou ilegível: ErroMontagemNFe, sem o conteúdo da nota', () => {
    const normal = emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF: 61 } });
    expect(ocorrencias(() => montarEpec({ nfe: normal.xml, dhEvento: INSTANTE_DE_TESTE, fusoMinutos: -240 }))).toEqual([
      'nfe.ide.tpEmis: a EPEC exige tpEmis 4',
      'nfe.infNFe.Id: a chave não tem o tpEmis 4',
    ]);
    expect(ocorrencias(() => montarEpec({ nfe: '<NFe/>', dhEvento: INSTANTE_DE_TESTE, fusoMinutos: -240 }))).toEqual([
      'nfe: NF-e ilegível ou sem dest/total',
    ]);
    expect(ocorrencias(() => montarEpec({ nfe: '', dhEvento: INSTANTE_DE_TESTE, fusoMinutos: -240 }))[0]).toMatch(/^nfe:/);
  });
});

describe('ponta a ponta no simulador: EPEC e volta à normal; SVC-RS', () => {
  let relogio = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);
  const filial = randomUUID();

  // Paralisação da UF e consulta com a EPEC vinculada: suíte do simulador. Aqui, só o contrato do emissor.
  it('o evento do montarEpec dá 136; a mesma nota EPEC, transmitida na volta, dá 100', async () => {
    const sim = criarSimuladorSefaz(destinoDe('normal', filial), { agora: () => relogio });
    const montada = emissor.montar(emContingencia(4, 70));
    const r = await emissor.epec({ nfe: montada.xml, dhEvento: relogio, fusoMinutos: -240, idLote: '70' }, a1, sim);
    expect(RespostaEvento.parse(r)).toMatchObject({ cStat: '128', cOrgao: 91 });
    expect(r.eventos[0]).toMatchObject({ cStat: '136', tpEvento: '110140', chNFe: montada.chave });
    expect(r.assinado.xml).toContain('<Signature');
    relogio = new Date(relogio.getTime() + 60_000);
    const assinada = emissor.assinar(montada.xml, a1);
    const p = (await emissor.transmitir(assinada.xml, '71', sim)).protocolos[0]!;
    expect(p).toMatchObject({ cStat: '100', chNFe: montada.chave });
  });

  it('SVC-RS: a nota com tpEmis 7 sai autorizada no destino da SVC (montado à mão: o seletor recusa, RN-FAT-10)', async () => {
    const sim = criarSimuladorSefaz(destinoDe('svc-rs', filial), { agora: () => relogio });
    const assinada = emissor.assinar(emissor.montar(emContingencia(7, 72)).xml, a1);
    expect((await emissor.transmitir(assinada.xml, '72', sim)).protocolos[0]).toMatchObject({ cStat: '100' });
  });
});

describe('transporte SOAP: tpEmis do destino e a EPEC no Ambiente Nacional (mTLS local)', () => {
  const FILIAL = { filial_id: randomUUID(), ambiente: 'homologacao', uf: 'AM' } as const;
  const destinoEpec = escolherDestinoEpec(FILIAL, { transporte: 'sefaz' });
  const HOST = new URL(destinoEpec.url).hostname;
  const tls = gerarServidorTlsDeTeste(HOST);
  const relogio = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);
  const sim: SimuladorSefaz = criarSimuladorSefaz(destinoDe('normal', FILIAL.filial_id), { agora: () => relogio });
  const ultimo: { tipo?: string; caminho?: string; resposta?: unknown } = {};
  let servidor: Server;
  let agente: Agent;

  beforeAll(async () => {
    servidor = createServer({ key: tls.chavePem, cert: tls.certificadoPem, ca: [gerado.certificadoPem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (c: Buffer) => partes.push(c));
      req.on('end', () => {
        const corpo = Buffer.concat(partes).toString('utf8');
        Object.assign(ultimo, { tipo: req.headers['content-type'], caminho: req.url });
        const dados = /<nfeDadosMsg[^>]*>([\s\S]*)<\/nfeDadosMsg>/.exec(corpo)?.[1] ?? '';
        const idLote = /<idLote>(\d+)<\/idLote>/.exec(dados)?.[1] ?? '';
        const evento = /<evento[\s>][\s\S]*<\/evento>/.exec(dados)?.[0] ?? '';
        sim.epec({ idLote, eventoAssinado: evento }).then(
          (r) => {
            ultimo.resposta = r;
            res.setHeader('Content-Type', 'application/soap+xml; charset=utf-8');
            res.end(
              `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
                `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/RecepcaoEvento">${r.xml}</nfeResultMsg></soap:Body></soap:Envelope>`,
            );
          },
          () => {
            res.statusCode = 400;
            res.end();
          },
        );
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const porta = (servidor.address() as AddressInfo).port;
    agente = agenteParaLocal(porta, HOST);
  });

  afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

  it('o seletor da EPEC com a fábrica SOAP: o retorno lido é o do simulador, na URL e na action da EPEC', async () => {
    const seletor = criarSeletorEpec({ transporte: 'sefaz', sefaz: criarFabricaTransporteEpecSoap({ agente, ca: tls.certificadoPem, agora: () => INSTANTE_DE_TESTE }) });
    const t = seletor(FILIAL, { pfx: gerado.pfx, senha: gerado.senha });
    expect(t.destino).toMatchObject({ tipo: 'epec', cOrgao: 91, url: ENDERECOS_EPEC.homologacao.url });
    const montada = emissor.montar(emContingencia(4, 80));
    const r = await emissor.epec({ nfe: montada.xml, dhEvento: relogio, fusoMinutos: -240, idLote: '80' }, a1, t);
    const { assinado: _assinado, ...resposta } = r;
    expect(resposta).toEqual(ultimo.resposta);
    expect(r.eventos[0]).toMatchObject({ cStat: '136', chNFe: montada.chave });
    expect(ultimo).toMatchObject({ tipo: tipoConteudo('recepcaoEpec'), caminho: new URL(destinoEpec.url).pathname });
  });

  it('travas antes de sair: outro tpEvento, tpAmb de produção, cOrgao que não é 91, destino que não é da EPEC', async () => {
    const t = criarTransporteEpecSoap(destinoEpec, a1, { agente, ca: tls.certificadoPem });
    const montada = emissor.montar(emContingencia(4, 81));
    const epec = (ajuste: (x: string) => string) =>
      assinarDocumento(ajuste(montarEpec({ nfe: montada.xml, dhEvento: relogio, fusoMinutos: -240 })), a1, 'infEvento').xml;
    const cancelamento = montarCancelamento({ chNFe: montada.chave, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, fusoMinutos: -240, nProt: '913260000000001', xJust: 'Cancelamento de teste na EPEC' });
    for (const eventoAssinado of [
      assinarDocumento(cancelamento, a1, 'infEvento').xml,
      epec((x) => x.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')),
      epec((x) => x.replace('<cOrgao>91</cOrgao>', '<cOrgao>13</cOrgao>')),
    ]) {
      await expect(t.epec({ idLote: '1', eventoAssinado })).rejects.toMatchObject({ codigo: 'SEFAZ_PEDIDO_INVALIDO' });
    }
    const real = escolherDestinoSefaz(FILIAL, { transporte: 'sefaz' });
    expect(() => criarTransporteEpecSoap(real as never, a1)).toThrow(ErroSefaz);
  });

  it('autorização: nota de SVC no autorizador normal (ou normal na SVC) não sai; a nota EPEC (4) passa a trava do normal', async () => {
    const normal = escolherDestinoSefaz(FILIAL, { transporte: 'sefaz' }) as DestinoSefazReal;
    const svc = escolherDestinoSefaz({ ...FILIAL, modo: 'svc-rs' }, { transporte: 'sefaz' }) as DestinoSefazReal;
    const nota7 = emissor.assinar(emissor.montar(emContingencia(7, 90)).xml, a1).xml;
    const nota1 = emissor.assinar(emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF: 91 } }).xml, a1).xml;
    await expect(criarTransporteSoap(normal, a1).autorizar({ idLote: '1', sincrono: true, nfes: [nota7] })).rejects.toMatchObject({ codigo: 'SEFAZ_CONTINGENCIA_INVALIDA' });
    await expect(criarTransporteSoap(svc, a1).autorizar({ idLote: '1', sincrono: true, nfes: [nota1] })).rejects.toMatchObject({ codigo: 'SEFAZ_CONTINGENCIA_INVALIDA' });
    // A nota EPEC passa a trava e só então tenta a conexão (aqui, a uma porta local fechada: falha de transporte).
    const nota4 = emissor.assinar(emissor.montar(emContingencia(4, 92)).xml, a1).xml;
    await expect(criarTransporteSoap(normal, a1, { agente: agenteParaLocal(9) }).autorizar({ idLote: '1', sincrono: true, nfes: [nota4] })).rejects.toMatchObject({
      name: 'FalhaTransporteSefaz',
    });
  });
});
