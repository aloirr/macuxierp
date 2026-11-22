/**
 * NFeRecepcaoEvento4 do simulador: cancelamento (110111) e carta de correção (110110). O lote volta com 128 e um
 * `retEvento` por evento: 135 registrado, ou a rejeição (252, 250, 455, 572, assinatura/certificado, 236, 494, 574,
 * 578, 577, 205, 218, 573, 222, 501). Schema fora (inclusive `<!DOCTYPE`): 215 no lote, sem `retEvento`.
 * O `tpEvento` diferente da operação chamada é erro de quem chama (`SEFAZ_PEDIDO_INVALIDO`), não rejeição.
 */
import {
  ErroSefaz,
  NS_NFE,
  TIPO_EVENTO,
  chaveNFeComDvValido,
  dataHoraSefaz,
  filhoNfe,
  lerXml,
  montarEnvEvento,
  semDeclaracaoXml,
  validarXsd,
  verificarAssinaturaXml,
  type ProtocoloEvento,
  type RespostaEvento,
  type TipoEvento,
} from '@macuxierp/nfe-sefaz';
import { PRAZO_CANCELAMENTO_MS, TOLERANCIA_FUTURO_MS, novoNumero, retornoBase, tagsRetorno, type CStatSimulador, type Contexto } from './contexto';
import { refAutorizacao } from './estado';
import { tag, texto } from './xml';

const X_EVENTO: Record<TipoEvento, string> = {
  [TIPO_EVENTO.cancelamento]: 'Cancelamento registrado',
  [TIPO_EVENTO.cartaCorrecao]: 'Carta de Correcao registrada',
};

function retEventoXml(p: Omit<ProtocoloEvento, 'xml'>, cOrgao: number): string {
  const ok = p.nProt !== null;
  return (
    `<retEvento xmlns="${NS_NFE}" versao="1.00"><infEvento${ok ? ` Id="ID${p.nProt}"` : ''}>` +
    `${tagsRetorno(p, tag('cOrgao', cOrgao))}${tag('chNFe', p.chNFe)}` +
    `${tag('tpEvento', p.tpEvento)}${ok ? tag('xEvento', X_EVENTO[p.tpEvento]) : ''}${tag('nSeqEvento', p.nSeqEvento)}` +
    `${tag('dhRegEvento', p.dhRegEvento)}${tag('nProt', p.nProt)}</infEvento></retEvento>`
  );
}

interface EventoLido {
  raiz: Element;
  chNFe: string;
  tpEvento: TipoEvento;
  nSeqEvento: number;
}

/** Um evento (já passou no schema do lote). */
function processarEvento(ctx: Contexto, eventoXml: string, ev: EventoLido): ProtocoloEvento {
  const agora = ctx.agora();
  const dhRegEvento = dataHoraSefaz(agora);
  const inf = filhoNfe(ev.raiz, 'infEvento');
  const responder = (cStat: CStatSimulador, nProt: string | null = null, complemento = ''): ProtocoloEvento => {
    const p = { ...retornoBase(ctx, cStat, complemento), chNFe: ev.chNFe, tpEvento: ev.tpEvento, nSeqEvento: ev.nSeqEvento, dhRegEvento, nProt };
    return { ...p, xml: retEventoXml(p, ctx.d.cUF) };
  };

  if (texto(inf, 'tpAmb') !== String(ctx.d.tpAmb)) return responder('252');
  const cOrgao = texto(inf, 'cOrgao');
  if (cOrgao !== String(ctx.d.cUF)) return responder('250');
  if (ev.chNFe.slice(0, 2) !== cOrgao) return responder('455');
  if (inf?.getAttribute('Id') !== `ID${ev.tpEvento}${ev.chNFe}${String(ev.nSeqEvento).padStart(2, '0')}`) return responder('572');
  const autor = texto(inf, 'CNPJ') || texto(inf, 'CPF');
  const assinatura = verificarAssinaturaXml(eventoXml, { elemento: 'infEvento', cnpjEsperado: autor, agora });
  if (!assinatura.ok) return responder(assinatura.cStat as CStatSimulador);
  if (!chaveNFeComDvValido(ev.chNFe)) return responder('236');

  const nota = ctx.estado.notas.get(ev.chNFe);
  if (!nota) return responder('494');
  if (autor !== nota.cnpj) return responder('574');
  const dhEvento = new Date(texto(inf, 'dhEvento'));
  if (Number.isNaN(dhEvento.getTime()) || dhEvento.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS) return responder('578');
  if (dhEvento.getTime() < nota.dhEmi.getTime()) return responder('577');
  const ref = ` ${refAutorizacao(nota)}`;
  if (nota.situacao === 'denegada') return responder('205', null, ref);

  if (ev.tpEvento === TIPO_EVENTO.cancelamento) {
    if (nota.situacao === 'cancelada') return responder('573');
    if (texto(inf, 'detEvento', 'nProt') !== nota.protocolo.nProt) return responder('222');
    if (agora.getTime() - nota.autorizadaEm.getTime() > PRAZO_CANCELAMENTO_MS) return responder('501');
  } else {
    if (nota.situacao === 'cancelada') return responder('218', null, ref);
    if (nota.eventos.some((e) => e.protocolo.tpEvento === ev.tpEvento && e.protocolo.nSeqEvento === ev.nSeqEvento)) return responder('573');
  }

  const p = responder('135', novoNumero(ctx, 'nProt'));
  nota.eventos.push({ protocolo: p, eventoXml });
  if (ev.tpEvento === TIPO_EVENTO.cancelamento) nota.situacao = 'cancelada';
  return p;
}

export async function registrarEvento(ctx: Contexto, esperado: TipoEvento, idLote: string, eventoAssinado: string): Promise<RespostaEvento> {
  const eventoXml = semDeclaracaoXml(eventoAssinado);
  const raiz = lerXml(eventoXml)?.documentElement ?? null;
  const inf = filhoNfe(raiz, 'infEvento');
  const tpEvento = texto(inf, 'tpEvento');
  if (raiz && tpEvento && tpEvento !== esperado) {
    throw new ErroSefaz('SEFAZ_PEDIDO_INVALIDO', `Evento ${tpEvento} enviado pela operação do evento ${esperado}`);
  }
  const esquema = esperado === TIPO_EVENTO.cancelamento ? 'envEventoCancNFe' : 'envCCe';
  const lote = montarEnvEvento(idLote, eventoXml);
  const valido = raiz !== null && (await validarXsd(lote, esquema)).valido;

  const eventos = valido ? [processarEvento(ctx, eventoXml, { raiz: raiz!, chNFe: texto(inf, 'chNFe'), tpEvento: esperado, nSeqEvento: Number(texto(inf, 'nSeqEvento')) })] : [];
  const cStat: CStatSimulador = valido ? '128' : '215';
  const r = { ...retornoBase(ctx, cStat), cOrgao: ctx.d.cUF, idLote, eventos };
  const xml =
    `<retEnvEvento xmlns="${NS_NFE}" versao="1.00">${tag('idLote', idLote)}${tagsRetorno(r, tag('cOrgao', r.cOrgao))}` +
    `${eventos.map((e) => e.xml).join('')}</retEnvEvento>`;
  return { ...r, xml };
}
