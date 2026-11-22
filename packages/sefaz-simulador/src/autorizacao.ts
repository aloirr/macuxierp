/**
 * NFeAutorizacao4 e NFeRetAutorizacao4 do simulador: lote síncrono (indSinc 1: 104 com o protocolo) e assíncrono
 * (103 com o recibo; `consultarRecibo` dá 105 até passar o `tMed` e 104 depois). O lote passa pelo tamanho (214) e
 * pelo schema (225, inclusive `<!DOCTYPE`). Cada NF-e segue a ordem de validação do Manual: ambiente (252), UF (226),
 * tipo de emissão (570), chave (502/253), CNPJ (207), assinatura e certificado (297/298/202/290/291/292/213), datas
 * (703/228), numeração (206/204/218/205/539), denegação (301/302) e, passando tudo, 100.
 */
import {
  NS_NFE,
  TAMANHO_MAXIMO_XML_SEFAZ,
  aammSefaz,
  chaveNFeComDvValido,
  dataHoraSefaz,
  filhoNfe,
  lerXml,
  montarChaveNFe,
  montarEnviNFe,
  semDeclaracaoXml,
  validarXsd,
  verificarAssinaturaXml,
  type PedidoAutorizacao,
  type ProtocoloNFe,
  type RespostaAutorizacao,
  type RespostaConsultaRecibo,
} from '@macuxierp/nfe-sefaz';
import { cnpjValido } from '@macuxierp/platform-sdk';
import { ATRASO_MAXIMO_EMISSAO_MS, TOLERANCIA_FUTURO_MS, novoNumero, retornoBase, tagsRetorno, type CStatSimulador, type Contexto } from './contexto';
import { chaveNumero, refAutorizacao } from './estado';
import { tag, texto } from './xml';

function protocoloXml(p: Omit<ProtocoloNFe, 'xml'>): string {
  const id = p.nProt ? ` Id="ID${p.nProt}"` : '';
  return (
    `<protNFe xmlns="${NS_NFE}" versao="4.00"><infProt${id}>${tag('tpAmb', p.tpAmb)}${tag('verAplic', p.verAplic)}` +
    `${tag('chNFe', p.chNFe)}${tag('dhRecbto', p.dhRecbto)}${tag('nProt', p.nProt)}${tag('digVal', p.digVal)}` +
    `${tag('cStat', p.cStat)}${tag('xMotivo', p.xMotivo)}</infProt></protNFe>`
  );
}

function protocolo(
  ctx: Contexto,
  chNFe: string,
  dhRecbto: string,
  cStat: CStatSimulador,
  extra: { nProt?: string; digVal?: string; complemento?: string } = {},
): ProtocoloNFe {
  const { tpAmb, verAplic, xMotivo } = retornoBase(ctx, cStat, extra.complemento);
  const p = { tpAmb, verAplic, chNFe, dhRecbto, nProt: extra.nProt ?? null, digVal: extra.digVal ?? null, cStat, xMotivo };
  return { ...p, xml: protocoloXml(p) };
}

const CHAVE_VAZIA = '0'.repeat(44);

/** Uma NF-e do lote (já passou no schema do lote). */
function processarNFe(ctx: Contexto, nfeXml: string, recebidoEm: Date, dhRecbto: string): ProtocoloNFe {
  const inf = filhoNfe(lerXml(nfeXml)?.documentElement, 'infNFe');
  const chNFe = (inf?.getAttribute('Id') ?? '').replace(/^NFe/, '');
  const chave = /^\d{44}$/.test(chNFe) ? chNFe : CHAVE_VAZIA;
  const rejeitar = (cStat: CStatSimulador, complemento?: string) => protocolo(ctx, chave, dhRecbto, cStat, complemento ? { complemento } : {});
  if (!inf || chave === CHAVE_VAZIA) return rejeitar('225');

  const ide = filhoNfe(inf, 'ide');
  const cnpj = texto(inf, 'emit', 'CNPJ');
  const serie = Number(texto(ide, 'serie'));
  const nNF = Number(texto(ide, 'nNF'));
  const dhEmiTexto = texto(ide, 'dhEmi');
  const dhEmi = new Date(dhEmiTexto);

  if (texto(ide, 'tpAmb') !== String(ctx.d.tpAmb)) return rejeitar('252');
  if (texto(ide, 'cUF') !== String(ctx.d.cUF)) return rejeitar('226');
  if (texto(ide, 'tpEmis') !== String(ctx.d.tpEmis)) return rejeitar('570');
  let montada: string;
  try {
    montada = montarChaveNFe({ cUF: ctx.d.cUF, aamm: aammSefaz(dhEmiTexto), cnpj, mod: '55', serie, nNF, tpEmis: ctx.d.tpEmis, cNF: texto(ide, 'cNF') });
  } catch {
    return rejeitar('502');
  }
  if (montada.slice(0, 43) !== chave.slice(0, 43)) return rejeitar('502');
  if (!chaveNFeComDvValido(chave) || texto(ide, 'cDV') !== chave.slice(-1)) return rejeitar('253');
  if (!cnpjValido(cnpj)) return rejeitar('207');

  const assinatura = verificarAssinaturaXml(nfeXml, { elemento: 'infNFe', cnpjEsperado: cnpj, agora: recebidoEm });
  if (!assinatura.ok) return rejeitar(assinatura.cStat as CStatSimulador);

  if (Number.isNaN(dhEmi.getTime()) || dhEmi.getTime() > recebidoEm.getTime() + TOLERANCIA_FUTURO_MS) return rejeitar('703');
  if (dhEmi.getTime() < recebidoEm.getTime() - ATRASO_MAXIMO_EMISSAO_MS) return rejeitar('228');

  const e = ctx.estado;
  if (e.inutilizacoes.some((i) => i.cnpj === cnpj && i.serie === serie && nNF >= i.nNFIni && nNF <= i.nNFFin)) return rejeitar('206');
  const existente = e.notas.get(chave);
  if (existente) {
    if (existente.situacao === 'cancelada') return rejeitar('218', ` ${refAutorizacao(existente)}`);
    if (existente.situacao === 'denegada') return rejeitar('205', ` ${refAutorizacao(existente)}`);
    return rejeitar('204', ` ${refAutorizacao(existente)}`);
  }
  const outraChave = e.numeros.get(chaveNumero(cnpj, serie, nNF));
  const outra = outraChave ? e.notas.get(outraChave) : undefined;
  if (outra) return rejeitar('539', ` [chNFe:${outra.chNFe}]${refAutorizacao(outra)}`);

  const docDest = texto(inf, 'dest', 'CNPJ') || texto(inf, 'dest', 'CPF');
  const denegacao = e.controles.denegados.get(cnpj) === '301' ? '301' : docDest && e.controles.denegados.get(docDest) === '302' ? '302' : null;
  const cStat: CStatSimulador = denegacao ?? '100';
  const p = protocolo(ctx, chave, dhRecbto, cStat, { nProt: novoNumero(ctx, 'nProt'), digVal: assinatura.digestValue });
  e.notas.set(chave, { chNFe: chave, cnpj, serie, nNF, dhEmi, autorizadaEm: recebidoEm, protocolo: p, situacao: denegacao ? 'denegada' : 'autorizada', eventos: [] });
  e.numeros.set(chaveNumero(cnpj, serie, nNF), chave);
  return p;
}

function respostaAutorizacao(ctx: Contexto, dhRecbto: string, cStat: CStatSimulador, resto: Pick<RespostaAutorizacao, 'recibo' | 'protocolos'>): RespostaAutorizacao {
  const r = { ...retornoBase(ctx, cStat), cUF: ctx.d.cUF, dhRecbto, ...resto };
  const corpo = r.recibo ? `<infRec>${tag('nRec', r.recibo.nRec)}${tag('tMed', r.recibo.tMed)}</infRec>` : r.protocolos.map((p) => p.xml).join('');
  const xml = `<retEnviNFe xmlns="${NS_NFE}" versao="4.00">${tagsRetorno(r)}${tag('cUF', r.cUF)}${tag('dhRecbto', dhRecbto)}${corpo}</retEnviNFe>`;
  return { ...r, xml };
}

export async function autorizar(ctx: Contexto, pedido: PedidoAutorizacao): Promise<RespostaAutorizacao> {
  const recebidoEm = ctx.agora();
  const dhRecbto = dataHoraSefaz(recebidoEm);
  const lote = montarEnviNFe(pedido);
  const semNada = { recibo: null, protocolos: [] };
  if (Buffer.byteLength(lote, 'utf8') > TAMANHO_MAXIMO_XML_SEFAZ) return respostaAutorizacao(ctx, dhRecbto, '214', semNada);
  if (!(await validarXsd(lote, 'enviNFe')).valido) return respostaAutorizacao(ctx, dhRecbto, '225', semNada);

  const protocolos = pedido.nfes.map((x) => processarNFe(ctx, semDeclaracaoXml(x), recebidoEm, dhRecbto));
  if (pedido.sincrono) return respostaAutorizacao(ctx, dhRecbto, '104', { recibo: null, protocolos });

  const nRec = novoNumero(ctx, 'nRec');
  ctx.estado.lotes.set(nRec, { nRec, dhRecbto, prontoEm: recebidoEm.getTime() + ctx.tMed * 1000, protocolos });
  return respostaAutorizacao(ctx, dhRecbto, '103', { recibo: { nRec, tMed: ctx.tMed }, protocolos: [] });
}

export function consultarRecibo(ctx: Contexto, nRec: string): RespostaConsultaRecibo {
  const agora = ctx.agora();
  const lote = ctx.estado.lotes.get(nRec);
  const c = ctx.estado.controles;
  let cStat: CStatSimulador;
  if (!lote) cStat = '106';
  else if (c.recibosAtrasados > 0) {
    c.recibosAtrasados -= 1;
    cStat = '105';
  } else cStat = agora.getTime() < lote.prontoEm ? '105' : '104';
  const protocolos = cStat === '104' && lote ? [...lote.protocolos] : [];
  const r = { ...retornoBase(ctx, cStat), cUF: ctx.d.cUF, nRec, dhRecbto: lote?.dhRecbto ?? dataHoraSefaz(agora), protocolos };
  const xml =
    `<retConsReciNFe xmlns="${NS_NFE}" versao="4.00">${tagsRetorno(r, tag('nRec', nRec))}${tag('cUF', r.cUF)}` +
    `${tag('dhRecbto', r.dhRecbto)}${protocolos.map((p) => p.xml).join('')}</retConsReciNFe>`;
  return { ...r, xml };
}
