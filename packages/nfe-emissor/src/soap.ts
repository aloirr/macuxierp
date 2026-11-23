/**
 * SOAP 1.2 com mTLS (`node:https`) para os web services da NF-e 4.00: envelope, `Content-Type` com a action e o POST.
 * Nada aqui escolhe URL: ela vem do destino do `escolherDestinoSefaz` (`destino.urls[servico]`), com a trava
 * homologação × produção do `@macuxierp/nfe-sefaz`. Falha de conversa é `FalhaTransporteSefaz` (com `retentavel`);
 * a mensagem leva só o código do erro, nunca o XML, a credencial ou o nome do titular.
 */
import { request } from 'node:https';
import type { Agent } from 'node:https';
import { FalhaTransporteSefaz, TAMANHO_MAXIMO_XML_SEFAZ, type ServicoSefaz } from '@macuxierp/nfe-sefaz';
import type { CertificadoA1EmMemoria } from './certificado';

const NS_SOAP12 = 'http://www.w3.org/2003/05/soap-envelope';
const NS_WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl';

/**
 * WSDL e operação de cada serviço (mapa do sped-nfe, `wsnfe_4.00_mod55.xml`, opção MIT; "a conferir" nos WSDL
 * oficiais na T-0046). As URLs ficam só em `ENDERECOS_SEFAZ` do nfe-sefaz.
 */
export const OPERACAO_SOAP: Readonly<Record<ServicoSefaz, { wsdl: string; operacao: string }>> = Object.freeze({
  autorizacao: { wsdl: 'NFeAutorizacao4', operacao: 'nfeAutorizacaoLote' },
  retAutorizacao: { wsdl: 'NFeRetAutorizacao4', operacao: 'nfeRetAutorizacaoLote' },
  consultaProtocolo: { wsdl: 'NFeConsultaProtocolo4', operacao: 'nfeConsultaNF' },
  statusServico: { wsdl: 'NFeStatusServico4', operacao: 'nfeStatusServicoNF' },
  recepcaoEvento: { wsdl: 'NFeRecepcaoEvento4', operacao: 'nfeRecepcaoEvento' },
  inutilizacao: { wsdl: 'NFeInutilizacao4', operacao: 'nfeInutilizacaoNF' },
});

/**
 * A recepção da EPEC no Ambiente Nacional: WSDL `RecepcaoEvento`, operação `nfeRecepcaoEvento` (ADR 0011). A URL fica
 * só em `ENDERECOS_EPEC` do nfe-sefaz.
 */
export const OPERACAO_SOAP_EPEC = Object.freeze({ wsdl: 'RecepcaoEvento', operacao: 'nfeRecepcaoEvento' });

/** Serviço da conversa SOAP: os da porta `SefazTransporte` e a recepção da EPEC. */
export type ServicoSoap = ServicoSefaz | 'recepcaoEpec';

const operacao = (servico: ServicoSoap) => (servico === 'recepcaoEpec' ? OPERACAO_SOAP_EPEC : OPERACAO_SOAP[servico]);

/** Envelope SOAP 1.2 com o `nfeDadosMsg` do serviço. `corpo` é XML já pronto (assinado, se for o caso). */
export function montarEnvelope(servico: ServicoSoap, corpo: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="${NS_SOAP12}">` +
    `<soap12:Body><nfeDadosMsg xmlns="${NS_WSDL}/${operacao(servico).wsdl}">${corpo}</nfeDadosMsg></soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/** `Content-Type` do SOAP 1.2 com a action do serviço. */
export function tipoConteudo(servico: ServicoSoap): string {
  const s = operacao(servico);
  return `application/soap+xml; charset=utf-8; action="${NS_WSDL}/${s.wsdl}/${s.operacao}"`;
}

export interface ConexaoSoap {
  a1: CertificadoA1EmMemoria;
  /** Cadeia confiável do servidor (ICP-Brasil na SEFAZ; a AC do servidor local nos testes). Sem ela, a do sistema. */
  ca?: string | readonly string[];
  /** Tempo máximo SEM atividade no socket (padrão 30 s). */
  tempoLimiteMs?: number;
  /** Prazo TOTAL da conversa, da conexão ao fim da resposta (padrão 60 s): pega o servidor que responde devagar. */
  prazoTotalMs?: number;
  /** Agente HTTPS (pool de conexões). Os testes o usam para levar a conexão a um servidor local sem trocar a URL. */
  agente?: Agent;
}

/**
 * Teto da resposta, em bytes: 2 × `TAMANHO_MAXIMO_XML_SEFAZ`. O retorno lido tem de caber no `XmlTexto` do contrato
 * (500 mil caracteres); em UTF-8 um caractere acentuado ocupa 2 bytes e o envelope SOAP soma pouco. Acima disso a
 * resposta não seria aceita de todo jeito, e a leitura para antes de encher a memória.
 */
export const TAMANHO_MAXIMO_RESPOSTA_SOAP = 2 * TAMANHO_MAXIMO_XML_SEFAZ;

/** POST SOAP 1.2 com certificado de cliente. `rejectUnauthorized` é sempre true. Devolve o corpo da resposta. */
export function postarSoap(c: ConexaoSoap, servico: ServicoSoap, url: string, envelope: string): Promise<string> {
  const alvo = new URL(url);
  if (alvo.protocol !== 'https:') return Promise.reject(new FalhaTransporteSefaz(servico, false, 'REDE: só https'));
  const corpo = Buffer.from(envelope, 'utf8');
  return new Promise((resolve, reject) => {
    // `prazo` é criado logo depois do pedido; `terminar` só roda em callback assíncrono.
    const terminar = (e: Error | null, texto?: string) => {
      clearTimeout(prazo);
      if (e) reject(e);
      else resolve(texto ?? '');
    };
    const req = request(
      alvo,
      {
        method: 'POST',
        key: c.a1.chavePrivadaPem,
        cert: [c.a1.certificadoPem, ...c.a1.cadeiaPem].join('\n'),
        ...(c.ca ? { ca: typeof c.ca === 'string' ? c.ca : [...c.ca] } : {}),
        ...(c.agente ? { agent: c.agente } : {}),
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        headers: { 'Content-Type': tipoConteudo(servico), 'Content-Length': corpo.length },
        timeout: c.tempoLimiteMs ?? 30_000,
      },
      (res) => {
        const grandeDemais = () => {
          const e = new FalhaTransporteSefaz(servico, false, 'RESPOSTA_GRANDE_DEMAIS');
          req.destroy(e);
          terminar(e);
        };
        const declarado = Number(res.headers['content-length']);
        if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO_RESPOSTA_SOAP) return grandeDemais();
        const partes: Buffer[] = [];
        let bytes = 0;
        res.on('data', (p: Buffer) => {
          bytes += p.length;
          if (bytes > TAMANHO_MAXIMO_RESPOSTA_SOAP) return grandeDemais();
          partes.push(p);
        });
        res.on('error', () => terminar(new FalhaTransporteSefaz(servico, true, 'REDE: resposta interrompida')));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 500) terminar(new FalhaTransporteSefaz(servico, true, `HTTP ${status}`));
          else if (status !== 200) terminar(new FalhaTransporteSefaz(servico, false, `HTTP ${status}`));
          else terminar(null, Buffer.concat(partes).toString('utf8'));
        });
      },
    );
    const esgotado = () => {
      const e = new FalhaTransporteSefaz(servico, true, 'TEMPO_ESGOTADO');
      req.destroy(e);
      terminar(e);
    };
    const prazo = setTimeout(esgotado, c.prazoTotalMs ?? 60_000);
    req.on('timeout', esgotado);
    req.on('error', (e: Error & { code?: string }) => {
      if (e instanceof FalhaTransporteSefaz) return terminar(e);
      const tls = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO/.test(e.code ?? '') || /certificate|handshake|alert/i.test(e.message);
      // Só o código do erro: a mensagem do OpenSSL pode citar o nome do titular do certificado.
      terminar(new FalhaTransporteSefaz(servico, !tls, `${tls ? 'TLS' : 'REDE'}: ${e.code ?? 'erro de conexão'}`));
    });
    req.end(corpo);
  });
}
