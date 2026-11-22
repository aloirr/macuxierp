/**
 * Títulos a receber (RF-FAT-07, RN-FAT-06). Funções puras; centavos; datas civis de Manaus. Só o boleto gera título
 * (decisão do Alexandre de 22/11): cartão e à vista não. Saldo = valor − baixas não estornadas (igual ao trigger da 0013).
 */
import { classeForma, type ClasseForma } from '@macuxierp/cadastros/contracts';
import { centavos, ratear } from '@macuxierp/platform-sdk';
import type { Ambiente, StatusTitulo, TituloBaixadoPayload, TituloGeradoPayload, TituloResumo } from '../contracts';
import { dataCivilManaus } from './fuso';
import { somarDias } from './pagamento';
import { ErroViolacao, violacao, type Violacao } from './violacao';

export interface NotaParaTitulos {
  id: string;
  pedido_id: string;
  cliente_id: string;
  ambiente: Ambiente;
  numero: number;
  serie: number;
  total_centavos: number;
  emissao: Date;
  status: string;
}
export interface CondicaoParaTitulos {
  prazos_dias: readonly number[];
}
export interface ParcelaGerada {
  parcela: number;
  total_parcelas: number;
  vencimento: string;
  valor_centavos: number;
  ambiente: Ambiente;
}
/** O saldo inicial (= valor) nasce no gatilho do banco, não na parcela gerada (RD-0603); baixar e estornar continuam validando aqui. */
export type Titulo = Pick<TituloResumo, 'id' | 'nota_id' | 'ambiente' | 'parcela' | 'total_parcelas' | 'vencimento' | 'valor_centavos' | 'saldo_centavos' | 'status'>;
export type { StatusTitulo };
export interface BaixaTitulo {
  id: string;
  valor_centavos: number;
  estornada: boolean;
}

/**
 * Bandeira por filial "faturamento real com NF-e simulada" (desligada por padrão): com ela ligada, a nota de HOMOLOGAÇÃO conta como real para o FDV
 * (`conta_como_real: true` nos payloads). A nota continua de homologação no XML (tpAmb 2, "SEM VALOR FISCAL"); em produção a bandeira não muda nada.
 */
export const contaComoReal = (ambiente: Ambiente, bandeira: boolean): boolean => bandeira && ambiente === 'homologacao';

/** RN-FAT-06 (doc 03): só estes perfis baixam e estornam título. A ação de permissão própria depende do `platform-sdk`; até lá a rota confere isto. */
const PERFIS_BAIXA_TITULO = ['administrador', 'gerente', 'faturista'] as const;
export const podeBaixarTitulo = (perfil: string): boolean => (PERFIS_BAIXA_TITULO as readonly string[]).includes(perfil);

/** Prazos em dias da nota: os gravados no conteúdo; sem eles (nota antiga), deduzidos dos vencimentos da cobrança contra a data civil de emissão. */
export function prazosDaNota(prazos: readonly number[] | null | undefined, cobranca: { parcelas: readonly { vencimento: string }[] } | null, emissao: Date): number[] {
  if (prazos && prazos.length > 0) return [...prazos];
  const dia = dataCivilManaus(emissao);
  return (cobranca?.parcelas ?? []).map((p) => Math.round((Date.parse(`${p.vencimento}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`)) / 86_400_000));
}

const rn = (campo: string, msg: string) => new ErroViolacao([violacao('RN-FAT-06', campo, msg)]);

/** RN-FAT-06: uma parcela por prazo só no boleto; rateio sem perder centavo (RN-CORE-03). Outras classes: lista vazia. */
export function gerarParcelas(nota: NotaParaTitulos, condicao: CondicaoParaTitulos, classe: ClasseForma | null): ParcelaGerada[] {
  if (classe !== 'boleto') return [];
  if (nota.status !== 'autorizada') throw new ErroViolacao([violacao('RN-FAT-03', 'nota.status', 'título só de nota autorizada')]);
  const prazos = condicao.prazos_dias;
  if (prazos.length === 0) throw rn('prazos_dias', 'a condição do boleto precisa de ao menos um prazo');
  if (nota.total_centavos < prazos.length) throw rn('total_centavos', 'o total da nota não cobre um centavo por parcela');
  const emissao = dataCivilManaus(nota.emissao);
  const valores = ratear(centavos(nota.total_centavos), prazos.length);
  return prazos.map((p, i) => ({
    parcela: i + 1,
    total_parcelas: prazos.length,
    vencimento: somarDias(emissao, p),
    valor_centavos: valores[i] ?? 0,
    ambiente: nota.ambiente,
  }));
}

/**
 * RN-FAT-06, ANTES de reservar o número: o boleto precisa de prazos na condição de pagamento e de ao menos um centavo por parcela.
 * Sem isto a nota autorizaria sem título (a geração depois da autorização nunca bloqueia a nota). Cartão, à vista e forma desconhecida não geram título.
 */
export function validarTitulosDoBoleto(e: { forma_tpag: string | null; prazos_dias: readonly number[] | null; total_centavos: number }): Violacao[] {
  if (!e.forma_tpag || classeForma(e.forma_tpag) !== 'boleto') return [];
  const prazos = e.prazos_dias ?? [];
  if (prazos.length === 0) return [violacao('RN-FAT-06', 'condicao_pagamento_id', 'A condição de pagamento do boleto não tem prazos.')];
  if (e.total_centavos < prazos.length) return [violacao('RN-FAT-06', 'total', `O total da nota (${e.total_centavos}) não cobre um centavo por parcela (${prazos.length} parcelas).`)];
  return [];
}

const statusDoSaldo = (saldo: number): StatusTitulo => (saldo === 0 ? 'baixado' : 'aberto');

/** RN-FAT-06: baixa parcial ou total; valor inteiro > 0 e ≤ saldo; só título aberto. */
export function baixar(t: Titulo, valor: number, data: string): { saldo_centavos: number; status: StatusTitulo; baixa: { valor_centavos: number; data: string } } {
  if (t.status !== 'aberto') throw rn('status', `título ${t.status} não recebe baixa`);
  if (!Number.isInteger(valor) || valor <= 0) throw rn('valor_centavos', 'o valor da baixa deve ser inteiro maior que zero');
  if (valor > t.saldo_centavos) throw rn('valor_centavos', 'o valor da baixa não pode passar do saldo');
  const saldo = t.saldo_centavos - valor;
  return { saldo_centavos: saldo, status: statusDoSaldo(saldo), baixa: { valor_centavos: valor, data } };
}

/** RN-FAT-06: estorno marca a baixa e recalcula saldo = valor − baixas não estornadas; o título baixado reabre. */
export function estornarBaixa(t: Titulo, baixas: readonly BaixaTitulo[], baixaId: string): { saldo_centavos: number; status: StatusTitulo; baixas: BaixaTitulo[] } {
  if (t.status === 'cancelado') throw rn('status', 'título cancelado não tem estorno');
  const alvo = baixas.find((b) => b.id === baixaId);
  if (!alvo) throw rn('baixa_id', 'baixa não encontrada neste título');
  if (alvo.estornada) throw rn('baixa_id', 'baixa já estornada');
  const novas = baixas.map((b) => (b.id === baixaId ? { ...b, estornada: true } : b));
  const saldo = t.valor_centavos - novas.filter((b) => !b.estornada).reduce((a, b) => a + b.valor_centavos, 0);
  return { saldo_centavos: saldo, status: statusDoSaldo(saldo), baixas: novas };
}

/**
 * RN-FAT-06: nota cancelada cancela os títulos abertos sem baixa. A SEFAZ já cancelou a nota, então o cancelamento NUNCA é bloqueado:
 * título com baixa (parcial ou total) fica como está e é devolvido em `divergentes`, para o financeiro tratar. Os já cancelados são
 * ignorados. O banco só aceita cancelar título 'aberto'.
 */
export function cancelarTitulosDaNota(titulos: readonly Titulo[]): { cancelar: string[]; divergentes: { id: string; parcela: number }[] } {
  const comBaixa = (t: Titulo): boolean => t.status === 'baixado' || (t.status === 'aberto' && t.saldo_centavos < t.valor_centavos);
  return {
    cancelar: titulos.filter((t) => t.status === 'aberto' && !comBaixa(t)).map((t) => t.id),
    divergentes: titulos.filter(comBaixa).map((t) => ({ id: t.id, parcela: t.parcela })),
  };
}

/** Payload de `faturamento.titulo.gerado@1`; o agregado do evento é `titulo.id`. */
export function payloadTituloGerado(nota: NotaParaTitulos, t: Titulo, comoReal = false): TituloGeradoPayload {
  return {
    titulo_id: t.id,
    nota_id: nota.id,
    pedido_id: nota.pedido_id,
    cliente_id: nota.cliente_id,
    ambiente: t.ambiente,
    numero: nota.numero,
    serie: nota.serie,
    parcela: t.parcela,
    total_parcelas: t.total_parcelas,
    emissao: dataCivilManaus(nota.emissao),
    vencimento: t.vencimento,
    valor_centavos: t.valor_centavos,
    saldo_centavos: t.saldo_centavos,
    ...(comoReal ? { conta_como_real: true } : {}),
  } as TituloGeradoPayload;
}

/** Payload de `faturamento.titulo.baixado@1`: o título já com o saldo após a baixa. */
export function payloadTituloBaixado(nota: NotaParaTitulos, tituloAposBaixa: Titulo, valorBaixado: number, baixadoEm: string, comoReal = false): TituloBaixadoPayload {
  return { ...payloadTituloGerado(nota, tituloAposBaixa, comoReal), baixado_em: baixadoEm, valor_baixado_centavos: valorBaixado } as TituloBaixadoPayload;
}
