/**
 * NFeConsultaProtocolo4 e NFeStatusServico4 do simulador.
 * - Consulta: 100 autorizada, 101 cancelada, 110 denegada (o protocolo traz o 301/302 original), 217 não consta,
 *   236 chave com DV inválido, 226 chave de outra UF. Os eventos registrados voltam como `procEventoNFe`.
 * - Status: 107 em operação; 108/109 quando o teste paralisa o serviço (aciona a contingência, desenho §3.4).
 */
import { NS_NFE, chaveNFeComDvValido, dataHoraSefaz, type RespostaConsultaProtocolo, type RespostaStatusServico } from '@macuxierp/nfe-sefaz';
import { retornoBase, tagsRetorno, type CStatSimulador, type Contexto } from './contexto';
import { tag } from './xml';

export function consultarProtocolo(ctx: Contexto, chNFe: string): RespostaConsultaProtocolo {
  const dhRecbto = dataHoraSefaz(ctx.agora());
  const nota = chaveNFeComDvValido(chNFe) && chNFe.slice(0, 2) === String(ctx.d.cUF) ? ctx.estado.notas.get(chNFe) : undefined;
  let cStat: CStatSimulador;
  if (!chaveNFeComDvValido(chNFe)) cStat = '236';
  else if (chNFe.slice(0, 2) !== String(ctx.d.cUF)) cStat = '226';
  else if (!nota) cStat = '217';
  else cStat = nota.situacao === 'cancelada' ? '101' : nota.situacao === 'denegada' ? '110' : '100';

  const eventos = nota?.eventos ?? [];
  const r = {
    ...retornoBase(ctx, cStat),
    cUF: ctx.d.cUF,
    chNFe,
    dhRecbto,
    protocolo: nota?.protocolo ?? null,
    eventos: eventos.map((e) => e.protocolo),
  };
  const procEventos = eventos.map((e) => `<procEventoNFe versao="1.00">${e.eventoXml}${e.protocolo.xml}</procEventoNFe>`).join('');
  const xml =
    `<retConsSitNFe xmlns="${NS_NFE}" versao="4.00">${tagsRetorno(r)}${tag('cUF', r.cUF)}` +
    `${tag('dhRecbto', dhRecbto)}${tag('chNFe', chNFe)}${r.protocolo?.xml ?? ''}${procEventos}</retConsSitNFe>`;
  return { ...r, xml };
}

export function statusServico(ctx: Contexto): RespostaStatusServico {
  const dhRecbto = dataHoraSefaz(ctx.agora());
  const cStat: CStatSimulador = ctx.estado.controles.paralisacao ?? '107';
  const xObs = cStat === '107' ? null : 'Paralisacao simulada (MACUXI-SIMULADOR)';
  const r = { ...retornoBase(ctx, cStat), cUF: ctx.d.cUF, dhRecbto, tMed: ctx.tMed, dhRetorno: null, xObs };
  const xml =
    `<retConsStatServ xmlns="${NS_NFE}" versao="4.00">${tagsRetorno(r)}${tag('cUF', r.cUF)}` +
    `${tag('dhRecbto', dhRecbto)}${tag('tMed', r.tMed)}${tag('xObs', xObs)}</retConsStatServ>`;
  return { ...r, xml };
}
