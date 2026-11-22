/**
 * O que toda operação do simulador recebe: destino (só homologação), estado do destino, registro (contadores),
 * relógio injetável e `tMed`. Também a tabela de `xMotivo` (textos do Manual de Orientação, sem acento, como a SEFAZ
 * devolve) e a numeração de protocolo e recibo com o prefixo do simulador.
 */
import { FalhaTransporteSefaz, aammSefaz, dataHoraSefaz, type DestinoSimulador } from '@macuxierp/nfe-sefaz';
import type { EstadoDestino, OperacaoRejeitavel, RegistroSimulador } from './estado';
import { tag } from './xml';

/** `verAplic` das respostas: identifica, em qualquer XML guardado, que veio do simulador e não da SEFAZ. */
export const VER_APLIC_SIMULADOR = 'MACUXI-SIMULADOR-0.1';

/**
 * 1º dígito de todo `nProt` e `nRec` do simulador. Formato (15 dígitos): `9` + tpEmis(1) + cUF(2) + ano(2) +
 * sequencial(9). Um protocolo que começa com 9 veio do simulador, nunca da SEFAZ (ADR 0008).
 */
export const PREFIXO_NUMERO_SIMULADOR = '9';

export interface Contexto {
  readonly d: DestinoSimulador;
  readonly estado: EstadoDestino;
  readonly registro: RegistroSimulador;
  readonly agora: () => Date;
  readonly tMed: number;
}

/** Ano (2 dígitos) no fuso de Manaus. */
export const anoSefaz = (instante: Date) => aammSefaz(dataHoraSefaz(instante)).slice(0, 2);

export function novoNumero(ctx: Contexto, tipo: 'nProt' | 'nRec'): string {
  const seq = String(ctx.registro.proximo(tipo)).padStart(9, '0');
  return `${PREFIXO_NUMERO_SIMULADOR}${ctx.d.tpEmis}${String(ctx.d.cUF).padStart(2, '0')}${anoSefaz(ctx.agora())}${seq}`;
}

/** `xMotivo` por `cStat` (Manual de Orientação do Contribuinte, tabela de códigos). */
export const MOTIVO = Object.freeze({
  '100': 'Autorizado o uso da NF-e',
  '101': 'Cancelamento de NF-e homologado',
  '102': 'Inutilizacao de numero homologado',
  '103': 'Lote recebido com sucesso',
  '104': 'Lote processado',
  '105': 'Lote em processamento',
  '106': 'Lote nao localizado',
  '107': 'Servico em Operacao',
  '108': 'Servico Paralisado Momentaneamente (curto prazo)',
  '109': 'Servico Paralisado sem Previsao',
  '110': 'Uso Denegado',
  '128': 'Lote de Evento Processado',
  '135': 'Evento registrado e vinculado a NF-e',
  '202': 'Rejeicao: Falha no reconhecimento da autoria ou integridade do arquivo digital',
  '204': 'Duplicidade de NF-e',
  '205': 'NF-e esta denegada na base de dados da SEFAZ',
  '206': 'Rejeicao: NF-e ja esta inutilizada na Base de dados da SEFAZ',
  '207': 'Rejeicao: CNPJ do emitente invalido',
  '213': 'Rejeicao: CNPJ-Base do Emitente difere do CNPJ-Base do Certificado Digital',
  '214': 'Rejeicao: Tamanho da mensagem excedeu o limite estabelecido',
  '215': 'Rejeicao: Falha no schema XML',
  '217': 'Rejeicao: NF-e nao consta na base de dados da SEFAZ',
  '218': 'NF-e ja esta cancelada na base de dados da SEFAZ',
  '222': 'Rejeicao: Protocolo de Autorizacao de Uso difere do cadastrado',
  '224': 'Rejeicao: A faixa inicial e maior que a faixa final',
  '225': 'Rejeicao: Falha no Schema XML do lote de NFe',
  '226': 'Rejeicao: Codigo da UF do Emitente diverge da UF autorizadora',
  '228': 'Rejeicao: Data de Emissao muito atrasada',
  '236': 'Rejeicao: Chave de Acesso com digito verificador invalido',
  '241': 'Rejeicao: Um numero da faixa ja foi utilizado',
  '250': 'Rejeicao: UF diverge da UF autorizadora',
  '252': 'Rejeicao: Ambiente informado diverge do Ambiente de recebimento',
  '253': 'Rejeicao: Digito Verificador da chave de acesso composta invalida',
  '256': 'Rejeicao: Uma NF-e da faixa ja esta inutilizada na Base de dados da SEFAZ',
  '290': 'Rejeicao: Certificado Assinatura invalido',
  '291': 'Rejeicao: Certificado Assinatura Data Validade',
  '292': 'Rejeicao: Certificado Assinatura sem CNPJ',
  '297': 'Rejeicao: Assinatura difere do calculado',
  '298': 'Rejeicao: Assinatura difere do padrao do Sistema',
  '301': 'Uso Denegado: Irregularidade fiscal do emitente',
  '302': 'Uso Denegado: Irregularidade fiscal do destinatario',
  '453': 'Rejeicao: Ano de inutilizacao nao pode ser superior ao Ano atual',
  '454': 'Rejeicao: Ano de inutilizacao nao pode ser inferior a 2006',
  '455': 'Rejeicao: Orgao Autor do evento diferente da UF da Chave de Acesso',
  '494': 'Rejeicao: Chave de Acesso inexistente',
  '501': 'Rejeicao: Prazo de Cancelamento superior ao previsto na Legislacao',
  '502': 'Rejeicao: Erro na Chave de Acesso - Campo Id nao corresponde a concatenacao dos campos correspondentes',
  '539': 'Duplicidade de NF-e com diferenca na Chave de Acesso',
  '563': 'Rejeicao: Ja existe pedido de Inutilizacao com a mesma faixa de inutilizacao',
  '570': 'Rejeicao: Tipo de Emissao 3, 6 ou 7 so e valido nas contingencias SCAN/SVC',
  '572': 'Rejeicao: Erro Atributo ID do evento nao corresponde a concatenacao dos campos (ID + tpEvento + chNFe + nSeqEvento)',
  '573': 'Rejeicao: Duplicidade de Evento',
  '574': 'Rejeicao: O autor do evento diverge do emissor da NF-e',
  '577': 'Rejeicao: A data do evento nao pode ser menor que a data de emissao da NF-e',
  '578': 'Rejeicao: A data do evento nao pode ser maior que a data do processamento',
  '703': 'Rejeicao: Data-Hora de Emissao posterior ao horario de recebimento',
} as const);
export type CStatSimulador = keyof typeof MOTIVO;

/** Todos os `cStat` que o simulador sabe devolver (o teste de cobertura confere que cada um é exercitado). */
export const CSTAT_DO_SIMULADOR: readonly CStatSimulador[] = Object.freeze(Object.keys(MOTIVO) as CStatSimulador[]);

function motivo(cStat: CStatSimulador, complemento = ''): string {
  return `${MOTIVO[cStat]}${complemento}`.slice(0, 255);
}

/** Cabeçalho de todo retorno do simulador: tpAmb do destino (sempre 2), `verAplic` do simulador, `cStat` e `xMotivo`. */
export function retornoBase<C extends CStatSimulador>(ctx: Contexto, cStat: C, complemento = '') {
  return { tpAmb: ctx.d.tpAmb, verAplic: VER_APLIC_SIMULADOR, cStat, xMotivo: motivo(cStat, complemento) };
}

/**
 * As tags do cabeçalho na ordem do leiaute: `tpAmb`, `verAplic`, [`meio`], `cStat`, `xMotivo`. O `meio` é o que o
 * leiaute põe entre `verAplic` e `cStat` (`nRec` no recibo, `cOrgao` no evento).
 */
export function tagsRetorno(r: { tpAmb: number; verAplic: string; cStat: string; xMotivo: string }, meio = ''): string {
  return `${tag('tpAmb', r.tpAmb)}${tag('verAplic', r.verAplic)}${meio}${tag('cStat', r.cStat)}${tag('xMotivo', r.xMotivo)}`;
}

/** Tolerância de relógio entre emissor e SEFAZ (703/578): 5 minutos. Atraso máximo da emissão (228): 30 dias. */
export const TOLERANCIA_FUTURO_MS = 5 * 60_000;
export const ATRASO_MAXIMO_EMISSAO_MS = 30 * 86_400_000;
/** Prazo do cancelamento (501): 24 horas da autorização. */
export const PRAZO_CANCELAMENTO_MS = 24 * 3_600_000;

/**
 * Conversa com o "webservice": aplica os controles de teste. Paralisado: só o `statusServico` responde (108/109); o
 * resto falha como rede (o worker aciona a contingência, desenho §3.4). `falharTransporte`: falha antes de processar
 * ou depois (a resposta "se perde": a nota fica autorizada e o worker precisa consultar o protocolo, desenho §3.3).
 */
export async function conversa<T>(ctx: Contexto, servico: string, fn: () => Promise<T>): Promise<T> {
  const c = ctx.estado.controles;
  if (c.paralisacao) throw new FalhaTransporteSefaz(servico, true, `servico paralisado no simulador (${c.paralisacao})`);
  if (c.falhas.restantes <= 0) return fn();
  c.falhas.restantes -= 1;
  if (!c.falhas.aposProcessar) throw new FalhaTransporteSefaz(servico, true, 'falha de transporte simulada antes do processamento');
  await fn();
  throw new FalhaTransporteSefaz(servico, true, 'falha de transporte simulada depois do processamento (resposta perdida)');
}

/**
 * A rejeição forçada pelo apoio de teste para esta operação, se houver: devolve o `cStat` e desfaz o controle (vale
 * só para um envio). Chamada dentro da `conversa`, então a falha de transporte "antes de processar" não a consome.
 */
export function consumirRejeicao(ctx: Contexto, operacao: OperacaoRejeitavel): CStatSimulador | null {
  const r = ctx.estado.controles.rejeicoes;
  const cStat = r.get(operacao);
  if (cStat === undefined) return null;
  r.delete(operacao);
  return cStat as CStatSimulador;
}
