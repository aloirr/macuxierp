/**
 * Títulos a receber (RF-FAT-07, RN-FAT-06). Funções puras; centavos; datas civis de Manaus. Só o boleto gera título
 * (decisão do Alexandre de 22/11): cartão e à vista não. Saldo = valor − baixas não estornadas (igual ao trigger da 0013).
 */
import { type ClasseForma } from '@macuxierp/cadastros/contracts';
import { centavos, ratear } from '@macuxierp/platform-sdk';
import type { Ambiente, TituloBaixadoPayload, TituloGeradoPayload } from '../contracts';
import { instanteManaus } from './fuso';
import { somarDias } from './pagamento';
import { ErroViolacao, violacao } from './violacao';

export type StatusTitulo = 'aberto' | 'baixado' | 'cancelado';

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
  saldo_centavos: number;
  ambiente: Ambiente;
  /** RN-FAT-04: título de homologação não vai ao FDV. */
  vai_ao_fdv: boolean;
}
export interface Titulo {
  id: string;
  nota_id: string;
  ambiente: Ambiente;
  parcela: number;
  total_parcelas: number;
  vencimento: string;
  valor_centavos: number;
  saldo_centavos: number;
  status: StatusTitulo;
}
export interface BaixaTitulo {
  id: string;
  valor_centavos: number;
  estornada: boolean;
}

const rn = (campo: string, msg: string) => new ErroViolacao([violacao('RN-FAT-06', campo, msg)]);

/** RN-FAT-06: uma parcela por prazo só no boleto; rateio sem perder centavo (RN-CORE-03). Outras classes: lista vazia. */
export function gerarParcelas(nota: NotaParaTitulos, condicao: CondicaoParaTitulos, classe: ClasseForma | null): ParcelaGerada[] {
  if (classe !== 'boleto') return [];
  if (nota.status !== 'autorizada') throw new ErroViolacao([violacao('RN-FAT-03', 'nota.status', 'título só de nota autorizada')]);
  const prazos = condicao.prazos_dias;
  if (prazos.length === 0) throw rn('prazos_dias', 'a condição do boleto precisa de ao menos um prazo');
  if (nota.total_centavos < prazos.length) throw rn('total_centavos', 'o total da nota não cobre um centavo por parcela');
  const emissao = instanteManaus(nota.emissao).toISOString().slice(0, 10);
  const valores = ratear(centavos(nota.total_centavos), prazos.length);
  return prazos.map((p, i) => ({
    parcela: i + 1,
    total_parcelas: prazos.length,
    vencimento: somarDias(emissao, p),
    valor_centavos: valores[i] ?? 0,
    saldo_centavos: valores[i] ?? 0,
    ambiente: nota.ambiente,
    vai_ao_fdv: nota.ambiente === 'producao',
  }));
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
 * RN-FAT-06: nota cancelada cancela os títulos abertos sem baixa. Regra escolhida: título com baixa (parcial ou total) é
 * VIOLAÇÃO e bloqueia o cancelamento dos títulos da nota até o estorno das baixas (nada é cancelado parcialmente); os já
 * cancelados são ignorados. O banco só aceita cancelar título 'aberto'.
 */
export function cancelarTitulosDaNota(titulos: readonly Titulo[]): { cancelar: string[]; violacoes: ReturnType<typeof violacao>[] } {
  const violacoes = titulos
    .filter((t) => t.status === 'baixado' || (t.status === 'aberto' && t.saldo_centavos < t.valor_centavos))
    .map((t) => violacao('RN-FAT-06', `titulo.${t.parcela}`, `parcela ${t.parcela} tem baixa: estorne antes de cancelar a nota`));
  if (violacoes.length > 0) return { cancelar: [], violacoes };
  return { cancelar: titulos.filter((t) => t.status === 'aberto').map((t) => t.id), violacoes: [] };
}

/** Payload de `faturamento.titulo.gerado@1`; o agregado do evento é `titulo.id`. */
export function payloadTituloGerado(nota: NotaParaTitulos, t: Titulo): TituloGeradoPayload {
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
    emissao: instanteManaus(nota.emissao).toISOString().slice(0, 10),
    vencimento: t.vencimento,
    valor_centavos: t.valor_centavos,
    saldo_centavos: t.saldo_centavos,
  } as TituloGeradoPayload;
}

/** Payload de `faturamento.titulo.baixado@1`: o título já com o saldo após a baixa. */
export function payloadTituloBaixado(nota: NotaParaTitulos, tituloAposBaixa: Titulo, valorBaixado: number, baixadoEm: string): TituloBaixadoPayload {
  return { ...payloadTituloGerado(nota, tituloAposBaixa), baixado_em: baixadoEm, valor_baixado_centavos: valorBaixado } as TituloBaixadoPayload;
}
