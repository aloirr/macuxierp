/**
 * Leitura dos retornos da SEFAZ (dentro do envelope SOAP) para os tipos da porta `SefazTransporte` do
 * `@macuxierp/nfe-sefaz`. Cada resposta é conferida no Zod do contrato: retorno fora dele é `FalhaTransporteSefaz`
 * não retentável (SOAP ilegível), nunca um objeto pela metade.
 * - O `xml` de cada protocolo (`protNFe`, `retEvento`) e o do retorno são os trechos EXATOS que vieram (sem
 *   reserializar): o `protNFe` vai para o `nfeProc` guardado (regra 7).
 * - DOM pelo `lerXml` do nfe-sefaz (recusa `<!DOCTYPE`); valores pelo caminho do leiaute (`textoNfe`).
 */
import type { z } from 'zod';
import {
  FalhaTransporteSefaz,
  NS_NFE,
  type ProtocoloEvento,
  type ProtocoloNFe,
  RespostaAutorizacao,
  RespostaConsultaProtocolo,
  RespostaConsultaRecibo,
  RespostaEvento,
  RespostaInutilizacao,
  RespostaStatusServico,
  filhoNfe,
  lerXml,
  textoNfe as t,
  type ServicoSefaz,
} from '@macuxierp/nfe-sefaz';

const opcional = (s: string): string | null => (s === '' ? null : s);
const numero = (s: string): number | null => (s === '' ? null : Number(s));

/** Trechos `<nome ...>…</nome>` do texto, na ordem do documento (com ou sem prefixo). */
function trechos(xml: string, nome: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${nome}[\\s>][\\s\\S]*?</(?:[\\w.-]+:)?${nome}>`, 'g'))].map((m) => m[0]);
}

function ilegivel(servico: ServicoSefaz, motivo: string): FalhaTransporteSefaz {
  return new FalhaTransporteSefaz(servico, false, `SOAP ilegível: ${motivo}`);
}

/** O retorno `raiz` de dentro do envelope: o trecho exato e o elemento lido. */
function retorno(servico: ServicoSefaz, envelope: string, raiz: string): { xml: string; el: Element } {
  const xml = trechos(envelope, raiz)[0];
  const el = xml ? lerXml(xml)?.documentElement : undefined;
  if (!xml || !el || el.namespaceURI !== NS_NFE || el.localName !== raiz) throw ilegivel(servico, `${raiz} ausente`);
  return { xml, el };
}

/** Confere no Zod do contrato; a mensagem cita só os campos. */
function noContrato<S extends z.ZodTypeAny>(servico: ServicoSefaz, schema: S, valor: unknown): z.output<S> {
  const r = schema.safeParse(valor);
  if (r.success) return r.data as z.output<S>;
  throw ilegivel(servico, `retorno fora do contrato (${[...new Set(r.error.issues.map((i) => i.path.join('.')))].join(', ')})`);
}

const cabecalho = (el: Element | null) => ({
  tpAmb: Number(t(el, 'tpAmb')),
  verAplic: t(el, 'verAplic'),
  cStat: t(el, 'cStat'),
  xMotivo: t(el, 'xMotivo'),
});

/** Os protocolos ainda sem conferência: o Zod da resposta inteira confere cada um. */
function protocolosNFe(ret: { xml: string; el: Element }): Record<keyof ProtocoloNFe, unknown>[] {
  const xmls = trechos(ret.xml, 'protNFe');
  return Array.from(ret.el.getElementsByTagNameNS(NS_NFE, 'protNFe')).map((p, i) => {
    const inf = filhoNfe(p, 'infProt');
    return {
      ...cabecalho(inf),
      chNFe: t(inf, 'chNFe'),
      dhRecbto: t(inf, 'dhRecbto'),
      nProt: opcional(t(inf, 'nProt')),
      digVal: opcional(t(inf, 'digVal')),
      xml: xmls[i] ?? '',
    };
  });
}

function protocolosEvento(ret: { xml: string; el: Element }): Record<keyof ProtocoloEvento, unknown>[] {
  const xmls = trechos(ret.xml, 'retEvento');
  return Array.from(ret.el.getElementsByTagNameNS(NS_NFE, 'retEvento')).map((r, i) => {
    const inf = filhoNfe(r, 'infEvento');
    return {
      ...cabecalho(inf),
      chNFe: t(inf, 'chNFe'),
      tpEvento: t(inf, 'tpEvento'),
      nSeqEvento: Number(t(inf, 'nSeqEvento')),
      dhRegEvento: t(inf, 'dhRegEvento'),
      nProt: opcional(t(inf, 'nProt')),
      xml: xmls[i] ?? '',
    };
  });
}

export function lerRetornoAutorizacao(envelope: string): RespostaAutorizacao {
  const ret = retorno('autorizacao', envelope, 'retEnviNFe');
  const nRec = t(ret.el, 'infRec', 'nRec');
  return noContrato('autorizacao', RespostaAutorizacao, {
    ...cabecalho(ret.el),
    cUF: Number(t(ret.el, 'cUF')),
    dhRecbto: t(ret.el, 'dhRecbto'),
    recibo: nRec ? { nRec, tMed: Number(t(ret.el, 'infRec', 'tMed')) } : null,
    protocolos: protocolosNFe(ret),
    xml: ret.xml,
  });
}

export function lerRetornoConsultaRecibo(envelope: string): RespostaConsultaRecibo {
  const ret = retorno('retAutorizacao', envelope, 'retConsReciNFe');
  return noContrato('retAutorizacao', RespostaConsultaRecibo, {
    ...cabecalho(ret.el),
    cUF: Number(t(ret.el, 'cUF')),
    nRec: t(ret.el, 'nRec'),
    dhRecbto: opcional(t(ret.el, 'dhRecbto')),
    protocolos: protocolosNFe(ret),
    xml: ret.xml,
  });
}

export function lerRetornoConsultaProtocolo(envelope: string): RespostaConsultaProtocolo {
  const ret = retorno('consultaProtocolo', envelope, 'retConsSitNFe');
  return noContrato('consultaProtocolo', RespostaConsultaProtocolo, {
    ...cabecalho(ret.el),
    cUF: Number(t(ret.el, 'cUF')),
    chNFe: t(ret.el, 'chNFe'),
    dhRecbto: t(ret.el, 'dhRecbto'),
    protocolo: protocolosNFe(ret)[0] ?? null,
    eventos: protocolosEvento(ret),
    xml: ret.xml,
  });
}

export function lerRetornoStatusServico(envelope: string): RespostaStatusServico {
  const ret = retorno('statusServico', envelope, 'retConsStatServ');
  return noContrato('statusServico', RespostaStatusServico, {
    ...cabecalho(ret.el),
    cUF: Number(t(ret.el, 'cUF')),
    dhRecbto: t(ret.el, 'dhRecbto'),
    tMed: numero(t(ret.el, 'tMed')),
    dhRetorno: opcional(t(ret.el, 'dhRetorno')),
    xObs: opcional(t(ret.el, 'xObs')),
    xml: ret.xml,
  });
}

export function lerRetornoEvento(envelope: string): RespostaEvento {
  const ret = retorno('recepcaoEvento', envelope, 'retEnvEvento');
  return noContrato('recepcaoEvento', RespostaEvento, {
    ...cabecalho(ret.el),
    cOrgao: Number(t(ret.el, 'cOrgao')),
    idLote: t(ret.el, 'idLote'),
    eventos: protocolosEvento(ret),
    xml: ret.xml,
  });
}

export function lerRetornoInutilizacao(envelope: string): RespostaInutilizacao {
  const ret = retorno('inutilizacao', envelope, 'retInutNFe');
  const inf = filhoNfe(ret.el, 'infInut');
  const mod = t(inf, 'mod');
  return noContrato('inutilizacao', RespostaInutilizacao, {
    ...cabecalho(inf),
    cUF: Number(t(inf, 'cUF')),
    dhRecbto: t(inf, 'dhRecbto'),
    nProt: opcional(t(inf, 'nProt')),
    ano: opcional(t(inf, 'ano')),
    CNPJ: opcional(t(inf, 'CNPJ')),
    mod: mod === '' ? null : mod,
    serie: numero(t(inf, 'serie')),
    nNFIni: numero(t(inf, 'nNFIni')),
    nNFFin: numero(t(inf, 'nNFFin')),
    xml: ret.xml,
  });
}
