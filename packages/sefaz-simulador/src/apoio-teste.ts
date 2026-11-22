/**
 * Apoio dos testes do simulador (não é exportado pelo pacote): relógio fixo e ajustável, dois A1 fictícios gerados
 * na hora, NF-e/eventos/inutilização assinados e o registro dos `cStat` vistos (cobertura da tabela `MOTIVO`).
 */
import {
  escolherDestinoSefaz,
  type DestinoSimulador,
  type ModoEmissao,
  type ProtocoloEvento,
  type ProtocoloNFe,
} from '@macuxierp/nfe-sefaz';
import {
  CNPJ_EMITENTE_DE_TESTE,
  CNPJ_OUTRO_DE_TESTE,
  INSTANTE_DE_TESTE,
  VALIDADE_DE_TESTE,
  assinarXmlDeTeste,
  gerarA1DeTeste,
  montarCancelamentoDeTeste,
  montarCartaCorrecaoDeTeste,
  montarInutilizacaoDeTeste,
  montarNFeDeTeste,
  type A1DeTeste,
  type OpcoesEventoDeTeste,
  type OpcoesNFeDeTeste,
} from '@macuxierp/nfe-sefaz/teste';
import { criarRegistroSimulador, criarSimuladorSefaz, type OpcoesSimulador, type SimuladorSefaz } from './index';

export const FILIAL = '7f1c2a50-3b8e-4c1d-9a2f-0e6b5d4c3a21';
/** 21/11/2026, 22h59 em Manaus (`INSTANTE_DE_TESTE`). */
export const INICIO = INSTANTE_DE_TESTE;
export const HORA = 3_600_000;

/** Relógio do teste: começa em `INICIO` e só anda quando o teste manda. */
export function criarRelogio() {
  let ms = INICIO.getTime();
  return {
    agora: () => new Date(ms),
    avancar: (deltaMs: number) => {
      ms += deltaMs;
    },
  };
}

/** Os A1 dos testes: `VALIDADE_DE_TESTE`, um ano antes e um ano depois do `INICIO` (independem do relógio real). */
let a1s: { emitente: A1DeTeste; outro: A1DeTeste } | null = null;
export function a1DeTeste(): { emitente: A1DeTeste; outro: A1DeTeste } {
  a1s ??= { emitente: gerarA1DeTeste({ ...VALIDADE_DE_TESTE }), outro: gerarA1DeTeste({ ...VALIDADE_DE_TESTE, cnpj: CNPJ_OUTRO_DE_TESTE, nome: 'OUTRA EMPRESA FICTICIA LTDA' }) };
  return a1s;
}

export function destinoDe(modo: ModoEmissao = 'normal', filial = FILIAL): DestinoSimulador {
  return escolherDestinoSefaz({ filial_id: filial, ambiente: 'homologacao', uf: 'AM', modo }, { transporte: 'simulador' }) as DestinoSimulador;
}

export function novoSimulador(o: OpcoesSimulador & { modo?: ModoEmissao } = {}): { s: SimuladorSefaz; relogio: ReturnType<typeof criarRelogio> } {
  const relogio = criarRelogio();
  const s = criarSimuladorSefaz(destinoDe(o.modo), { agora: relogio.agora, registro: o.registro ?? criarRegistroSimulador(), ...(o.tMed === undefined ? {} : { tMed: o.tMed }) });
  return { s, relogio };
}

/** NF-e assinada com o A1 (padrão: o do emitente). `ajustar` mexe no XML ANTES da assinatura. */
export function nfeAssinada(
  o: Partial<OpcoesNFeDeTeste> & { nNF: number },
  extra: { a1?: A1DeTeste; ajustar?: (xml: string) => string } = {},
): { chave: string; xml: string } {
  const n = montarNFeDeTeste({ dhEmi: new Date(INICIO.getTime() - 60_000), ...o });
  const a1 = extra.a1 ?? a1DeTeste().emitente;
  const xml = (extra.ajustar ?? ((x) => x))(n.xml);
  return { chave: n.chave, xml: assinarXmlDeTeste(xml, { elemento: 'infNFe', a1 }) };
}

export function cancelamentoAssinado(o: OpcoesEventoDeTeste & { nProt: string; xJust?: string }, a1: A1DeTeste = a1DeTeste().emitente): string {
  return assinarXmlDeTeste(montarCancelamentoDeTeste(o), { elemento: 'infEvento', a1 });
}

export function cceAssinada(o: OpcoesEventoDeTeste & { nSeqEvento: number }, a1: A1DeTeste = a1DeTeste().emitente, ajustar: (x: string) => string = (x) => x): string {
  return assinarXmlDeTeste(ajustar(montarCartaCorrecaoDeTeste(o)), { elemento: 'infEvento', a1 });
}

export function inutilizacaoAssinada(o: Parameters<typeof montarInutilizacaoDeTeste>[0], a1: A1DeTeste = a1DeTeste().emitente): string {
  return assinarXmlDeTeste(montarInutilizacaoDeTeste(o), { elemento: 'infInut', a1 });
}

/** Autoriza uma NF-e no modo síncrono e devolve o protocolo. */
export async function autorizarUma(s: SimuladorSefaz, xml: string, idLote = '1'): Promise<ProtocoloNFe> {
  const r = await s.autorizar({ idLote, sincrono: true, nfes: [xml] });
  vistos(r.cStat);
  const p = r.protocolos[0];
  if (!p) throw new Error(`lote sem protocolo (cStat ${r.cStat})`);
  return vistos(p);
}

/** `cStat` vistos nos testes (o teste de cobertura confere que a tabela inteira foi exercitada). */
export const CSTAT_VISTOS = new Set<string>();
export function vistos<T extends string | { cStat: string } | ProtocoloEvento>(x: T): T {
  CSTAT_VISTOS.add(typeof x === 'string' ? x : x.cStat);
  return x;
}

export { CNPJ_EMITENTE_DE_TESTE, CNPJ_OUTRO_DE_TESTE };
