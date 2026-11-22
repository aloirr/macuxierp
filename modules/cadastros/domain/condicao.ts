import { MAX_DIAS, MAX_PARCELAS, MAX_PARCELAS_CARTAO, classeForma } from '../contracts';
import { violacao, type Violacao } from './violacao';

/**
 * RN-CAD-09 (decisão de 22/11): a classe da forma sai do tPag (`classeForma`, contracts). Mensagens curtas e fixas:
 * nunca ecoam o valor digitado, por isso a API e a carga usam estas mesmas constantes.
 */
export const MOTIVO_FORMA_NAO_ACEITA = 'forma não aceita: use Dinheiro, PIX, Cartão ou Boleto';
export const MOTIVO_A_VISTA = 'à vista: prazo único igual a 0 e sem parcelas de cartão';
export const MOTIVO_CARTAO_PARCELAS = `cartão: informe de 1 a ${MAX_PARCELAS_CARTAO} parcelas`;
export const MOTIVO_CARTAO_PRAZOS = 'cartão: prazos de 30 em 30 dias, um por parcela';
export const MOTIVO_PARCELAS_FORMA = 'cartão exige parcelas e as demais formas não as têm';
export const MOTIVO_BOLETO = `boleto: 1 a ${MAX_PARCELAS} parcelas de 0 a ${MAX_DIAS} dias e sem parcelas de cartão`;

/** Prazos do cartão de crédito em N parcelas: 30, 60, …, 30×N. */
export const prazosDoCartao = (parcelas: number): number[] => Array.from({ length: parcelas }, (_, i) => 30 * (i + 1));

const parcelasValidas = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PARCELAS_CARTAO;

export interface EntradaCondicao {
  forma_tpag: string;
  prazos_dias?: readonly number[] | null;
  parcelas_cartao?: number | null;
}

/** Cartão sem prazos: o domain gera os prazos das parcelas. Qualquer outro caso volta como veio. */
export function completarPrazos<T extends EntradaCondicao>(c: T): T & { prazos_dias?: readonly number[] | null } {
  if (classeForma(c.forma_tpag) === 'cartao' && parcelasValidas(c.parcelas_cartao) && (c.prazos_dias === undefined || c.prazos_dias === null || c.prazos_dias.length === 0)) {
    return { ...c, prazos_dias: prazosDoCartao(c.parcelas_cartao) };
  }
  return c;
}

/**
 * PATCH do cartão: se `parcelas_cartao` muda e `prazos_dias` não veio no corpo, os prazos são regerados (30×N).
 * `antes` é o cadastro gravado; o resto volta como veio.
 */
export function completarPrazosNoPatch<T extends Partial<EntradaCondicao>>(parcial: T, antes: { forma_tpag: string; parcelas_cartao?: number | null }): T & { prazos_dias?: readonly number[] | null } {
  const forma = parcial.forma_tpag ?? antes.forma_tpag;
  const n = parcial.parcelas_cartao;
  if (classeForma(forma) === 'cartao' && parcial.prazos_dias === undefined && parcelasValidas(n) && n !== (antes.parcelas_cartao ?? null)) {
    return { ...parcial, prazos_dias: prazosDoCartao(n) };
  }
  return parcial;
}

export function validarCondicaoPagamento(c: EntradaCondicao): Violacao[] {
  const prazos = c.prazos_dias ?? [];
  const parcelas = c.parcelas_cartao ?? null;
  switch (classeForma(c.forma_tpag)) {
    case 'a_vista':
      return parcelas !== null || prazos.length !== 1 || prazos[0] !== 0 ? [violacao('RN-CAD-09', 'prazos_dias', MOTIVO_A_VISTA)] : [];
    case 'cartao': {
      if (!parcelasValidas(parcelas)) return [violacao('RN-CAD-09', 'parcelas_cartao', MOTIVO_CARTAO_PARCELAS)];
      const gerado = prazosDoCartao(parcelas);
      return prazos.length !== gerado.length || prazos.some((p, i) => p !== gerado[i]) ? [violacao('RN-CAD-09', 'prazos_dias', MOTIVO_CARTAO_PRAZOS)] : [];
    }
    case 'boleto': {
      const ok = parcelas === null && prazos.length >= 1 && prazos.length <= MAX_PARCELAS && prazos.every((p) => Number.isInteger(p) && p >= 0 && p <= MAX_DIAS);
      return ok ? [] : [violacao('RN-CAD-09', parcelas !== null ? 'parcelas_cartao' : 'prazos_dias', MOTIVO_BOLETO)];
    }
    default:
      return [violacao('RN-CAD-09', 'forma_tpag', MOTIVO_FORMA_NAO_ACEITA)];
  }
}
