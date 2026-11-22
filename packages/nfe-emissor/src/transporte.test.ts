/**
 * Transporte SOAP 1.2 com mTLS (a fábrica `sefaz` do seletor) contra um servidor HTTPS local que exige certificado de
 * cliente e repassa cada pedido ao SIMULADOR da T-0045. O destino é o do `escolherDestinoSefaz` com
 * `transporte: 'sefaz'` (as URLs reais de homologação do AM, "a conferir"): só o agente HTTPS leva a conexão para
 * 127.0.0.1, sem trocar a URL. Cada resposta lida do SOAP tem de ser IGUAL ao objeto que o simulador devolveu.
 */
import { randomUUID } from 'node:crypto';
import { Agent, createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { connect, type TLSSocket } from 'node:tls';
import {
  ErroSefaz,
  NS_NFE,
  TAMANHO_MAXIMO_XML_SEFAZ,
  criarSeletorTransporte,
  escolherDestinoSefaz,
  garantirDestinoSimulador,
  montarChaveNFe,
  type DestinoSefazReal,
  type FilialEmissoraSefaz,
  type SefazTransporte,
} from '@macuxierp/nfe-sefaz';
import { INSTANTE_DE_TESTE } from '@macuxierp/nfe-sefaz/teste';
import { criarSimuladorSefaz, type SimuladorSefaz } from '@macuxierp/sefaz-simulador';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assinarDocumento } from './assinatura';
import { criarEmissorNFe } from './emissor';
import { montarCancelamento, montarInutilizacao } from './eventos';
import { OPERACAO_SOAP, TAMANHO_MAXIMO_RESPOSTA_SOAP, tipoConteudo } from './soap';
import { a1DeTesteAberto } from './testes/a1';
import { vendaSimplesAm } from './testes/notas';
import { gerarServidorTlsDeTeste } from './testes/servidor-tls-de-teste';
import { criarFabricaTransporteSoap, criarTransporteSoap } from './transporte';

const FILIAL: FilialEmissoraSefaz = { filial_id: randomUUID(), ambiente: 'homologacao', uf: 'AM' };
const destinoReal = escolherDestinoSefaz(FILIAL, { transporte: 'sefaz' }) as DestinoSefazReal;
const destinoSim = escolherDestinoSefaz(FILIAL, { transporte: 'simulador' });
const HOST = new URL(destinoReal.urls.autorizacao!).hostname;

const emissor = criarEmissorNFe();
const { gerado, a1 } = a1DeTesteAberto();
/** Chave válida sem nota no simulador (o pedido nunca sai nos testes que a usam). */
const CHAVE_SEM_NOTA = montarChaveNFe({ cUF: 13, aamm: '2611', cnpj: gerado.cnpj, mod: '55', serie: 1, nNF: 999, tpEmis: 1, cNF: '11111119' });
const estranho = a1DeTesteAberto({ cnpj: '11444777000161' });
const servidorTls = gerarServidorTlsDeTeste(HOST);
let relogio = new Date(INSTANTE_DE_TESTE.getTime() + 1_000);
const sim: SimuladorSefaz = criarSimuladorSefaz(garantirDestinoSimulador(destinoSim), { agora: () => relogio });

/** O que o servidor recebeu e o que o simulador respondeu na última chamada. */
const ultimo: { tipo?: string; corpo?: string; clienteAutorizado?: boolean; resposta?: unknown } = {};
/** Como o servidor local responde: normal, HTTP 500, grande demais (com ou sem Content-Length) ou devagar. */
let modo: 'normal' | '500' | 'grande' | 'grande-em-partes' | 'devagar' = 'normal';
let servidor: Server;
let agente: Agent;

const trecho = (xml: string, nome: string) => new RegExp(`<${nome}[\\s>][\\s\\S]*</${nome}>`).exec(xml)?.[0] ?? '';
const valor = (xml: string, nome: string) => new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(xml)?.[1] ?? '';

/** O "autorizador" local: tira o `nfeDadosMsg` e chama a operação do simulador pelo caminho da URL. */
async function responder(caminho: string, corpo: string): Promise<{ wsdl: string; resposta: { xml: string } }> {
  const servico = (Object.keys(OPERACAO_SOAP) as Array<keyof typeof OPERACAO_SOAP>).find((s) => destinoReal.urls[s] && new URL(destinoReal.urls[s]!).pathname === caminho);
  if (!servico) throw new Error(`caminho desconhecido: ${caminho}`);
  const dados = /<nfeDadosMsg[^>]*>([\s\S]*)<\/nfeDadosMsg>/.exec(corpo)?.[1] ?? '';
  const r = await (async () => {
    switch (servico) {
      case 'autorizacao':
        return sim.autorizar({ idLote: valor(dados, 'idLote'), sincrono: valor(dados, 'indSinc') === '1', nfes: dados.match(/<NFe[\s>][\s\S]*?<\/NFe>/g) ?? [] });
      case 'retAutorizacao':
        return sim.consultarRecibo({ nRec: valor(dados, 'nRec') });
      case 'consultaProtocolo':
        return sim.consultarProtocolo({ chNFe: valor(dados, 'chNFe') });
      case 'statusServico':
        return sim.statusServico();
      case 'recepcaoEvento': {
        const p = { idLote: valor(dados, 'idLote'), eventoAssinado: trecho(dados, 'evento') };
        return valor(dados, 'tpEvento') === '110111' ? sim.cancelar(p) : sim.cartaCorrecao(p);
      }
      case 'inutilizacao':
        return sim.inutilizar({ inutilizacaoAssinada: dados });
    }
  })();
  return { wsdl: OPERACAO_SOAP[servico].wsdl, resposta: r };
}

beforeAll(async () => {
  servidor = createServer(
    { key: servidorTls.chavePem, cert: servidorTls.certificadoPem, ca: [gerado.certificadoPem], requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (c: Buffer) => partes.push(c));
      req.on('end', () => {
        const corpo = Buffer.concat(partes).toString('utf8');
        Object.assign(ultimo, { tipo: req.headers['content-type'], corpo, clienteAutorizado: (req.socket as TLSSocket).authorized });
        if (modo === '500') {
          res.statusCode = 500;
          return res.end('erro');
        }
        if (modo === 'grande') return res.end(Buffer.alloc(TAMANHO_MAXIMO_RESPOSTA_SOAP + 1, 0x20));
        if (modo === 'grande-em-partes' || modo === 'devagar') {
          // Sem Content-Length (chunked): 64 KB de uma vez até passar do teto, ou 1 byte a cada 20 ms, sem fim.
          const parte = modo === 'devagar' ? Buffer.from(' ') : Buffer.alloc(65_536, 0x20);
          const envio = setInterval(() => res.write(parte), modo === 'devagar' ? 20 : 1);
          res.on('close', () => clearInterval(envio));
          return;
        }
        responder(new URL(req.url ?? '/', 'https://x').pathname, corpo).then(
          ({ wsdl, resposta }) => {
            ultimo.resposta = resposta;
            res.setHeader('Content-Type', 'application/soap+xml; charset=utf-8');
            res.end(
              `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
                `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}">${resposta.xml}</nfeResultMsg></soap:Body></soap:Envelope>`,
            );
          },
          () => {
            res.statusCode = 400;
            res.end();
          },
        );
      });
    },
  );
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = (servidor.address() as AddressInfo).port;
  // Só a conexão vai para o servidor local; a URL, o SNI e a conferência do certificado continuam os do destino.
  agente = new Agent({ keepAlive: false });
  (agente as unknown as { createConnection: (o: object) => TLSSocket }).createConnection = (o) => connect({ ...o, host: '127.0.0.1', port: porta, servername: HOST });
});

afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

const transporte = (o: { a1?: typeof a1; ca?: string | null; prazoTotalMs?: number } = {}): SefazTransporte =>
  criarTransporteSoap(destinoReal, o.a1 ?? a1, {
    agente,
    ...(o.ca === null ? {} : { ca: o.ca ?? servidorTls.certificadoPem }),
    ...(o.prazoTotalMs ? { prazoTotalMs: o.prazoTotalMs } : {}),
  });

/** Roda `f` com o servidor no `m` e volta ao normal. */
async function comModo<T>(m: typeof modo, f: () => Promise<T>): Promise<T> {
  modo = m;
  try {
    return await f();
  } finally {
    modo = 'normal';
  }
}

describe('transporte SOAP com mTLS: implementa SefazTransporte contra o simulador', () => {
  it('a fábrica sefaz do seletor abre o A1 da credencial e o destino é o do escolherDestinoSefaz', async () => {
    const seletor = criarSeletorTransporte({ transporte: 'sefaz', sefaz: criarFabricaTransporteSoap({ agente, ca: servidorTls.certificadoPem, agora: () => INSTANTE_DE_TESTE }) });
    const t = seletor(FILIAL, { pfx: gerado.pfx, senha: gerado.senha });
    expect(t.destino).toMatchObject({ tipo: 'sefaz', ambiente: 'homologacao', tpAmb: 2, autorizador: 'AM' });
    const r = await t.statusServico();
    expect(r).toEqual(ultimo.resposta);
    expect(r.cStat).toBe('107');
    expect(ultimo).toMatchObject({ clienteAutorizado: true, tipo: tipoConteudo('statusServico') });
    expect(ultimo.corpo).toContain(`<consStatServ xmlns="${NS_NFE}" versao="4.00"><tpAmb>2</tpAmb><cUF>13</cUF><xServ>STATUS</xServ></consStatServ>`);
  });

  it('autorização síncrona, consulta de protocolo, cancelamento e inutilização: o retorno lido do SOAP é o do simulador', async () => {
    const t = transporte();
    const montada = emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF: 31 } });
    const assinada = emissor.assinar(montada.xml, a1);
    const r = await emissor.transmitir(assinada.xml, '31', t);
    expect(r).toEqual(ultimo.resposta);
    expect(r.protocolos[0]).toMatchObject({ chNFe: montada.chave, cStat: '100', digVal: assinada.digVal });
    expect(ultimo.corpo).toContain(assinada.xml); // os bytes assinados chegam intactos no lote

    const c = await t.consultarProtocolo({ chNFe: montada.chave });
    expect(c).toEqual(ultimo.resposta);

    relogio = new Date(relogio.getTime() + 60_000);
    const evento = montarCancelamento({ chNFe: montada.chave, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, nProt: r.protocolos[0]!.nProt!, xJust: 'Cancelamento de teste pelo SOAP' });
    const ev = await t.cancelar({ idLote: '32', eventoAssinado: assinarDocumento(evento, a1, 'infEvento').xml });
    expect(ev).toEqual(ultimo.resposta);
    expect(ev.eventos[0]?.cStat).toBe('135');
    const comEventos = await t.consultarProtocolo({ chNFe: montada.chave });
    expect(comEventos).toEqual(ultimo.resposta);
    expect(comEventos.eventos).toHaveLength(1);

    const inut = montarInutilizacao({ cUF: 13, tpAmb: 2, ano: '26', cnpj: gerado.cnpj, serie: 1, nNFIni: 40, nNFFin: 40, xJust: 'Numero pulado no teste do SOAP' });
    const i = await t.inutilizar({ inutilizacaoAssinada: assinarDocumento(inut, a1, 'infInut').xml });
    expect(i).toEqual(ultimo.resposta);
    expect(i.cStat).toBe('102');
  });

  it('assíncrona: recibo e consulta do recibo pelo SOAP', async () => {
    const t = transporte();
    const assinada = emissor.assinar(emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, nNF: 33 } }).xml, a1);
    const r = await t.autorizar({ idLote: '33', sincrono: false, nfes: [assinada.xml] });
    expect(r).toEqual(ultimo.resposta);
    relogio = new Date(relogio.getTime() + 5_000);
    const c = await t.consultarRecibo({ nRec: r.recibo!.nRec });
    expect(c).toEqual(ultimo.resposta);
    expect(c.protocolos[0]?.cStat).toBe('100');
  });

  it('pedido fora do contrato e evento na operação errada: SEFAZ_PEDIDO_INVALIDO e nada sai', async () => {
    const antes = ultimo.corpo;
    await expect(transporte().autorizar({ idLote: 'x', sincrono: true, nfes: ['<NFe/>'] })).rejects.toMatchObject({ codigo: 'SEFAZ_PEDIDO_INVALIDO' });
    const evento = montarCancelamento({ chNFe: CHAVE_SEM_NOTA, cnpj: gerado.cnpj, tpAmb: 2, dhEvento: relogio, nProt: '9'.repeat(15), xJust: 'Evento na operacao errada' });
    await expect(transporte().cartaCorrecao({ idLote: '1', eventoAssinado: evento })).rejects.toBeInstanceOf(ErroSefaz);
    expect(ultimo.corpo).toBe(antes);
  });

  it('tpAmb do documento diferente do destino (produção num destino de homologação): SEFAZ_PEDIDO_INVALIDO e nada sai', async () => {
    const antes = ultimo.corpo;
    const invalido = { codigo: 'SEFAZ_PEDIDO_INVALIDO', message: expect.stringContaining('tpAmb 1 difere do destino (2)') };
    const producao = emissor.assinar(emissor.montar({ ...vendaSimplesAm, ide: { ...vendaSimplesAm.ide, tpAmb: 1, nNF: 34 } }).xml, a1);
    await expect(transporte().autorizar({ idLote: '34', sincrono: true, nfes: [producao.xml] })).rejects.toMatchObject(invalido);
    const semTpAmb = producao.xml.replace('<tpAmb>1</tpAmb>', '');
    await expect(transporte().autorizar({ idLote: '34', sincrono: true, nfes: [semTpAmb] })).rejects.toMatchObject({ codigo: 'SEFAZ_PEDIDO_INVALIDO' });
    const cancelamento = montarCancelamento({ chNFe: CHAVE_SEM_NOTA, cnpj: gerado.cnpj, tpAmb: 1, dhEvento: relogio, nProt: '9'.repeat(15), xJust: 'Cancelamento em producao' });
    await expect(transporte().cancelar({ idLote: '35', eventoAssinado: assinarDocumento(cancelamento, a1, 'infEvento').xml })).rejects.toMatchObject(invalido);
    const inut = montarInutilizacao({ cUF: 13, tpAmb: 1, ano: '26', cnpj: gerado.cnpj, serie: 1, nNFIni: 41, nNFFin: 41, xJust: 'Inutilizacao em producao' });
    await expect(transporte().inutilizar({ inutilizacaoAssinada: assinarDocumento(inut, a1, 'infInut').xml })).rejects.toMatchObject(invalido);
    expect(ultimo.corpo).toBe(antes);
  });
});

describe('transporte SOAP: falhas de conversa', () => {
  it('servidor sem a cadeia confiável: TLS, não retentável', async () => {
    await expect(transporte({ ca: null }).statusServico()).rejects.toMatchObject({ name: 'FalhaTransporteSefaz', retentavel: false, message: expect.stringMatching(/TLS/) });
  });

  it('cliente com certificado que o servidor não aceita: a conexão cai como falha de transporte', async () => {
    await expect(transporte({ a1: estranho.a1 }).statusServico()).rejects.toMatchObject({ name: 'FalhaTransporteSefaz' });
  });

  it('HTTP 500 é retentável', async () => {
    await comModo('500', () => expect(transporte().statusServico()).rejects.toMatchObject({ name: 'FalhaTransporteSefaz', retentavel: true }));
  });

  it('resposta acima do teto: RESPOSTA_GRANDE_DEMAIS, não retentável, pelo Content-Length ou contando os bytes', async () => {
    const esperado = { name: 'FalhaTransporteSefaz', retentavel: false, message: 'statusServico: RESPOSTA_GRANDE_DEMAIS' };
    expect(TAMANHO_MAXIMO_RESPOSTA_SOAP).toBe(2 * TAMANHO_MAXIMO_XML_SEFAZ);
    await comModo('grande', () => expect(transporte().statusServico()).rejects.toMatchObject(esperado));
    await comModo('grande-em-partes', () => expect(transporte().statusServico()).rejects.toMatchObject(esperado));
  });

  it('servidor que manda devagar (nunca fica inativo): o prazo total esgota com TEMPO_ESGOTADO, retentável', async () => {
    const inicio = Date.now();
    await comModo('devagar', () =>
      expect(transporte({ prazoTotalMs: 300 }).statusServico()).rejects.toMatchObject({ name: 'FalhaTransporteSefaz', retentavel: true, message: 'statusServico: TEMPO_ESGOTADO' }),
    );
    expect(Date.now() - inicio).toBeLessThan(5_000);
  });

  it('SVC-RS não oferece inutilização: falha não retentável, sem conexão', async () => {
    const svc = escolherDestinoSefaz({ ...FILIAL, modo: 'svc-rs' }, { transporte: 'sefaz' }) as DestinoSefazReal;
    await expect(criarTransporteSoap(svc, a1).inutilizar({ inutilizacaoAssinada: '<inutNFe/>' })).rejects.toMatchObject({ name: 'FalhaTransporteSefaz', retentavel: false });
  });

  it('produção continua bloqueada no destino (endereços "a conferir"): nem chega ao transporte', () => {
    const seletor = criarSeletorTransporte({ transporte: 'sefaz', sefaz: criarFabricaTransporteSoap() });
    expect(() => seletor({ ...FILIAL, ambiente: 'producao' }, { pfx: gerado.pfx, senha: gerado.senha })).toThrow(expect.objectContaining({ codigo: 'SEFAZ_ENDERECO_NAO_CONFERIDO' }));
  });
});
