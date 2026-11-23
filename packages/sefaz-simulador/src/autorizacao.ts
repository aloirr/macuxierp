/**
 * NFeAutorizacao4 e NFeRetAutorizacao4 do simulador: lote síncrono (indSinc 1: 104 com o protocolo) e assíncrono
 * (103 com o recibo; `consultarRecibo` dá 105 até passar o `tMed` e 104 depois). O lote passa pelo tamanho (214) e
 * pelo schema (225, inclusive `<!DOCTYPE`). Cada NF-e segue a ordem de validação do Manual: ambiente (252), UF (226),
 * tipo de emissão (570: o modo do destino aceita o tpEmis? `TP_EMIS_ACEITOS`), contingência (556/557/558: dhCont e
 * xJust), chave (502/253), CNPJ (207), assinatura e certificado (297/298/202/290/291/292/213), datas (703/228), EPEC da
 * nota com tpEmis 4 (468 sem EPEC, 467 divergente; ADR 0011), numeração (trava da faixa, 206/204/218/205/539),
 * denegação (301/302) e, passando tudo, 100. A nota EPEC autorizada leva o evento EPEC vinculado (consulta).
 */
import {
  ChaveNFe,
  NS_NFE,
  TAMANHO_MAXIMO_XML_SEFAZ,
  aammSefaz,
  chaveNFeComDvValido,
  dadosEpecDaNFe,
  dadosEpecDoEvento,
  dataHoraSefaz,
  divergenciasEpec,
  filhoNfe,
  lerXml,
  montarChaveNFe,
  montarEnviNFe,
  semDeclaracaoXml,
  TP_EMIS_EPEC,
  textoNfe,
  tpEmisAceito,
  validarXsd,
  verificarAssinaturaXml,
  type PedidoAutorizacao,
  type ProtocoloNFe,
  type RespostaAutorizacao,
  type RespostaConsultaRecibo,
} from '@macuxierp/nfe-sefaz';
import { cnpjValido } from '@macuxierp/platform-sdk';
import {
  ATRASO_MAXIMO_EMISSAO_MS,
  TOLERANCIA_FUTURO_MS,
  consumirRejeicao,
  novoNumero,
  retornoBase,
  tagsRetorno,
  type CStatSimulador,
  type Contexto,
} from './contexto';
import { refAutorizacao, type EstadoSimuladorRepo, type EventoSimulado, type NotaSimulada } from './estado';
import { tag } from './xml';

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
  const p = {
    tpAmb,
    verAplic,
    chNFe,
    dhRecbto,
    nProt: extra.nProt ?? null,
    digVal: extra.digVal ?? null,
    cStat,
    xMotivo,
  };
  return { ...p, xml: protocoloXml(p) };
}

const CHAVE_VAZIA = '0'.repeat(44);

/**
 * Uma NF-e do lote (já passou no schema do lote). `forcado`: a rejeição do apoio de teste (não grava nada). As
 * conferências do próprio XML vêm antes; as da numeração (206/204/218/205/539) leem a porta, na unidade de trabalho do lote.
 */
async function processarNFe(
  ctx: Contexto,
  repo: EstadoSimuladorRepo,
  nfeXml: string,
  recebidoEm: Date,
  dhRecbto: string,
  forcado: CStatSimulador | null,
): Promise<ProtocoloNFe> {
  const inf = filhoNfe(lerXml(nfeXml)?.documentElement, 'infNFe');
  const chNFe = (inf?.getAttribute('Id') ?? '').replace(/^NFe/, '');
  const chave = ChaveNFe.safeParse(chNFe).success ? chNFe : CHAVE_VAZIA;
  const rejeitar = (cStat: CStatSimulador, complemento?: string) =>
    protocolo(ctx, chave, dhRecbto, cStat, complemento ? { complemento } : {});
  if (!inf || chave === CHAVE_VAZIA) return rejeitar('225');
  if (forcado) return rejeitar(forcado);

  const ide = filhoNfe(inf, 'ide');
  const cnpj = textoNfe(inf, 'emit', 'CNPJ');
  const serie = Number(textoNfe(ide, 'serie'));
  const nNF = Number(textoNfe(ide, 'nNF'));
  const dhEmiTexto = textoNfe(ide, 'dhEmi');
  const dhEmi = new Date(dhEmiTexto);

  if (textoNfe(ide, 'tpAmb') !== String(ctx.d.tpAmb)) return rejeitar('252');
  if (textoNfe(ide, 'cUF') !== String(ctx.d.cUF)) return rejeitar('226');
  const tpEmis = Number(textoNfe(ide, 'tpEmis'));
  if (!tpEmisAceito(ctx.d.modo, tpEmis)) return rejeitar('570');
  const dhCont = textoNfe(ide, 'dhCont');
  const xJust = textoNfe(ide, 'xJust');
  if (tpEmis === 1 && (dhCont || xJust)) return rejeitar('556');
  if (tpEmis !== 1 && (!dhCont || !xJust)) return rejeitar('557');
  if (dhCont && new Date(dhCont).getTime() > recebidoEm.getTime() + TOLERANCIA_FUTURO_MS) return rejeitar('558');
  let montada: string;
  try {
    montada = montarChaveNFe({
      cUF: ctx.d.cUF,
      aamm: aammSefaz(dhEmiTexto),
      cnpj,
      mod: '55',
      serie,
      nNF,
      tpEmis,
      cNF: textoNfe(ide, 'cNF'),
    });
  } catch {
    return rejeitar('502');
  }
  if (montada.slice(0, 43) !== chave.slice(0, 43)) return rejeitar('502');
  if (!chaveNFeComDvValido(chave) || textoNfe(ide, 'cDV') !== chave.slice(-1)) return rejeitar('253');
  if (!cnpjValido(cnpj)) return rejeitar('207');

  const assinatura = verificarAssinaturaXml(nfeXml, {
    elemento: 'infNFe',
    cnpjEsperado: cnpj,
    agora: recebidoEm,
  });
  if (!assinatura.ok) return rejeitar(assinatura.cStat as CStatSimulador);

  if (Number.isNaN(dhEmi.getTime()) || dhEmi.getTime() > recebidoEm.getTime() + TOLERANCIA_FUTURO_MS)
    return rejeitar('703');
  if (dhEmi.getTime() < recebidoEm.getTime() - ATRASO_MAXIMO_EMISSAO_MS) return rejeitar('228');

  const d = ctx.d;
  // EPEC (ADR 0011): a nota com tpEmis 4 só passa com a EPEC da chave registrada e com o mesmo resumo.
  let epec: EventoSimulado | null = null;
  if (tpEmis === TP_EMIS_EPEC) {
    epec = await repo.epecPorChave(d, chave);
    if (!epec) return rejeitar('468');
    const daNota = dadosEpecDaNFe(nfeXml);
    const doEvento = dadosEpecDoEvento(epec.eventoXml);
    if (!daNota || !doEvento || divergenciasEpec(daNota, doEvento).length > 0) return rejeitar('467');
  }
  // A mesma trava da inutilização (CNPJ, série e ano; o ano da chave, que já conferiu com o dhEmi): a inutilização
  // e a nota do mesmo número nunca passam as duas (ou 206 aqui, ou 241 lá).
  await repo.travarFaixa(d, { cnpj, serie, ano: chave.slice(2, 4) });
  if (await repo.numeroInutilizado(d, cnpj, serie, nNF)) return rejeitar('206');
  const duplicada = (n: NotaSimulada): ProtocoloNFe => {
    const ref = ` ${refAutorizacao(n)}`;
    if (n.chNFe !== chave) return rejeitar('539', ` [chNFe:${n.chNFe}]${refAutorizacao(n)}`);
    if (n.situacao === 'cancelada') return rejeitar('218', ref);
    if (n.situacao === 'denegada') return rejeitar('205', ref);
    return rejeitar('204', ref);
  };
  const existente = (await repo.notaPorChave(d, chave)) ?? (await repo.notaPorNumero(d, cnpj, serie, nNF));
  if (existente) return duplicada(existente);

  const docDest = textoNfe(inf, 'dest', 'CNPJ') || textoNfe(inf, 'dest', 'CPF');
  const denegados = ctx.estado.controles.denegados;
  const denegacao =
    denegados.get(cnpj) === '301' ? '301' : docDest && denegados.get(docDest) === '302' ? '302' : null;
  const cStat: CStatSimulador = denegacao ?? '100';
  const p = protocolo(ctx, chave, dhRecbto, cStat, {
    nProt: await novoNumero(ctx, repo, 'nProt'),
    digVal: assinatura.digestValue,
  });
  // Autorização concorrente da mesma chave (ou do mesmo número): quem gravou primeiro fica; esta responde 204 ou 539.
  const concorrente = await repo.gravarNota(d, {
    chNFe: chave,
    cnpj,
    serie,
    nNF,
    dhEmi,
    autorizadaEm: recebidoEm,
    protocolo: p,
    situacao: denegacao ? 'denegada' : 'autorizada',
  });
  if (concorrente) return duplicada(concorrente);
  // A EPEC passa a ser evento da nota (vinculada): a consulta de protocolo devolve os dois. No `retConsSitNFe` o
  // `retEvento` segue o leiaute genérico, sem o `cOrgaoAutor` do retorno da EPEC.
  if (epec) {
    const xml = epec.protocolo.xml.replace(/<cOrgaoAutor>\d{2}<\/cOrgaoAutor>/, '');
    await repo.gravarEvento(d, chave, { ...epec, protocolo: { ...epec.protocolo, xml } });
  }
  return p;
}

function respostaAutorizacao(
  ctx: Contexto,
  dhRecbto: string,
  cStat: CStatSimulador,
  resto: Pick<RespostaAutorizacao, 'recibo' | 'protocolos'>,
): RespostaAutorizacao {
  const r = { ...retornoBase(ctx, cStat), cUF: ctx.d.cUF, dhRecbto, ...resto };
  const corpo = r.recibo
    ? `<infRec>${tag('nRec', r.recibo.nRec)}${tag('tMed', r.recibo.tMed)}</infRec>`
    : r.protocolos.map((p) => p.xml).join('');
  const xml = `<retEnviNFe xmlns="${NS_NFE}" versao="4.00">${tagsRetorno(r)}${tag('cUF', r.cUF)}${tag('dhRecbto', dhRecbto)}${corpo}</retEnviNFe>`;
  return { ...r, xml };
}

export async function autorizar(ctx: Contexto, pedido: PedidoAutorizacao): Promise<RespostaAutorizacao> {
  const recebidoEm = ctx.agora();
  const dhRecbto = dataHoraSefaz(recebidoEm);
  const lote = montarEnviNFe(pedido);
  const semNada = { recibo: null, protocolos: [] };
  if (Buffer.byteLength(lote, 'utf8') > TAMANHO_MAXIMO_XML_SEFAZ)
    return respostaAutorizacao(ctx, dhRecbto, '214', semNada);
  if (!(await validarXsd(lote, 'enviNFe')).valido) return respostaAutorizacao(ctx, dhRecbto, '225', semNada);

  const forcado = consumirRejeicao(ctx, 'autorizar');
  // O lote inteiro numa unidade de trabalho: as notas e o recibo saem juntos (ou nada sai).
  return ctx.fonte(async (repo) => {
    const protocolos: ProtocoloNFe[] = [];
    for (const x of pedido.nfes)
      protocolos.push(await processarNFe(ctx, repo, semDeclaracaoXml(x), recebidoEm, dhRecbto, forcado));
    if (pedido.sincrono) return respostaAutorizacao(ctx, dhRecbto, '104', { recibo: null, protocolos });

    const nRec = await novoNumero(ctx, repo, 'nRec');
    await repo.gravarRecibo(ctx.d, {
      nRec,
      dhRecbto,
      prontoEm: new Date(recebidoEm.getTime() + ctx.tMed * 1000),
      protocolos,
    });
    return respostaAutorizacao(ctx, dhRecbto, '103', { recibo: { nRec, tMed: ctx.tMed }, protocolos: [] });
  });
}

export async function consultarRecibo(ctx: Contexto, nRec: string): Promise<RespostaConsultaRecibo> {
  const agora = ctx.agora();
  const forcado = consumirRejeicao(ctx, 'consultarRecibo');
  const lote = await ctx.fonte((repo) => repo.recibo(ctx.d, nRec));
  const c = ctx.estado.controles;
  let cStat: CStatSimulador;
  if (forcado) cStat = forcado;
  else if (!lote) cStat = '106';
  else if (c.recibosAtrasados > 0) {
    c.recibosAtrasados -= 1;
    cStat = '105';
  } else cStat = agora.getTime() < lote.prontoEm.getTime() ? '105' : '104';
  const protocolos = cStat === '104' && lote ? [...lote.protocolos] : [];
  const r = {
    ...retornoBase(ctx, cStat),
    cUF: ctx.d.cUF,
    nRec,
    dhRecbto: lote?.dhRecbto ?? dataHoraSefaz(agora),
    protocolos,
  };
  const xml =
    `<retConsReciNFe xmlns="${NS_NFE}" versao="4.00">${tagsRetorno(r, tag('nRec', nRec))}${tag('cUF', r.cUF)}` +
    `${tag('dhRecbto', r.dhRecbto)}${protocolos.map((p) => p.xml).join('')}</retConsReciNFe>`;
  return { ...r, xml };
}
