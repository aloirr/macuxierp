/**
 * Pagamento e cobrança da NF-e (RF-FAT-01): indPag pelo critério único de "à vista" do cadastros (`ehAVista`), detPag pela
 * `forma_tpag` do pedido, `card` nos cartões e `cobr/dup` só no boleto (`classeForma` do cadastros). Funções puras; centavos; datas civis de Manaus.
 */
import { classeForma, ehAVista } from '@macuxierp/cadastros/contracts';
import { centavos, ratear } from '@macuxierp/platform-sdk';
import { instanteManaus } from './fuso';

export const TPAG_NAO_INFORMADO = '99';
export const XPAG_NAO_INFORMADO = 'Conforme condição combinada';
/** tPag do cartão de débito: o cadastros o classifica como à vista, mas o leiaute exige o grupo `card` nele também. */
const TPAG_DEBITO = '04';

export interface PagamentoXml {
  /** 0 à vista, 1 a prazo (`ehAVista` do cadastros). */
  indPag: 0 | 1;
  tPag: string;
  xPag?: string;
  valor_centavos: number;
  /** tpIntegra 2: pagamento não integrado ao sistema de automação da empresa (a v1 não integra TEF). */
  /** Fora do XML hoje: o emissor (T-0018) não o monta e o `card` é opcional no modelo 55. Fica só no conteúdo gravado. */
  card?: { tpIntegra: 1 | 2 };
}
export interface ParcelaCobranca {
  /** nDup: 001, 002... */
  nDup: string;
  /** AAAA-MM-DD */
  vencimento: string;
  valor_centavos: number;
}
export interface CobrancaXml {
  nFat: string;
  vOrig: number;
  vLiq: number;
  parcelas: ParcelaCobranca[];
}

/** Soma `dias` a uma data civil AAAA-MM-DD (UTC puro, sem fuso). */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export interface EntradaPagamento {
  /** Da condição de pagamento do pedido; nulo = sem condição (tPag 99). */
  forma_tpag: string | null;
  prazos_dias: readonly number[] | null;
  total_centavos: number;
  emissao: Date;
  numero: number;
}

export function montarPagamento(e: EntradaPagamento): { pagamentos: PagamentoXml[]; cobranca: CobrancaXml | null } {
  const informada = e.forma_tpag !== null;
  const tPag = e.forma_tpag ?? TPAG_NAO_INFORMADO;
  const prazos = e.prazos_dias && e.prazos_dias.length > 0 ? [...e.prazos_dias] : [0];
  const indPag: 0 | 1 = ehAVista({ forma_tpag: tPag }) ? 0 : 1;
  const pagamento: PagamentoXml = {
    indPag,
    tPag,
    ...(informada ? {} : { xPag: XPAG_NAO_INFORMADO }),
    valor_centavos: e.total_centavos,
    ...(classeForma(tPag) === 'cartao' || tPag === TPAG_DEBITO ? { card: { tpIntegra: 2 as const } } : {}),
  };
  let cobranca: CobrancaXml | null = null;
  if (classeForma(tPag) === 'boleto' && e.total_centavos > 0) {
    const emissao = instanteManaus(e.emissao).toISOString().slice(0, 10);
    const valores = ratear(centavos(e.total_centavos), prazos.length);
    cobranca = {
      nFat: String(e.numero),
      vOrig: e.total_centavos,
      vLiq: e.total_centavos,
      parcelas: prazos.map((p, i) => ({ nDup: String(i + 1).padStart(3, '0'), vencimento: somarDias(emissao, p), valor_centavos: valores[i] ?? 0 })),
    };
  }
  return { pagamentos: [pagamento], cobranca };
}

/** modFrete do XML: CIF por conta do emitente (0), FOB do destinatário (1), sem frete no pedido (9). */
export function modFreteDoPedido(frete: { modalidade: 'CIF' | 'FOB' } | null | undefined): 0 | 1 | 9 {
  if (!frete) return 9;
  return frete.modalidade === 'CIF' ? 0 : 1;
}
