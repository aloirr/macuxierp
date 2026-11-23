/**
 * NFeRecepcaoEvento4 do simulador: cancelamento (110111) e carta de correção (110110). O lote volta com 128 e um
 * `retEvento` por evento: 135 registrado, ou a rejeição (252, 250, 455, 572, assinatura/certificado, 236, 494, 574,
 * 578, 577, 205, 218, 573, 222, 501). Schema fora (inclusive `<!DOCTYPE`): 215 no lote, sem `retEvento`.
 * E a recepção da EPEC (110140) do Ambiente Nacional (`registrarEpec`, ADR 0011): 136 registrado (a nota ainda não
 * existe), ou a rejeição (252, 250 com cOrgao diferente de 91, 572, assinatura/certificado, 236, 574, 455, 578, 577,
 * 573). Só na porta em memória: no Postgres a gravação recusa (RN-FAT-10).
 * O `tpEvento` diferente da operação chamada é erro de quem chama (`SEFAZ_PEDIDO_INVALIDO`), não rejeição.
 */
import {
  C_ORGAO_AN,
  ErroSefaz,
  NS_NFE,
  TIPO_EVENTO,
  chaveNFeComDvValido,
  dataHoraSefaz,
  filhoNfe,
  garantirTipoEvento,
  idEvento,
  lerXml,
  montarEnvEvento,
  semDeclaracaoXml,
  lerChaveNFe,
  textoNfe,
  validarXsd,
  verificarAssinaturaXml,
  type EsquemaXsd,
  type ProtocoloEvento,
  type RespostaEvento,
  type TipoEvento,
} from '@macuxierp/nfe-sefaz';
import {
  PRAZO_CANCELAMENTO_MS,
  TOLERANCIA_FUTURO_MS,
  consumirRejeicao,
  novoNumero,
  retornoBase,
  tagsRetorno,
  type CStatSimulador,
  type Contexto,
} from './contexto';
import { refAutorizacao, type EstadoSimuladorRepo, type OperacaoRejeitavel } from './estado';
import { tag } from './xml';

const X_EVENTO: Record<TipoEvento, string> = {
  [TIPO_EVENTO.cancelamento]: 'Cancelamento registrado',
  [TIPO_EVENTO.cartaCorrecao]: 'Carta de Correcao registrada',
  [TIPO_EVENTO.epec]: 'EPEC registrado',
};

/** `cOrgaoAutor`: só no retorno da EPEC (`leiauteEPEC_v1.00`, depois do `nSeqEvento`). */
function retEventoXml(p: Omit<ProtocoloEvento, 'xml'>, cOrgao: number, cOrgaoAutor?: string): string {
  const ok = p.nProt !== null;
  return (
    `<retEvento xmlns="${NS_NFE}" versao="1.00"><infEvento${ok ? ` Id="ID${p.nProt}"` : ''}>` +
    `${tagsRetorno(p, tag('cOrgao', cOrgao))}${tag('chNFe', p.chNFe)}` +
    `${tag('tpEvento', p.tpEvento)}${ok ? tag('xEvento', X_EVENTO[p.tpEvento]) : ''}${tag('nSeqEvento', p.nSeqEvento)}` +
    `${cOrgaoAutor === undefined ? '' : tag('cOrgaoAutor', cOrgaoAutor)}${tag('dhRegEvento', p.dhRegEvento)}${tag('nProt', p.nProt)}</infEvento></retEvento>`
  );
}

interface EventoLido {
  raiz: Element;
  chNFe: string;
  tpEvento: TipoEvento;
  nSeqEvento: number;
}

type Responder = (cStat: CStatSimulador, nProt?: string | null, complemento?: string) => ProtocoloEvento;

/**
 * O `retEvento` de um evento lido, com o mesmo `dhRegEvento` em toda resposta. `cOrgao` é o do retorno (o da UF ou o
 * 91 do Ambiente Nacional); `cOrgaoAutor` só vai no retorno da EPEC. `agora` é o instante do processamento.
 */
function respondedorEvento(
  ctx: Contexto,
  ev: EventoLido,
  cOrgao: number,
  cOrgaoAutor?: string,
): { agora: Date; responder: Responder } {
  const agora = ctx.agora();
  const dhRegEvento = dataHoraSefaz(agora);
  const responder: Responder = (cStat, nProt = null, complemento = '') => {
    const p = {
      ...retornoBase(ctx, cStat, complemento),
      chNFe: ev.chNFe,
      tpEvento: ev.tpEvento,
      nSeqEvento: ev.nSeqEvento,
      dhRegEvento,
      nProt,
    };
    return { ...p, xml: retEventoXml(p, cOrgao, cOrgaoAutor) };
  };
  return { agora, responder };
}

type Processar = (
  ctx: Contexto,
  repo: EstadoSimuladorRepo,
  eventoXml: string,
  ev: EventoLido,
  forcado: CStatSimulador | null,
) => Promise<ProtocoloEvento>;

/**
 * O lote de um evento só: confere o `tpEvento` da operação (erro de quem chama), valida o lote no `esquema` (215 sem
 * `retEvento` se falhar), consome a rejeição forçada da `operacao` e chama `processar` na unidade de trabalho. As
 * conferências do evento ficam em cada `processar*` (a ordem difere entre evento e EPEC e muda o `cStat`).
 */
async function loteDeEventos(
  ctx: Contexto,
  o: {
    idLote: string;
    eventoAssinado: string;
    esperado: TipoEvento;
    esquema: EsquemaXsd;
    operacao: OperacaoRejeitavel;
    cOrgao: number;
    processar: Processar;
  },
): Promise<RespostaEvento> {
  const eventoXml = semDeclaracaoXml(o.eventoAssinado);
  const raiz = lerXml(eventoXml)?.documentElement ?? null;
  const inf = filhoNfe(raiz, 'infEvento');
  garantirTipoEvento(eventoXml, o.esperado);
  const valido = raiz !== null && (await validarXsd(montarEnvEvento(o.idLote, eventoXml), o.esquema)).valido;
  const forcado = valido ? consumirRejeicao(ctx, o.operacao) : null;
  const ev = { raiz: raiz!, chNFe: textoNfe(inf, 'chNFe'), tpEvento: o.esperado, nSeqEvento: Number(textoNfe(inf, 'nSeqEvento')) };
  const eventos = valido ? [await ctx.fonte((repo) => o.processar(ctx, repo, eventoXml, ev, forcado))] : [];
  const cStat: CStatSimulador = valido ? '128' : '215';
  const r = { ...retornoBase(ctx, cStat), cOrgao: o.cOrgao, idLote: o.idLote, eventos };
  const xml =
    `<retEnvEvento xmlns="${NS_NFE}" versao="1.00">${tag('idLote', o.idLote)}${tagsRetorno(r, tag('cOrgao', r.cOrgao))}` +
    `${eventos.map((e) => e.xml).join('')}</retEnvEvento>`;
  return { ...r, xml };
}

/** Um evento (já passou no schema do lote). A nota e os eventos dela vêm da porta, na unidade de trabalho do evento. */
const processarEvento: Processar = async (ctx, repo, eventoXml, ev, forcado) => {
  const inf = filhoNfe(ev.raiz, 'infEvento');
  const { agora, responder } = respondedorEvento(ctx, ev, ctx.d.cUF);

  if (forcado) return responder(forcado);
  if (textoNfe(inf, 'tpAmb') !== String(ctx.d.tpAmb)) return responder('252');
  const cOrgao = textoNfe(inf, 'cOrgao');
  if (cOrgao !== String(ctx.d.cUF)) return responder('250');
  if (ev.chNFe.slice(0, 2) !== cOrgao) return responder('455');
  if (inf?.getAttribute('Id') !== idEvento(ev.tpEvento, ev.chNFe, ev.nSeqEvento)) return responder('572');
  const autor = textoNfe(inf, 'CNPJ') || textoNfe(inf, 'CPF');
  const assinatura = verificarAssinaturaXml(eventoXml, { elemento: 'infEvento', cnpjEsperado: autor, agora });
  if (!assinatura.ok) return responder(assinatura.cStat as CStatSimulador);
  if (!chaveNFeComDvValido(ev.chNFe)) return responder('236');

  // Travada até o fim do evento: o 2º cancelamento simultâneo vê a nota cancelada (573), a CC-e simultânea vê 218.
  const nota = await repo.notaPorChaveParaAtualizar(ctx.d, ev.chNFe);
  if (!nota) return responder('494');
  if (autor !== nota.cnpj) return responder('574');
  const dhEvento = new Date(textoNfe(inf, 'dhEvento'));
  if (Number.isNaN(dhEvento.getTime()) || dhEvento.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS)
    return responder('578');
  if (dhEvento.getTime() < nota.dhEmi.getTime()) return responder('577');
  const ref = ` ${refAutorizacao(nota)}`;
  if (nota.situacao === 'denegada') return responder('205', null, ref);

  if (ev.tpEvento === TIPO_EVENTO.cancelamento) {
    if (nota.situacao === 'cancelada') return responder('573');
    if (textoNfe(inf, 'detEvento', 'nProt') !== nota.protocolo.nProt) return responder('222');
    if (agora.getTime() - nota.autorizadaEm.getTime() > PRAZO_CANCELAMENTO_MS) return responder('501');
  } else {
    if (nota.situacao === 'cancelada') return responder('218', null, ref);
    const eventos = await repo.eventosDaNota(ctx.d, ev.chNFe);
    if (eventos.some((e) => e.protocolo.tpEvento === ev.tpEvento && e.protocolo.nSeqEvento === ev.nSeqEvento))
      return responder('573');
  }

  const p = responder('135', await novoNumero(ctx, repo, 'nProt'));
  await repo.gravarEvento(ctx.d, ev.chNFe, { protocolo: p, eventoXml });
  if (ev.tpEvento === TIPO_EVENTO.cancelamento) await repo.mudarSituacao(ctx.d, ev.chNFe, 'cancelada');
  return p;
};

export async function registrarEvento(ctx: Contexto, esperado: TipoEvento, idLote: string, eventoAssinado: string): Promise<RespostaEvento> {
  const cancelamento = esperado === TIPO_EVENTO.cancelamento;
  return loteDeEventos(ctx, {
    idLote,
    eventoAssinado,
    esperado,
    esquema: cancelamento ? 'envEventoCancNFe' : 'envCCe',
    operacao: cancelamento ? 'cancelar' : 'cartaCorrecao',
    cOrgao: ctx.d.cUF,
    processar: processarEvento,
  });
}

/** Uma EPEC (já passou no schema do lote). Registrada no destino normal da filial, antes de a nota existir. */
const processarEpec: Processar = async (ctx, repo, eventoXml, ev, forcado) => {
  const inf = filhoNfe(ev.raiz, 'infEvento');
  const cOrgaoAutor = textoNfe(inf, 'detEvento', 'cOrgaoAutor');
  const { agora, responder } = respondedorEvento(ctx, ev, C_ORGAO_AN, cOrgaoAutor || String(ctx.d.cUF));

  if (forcado) return responder(forcado);
  if (textoNfe(inf, 'tpAmb') !== String(ctx.d.tpAmb)) return responder('252');
  if (textoNfe(inf, 'cOrgao') !== String(C_ORGAO_AN)) return responder('250');
  if (inf?.getAttribute('Id') !== idEvento(ev.tpEvento, ev.chNFe, ev.nSeqEvento)) return responder('572');
  const autor = textoNfe(inf, 'CNPJ') || textoNfe(inf, 'CPF');
  const assinatura = verificarAssinaturaXml(eventoXml, { elemento: 'infEvento', cnpjEsperado: autor, agora });
  if (!assinatura.ok) return responder(assinatura.cStat as CStatSimulador);
  if (!chaveNFeComDvValido(ev.chNFe)) return responder('236');
  const chave = lerChaveNFe(ev.chNFe);
  if (!chave || chave.cnpj !== autor) return responder('574');
  if (cOrgaoAutor !== ev.chNFe.slice(0, 2)) return responder('455');
  const dhEvento = new Date(textoNfe(inf, 'dhEvento'));
  if (Number.isNaN(dhEvento.getTime()) || dhEvento.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS)
    return responder('578');
  if (dhEvento.getTime() < new Date(textoNfe(inf, 'detEvento', 'dhEmi')).getTime()) return responder('577');
  if (await repo.epecPorChave(ctx.d, ev.chNFe)) return responder('573');

  const p = responder('136', await novoNumero(ctx, repo, 'nProt'));
  await repo.gravarEpec(ctx.d, ev.chNFe, { protocolo: p, eventoXml });
  return p;
};

/**
 * Recepção da EPEC (110140) como o Ambiente Nacional: `retEnvEvento` com `cOrgao` 91. Só no destino NORMAL da filial
 * (a nota EPEC volta ao autorizador normal); no destino de SVC é erro de quem chama.
 */
export async function registrarEpec(ctx: Contexto, idLote: string, eventoAssinado: string): Promise<RespostaEvento> {
  if (ctx.d.modo !== 'normal')
    throw new ErroSefaz('SEFAZ_CONTINGENCIA_INVALIDA', `EPEC é registrada no destino normal da filial, não no ${ctx.d.modo}`);
  return loteDeEventos(ctx, {
    idLote,
    eventoAssinado,
    esperado: TIPO_EVENTO.epec,
    esquema: 'envEPEC',
    operacao: 'epec',
    cOrgao: C_ORGAO_AN,
    processar: processarEpec,
  });
}
