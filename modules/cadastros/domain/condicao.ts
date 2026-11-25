import { MAX_DIAS, MAX_PARCELAS, MAX_PARCELAS_CARTAO, classeForma, type ClasseForma } from '../contracts';
import { violacao, type Violacao } from './violacao';

/**
 * RN-CAD-09 (decisão de 22/11, emendada pela RN-CAD-15): a classe da forma sai do tPag (`classeForma`, contracts). Mensagens curtas e fixas:
 * nunca ecoam o valor digitado, por isso a API e a carga usam estas mesmas constantes.
 */
export const MOTIVO_FORMA_NAO_ACEITA = 'forma não aceita: use Dinheiro, PIX, Cartão ou Boleto';
export const MOTIVO_A_VISTA = 'à vista: uma única parcela com 0 dia';
export const MOTIVO_CARTAO_PRAZOS = `cartão: 1 a ${MAX_PARCELAS_CARTAO} parcelas de 0 a ${MAX_DIAS} dias`;
export const MOTIVO_PARCELAS_FORMA = 'cartão exige parcelas e as demais formas não as têm';
export const MOTIVO_BOLETO = `boleto: 1 a ${MAX_PARCELAS} parcelas de 0 a ${MAX_DIAS} dias`;
/** RN-CAD-15 */
export const MOTIVO_PRAZO_MEDIO = `Prazo médio: inteiro de 0 a ${MAX_DIAS} dias`;
export const MOTIVO_PRAZO_MEDIO_A_VISTA = 'à vista: prazo médio igual a 0';
export const MOTIVO_DESCRICAO = 'descrição obrigatória';

/** RN-CAD-09: máximo de parcelas por classe da forma (à vista 1, cartão 12, boleto 24). */
export const MAX_PARCELAS_DA_CLASSE: Record<ClasseForma, number> = { a_vista: 1, cartao: MAX_PARCELAS_CARTAO, boleto: MAX_PARCELAS };

export interface EntradaCondicao {
  forma_tpag: string;
  prazos_dias?: readonly number[] | null;
  /** Legado: o domain deriva das parcelas do cartão (`derivarParcelasCartao`). */
  parcelas_cartao?: number | null;
  /** RN-CAD-15 (decisão 14 A): vazio (`undefined` ou `null`) é aceito, porque o ERP o preenche (`prazoMedioEfetivo`); só o valor fora de 0..365 recusa. */
  prazo_medio_dias?: number | null;
  /** Só confere quando vem (o PATCH parcial pode não trazer). */
  descricao?: string | null;
}

/** `parcelas_cartao` gravado: o número de parcelas no cartão (tPag 03) e nulo nas demais formas (CHECK 0019 do banco). */
export const derivarParcelasCartao = (c: { forma_tpag: string; prazos_dias?: readonly number[] | null }): number | null => {
  const n = (c.prazos_dias ?? []).length;
  // fora de 1..12 fica nulo: quem recusa é `validarCondicaoPagamento`, no campo `prazos_dias`
  return classeForma(c.forma_tpag) === 'cartao' && n >= 1 && n <= MAX_PARCELAS_CARTAO ? n : null;
};

const diasValidos = (p: unknown): boolean => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= MAX_DIAS;

/**
 * RN-CAD-15 e decisão 14 A (Alexandre, R-20261125-154127): prazo médio efetivo da condição. Número (inclusive 0) vale ele mesmo; vazio
 * (nulo ou ausente) vira a média simples das parcelas, arredondada meio para cima (`Math.floor(soma / n + 0.5)`); sem parcelas, `null`.
 * O resultado fica entre a menor e a maior parcela, como o Hub exige.
 */
export function prazoMedioEfetivo(prazos_dias: readonly number[] | null | undefined, prazo_medio_dias?: number | null): number | null {
  if (typeof prazo_medio_dias === 'number') return prazo_medio_dias;
  const p = prazos_dias ?? [];
  if (p.length === 0) return null;
  return Math.floor(p.reduce((a, b) => a + b, 0) / p.length + 0.5);
}

/**
 * RN-CAD-15 (decisão 14 A): preenche `prazo_medio_dias` vazio antes de gravar. Criação (sem `antes`): sempre que vier vazio e houver parcelas.
 * PATCH (`antes` = gravado): só quando o corpo muda as parcelas, o corpo não traz prazo médio numérico e o gravado está vazio ou o corpo
 * o esvazia (`null`); prazo digitado nunca é sobrescrito e, sem mudança de parcelas, o corpo volta como veio.
 */
export function completarPrazoMedio<T extends { prazos_dias?: readonly number[] | null; prazo_medio_dias?: number | null }>(
  corpo: T, antes?: { prazos_dias: readonly number[]; prazo_medio_dias?: number | null },
): T {
  if (typeof corpo.prazo_medio_dias === 'number') return corpo;
  if (antes) {
    if (corpo.prazos_dias === undefined || corpo.prazos_dias === null) return corpo;
    if (corpo.prazo_medio_dias === undefined && typeof antes.prazo_medio_dias === 'number') return corpo;
  }
  const efetivo = prazoMedioEfetivo(corpo.prazos_dias ?? antes?.prazos_dias, null);
  return efetivo === null ? corpo : { ...corpo, prazo_medio_dias: efetivo };
}

/** RN-CAD-15 (completa a RN-CAD-09): código, descrição, parcelas uma a uma e prazo médio (vazio é preenchido, decisão 14 A); à vista = parcelas [0] e prazo médio 0. */
export function validarCondicaoPagamento(c: EntradaCondicao): Violacao[] {
  const prazos = c.prazos_dias ?? [];
  const parcelas = c.parcelas_cartao ?? null;
  const classe = classeForma(c.forma_tpag);
  if (classe === null) return [violacao('RN-CAD-09', 'forma_tpag', MOTIVO_FORMA_NAO_ACEITA)];
  const erros: Violacao[] = [];
  if (c.descricao !== undefined && (c.descricao === null || c.descricao.trim() === '')) erros.push(violacao('RN-CAD-15', 'descricao', MOTIVO_DESCRICAO));
  const medio = c.prazo_medio_dias;
  if (medio !== undefined && medio !== null && !diasValidos(medio)) erros.push(violacao('RN-CAD-15', 'prazo_medio_dias', MOTIVO_PRAZO_MEDIO));
  else if (classe === 'a_vista' && medio !== null && medio !== undefined && medio !== 0) erros.push(violacao('RN-CAD-15', 'prazo_medio_dias', MOTIVO_PRAZO_MEDIO_A_VISTA));
  switch (classe) {
    case 'a_vista':
      if (parcelas !== null || prazos.length !== 1 || prazos[0] !== 0) erros.push(violacao('RN-CAD-15', 'prazos_dias', MOTIVO_A_VISTA));
      break;
    case 'cartao':
      if (prazos.length < 1 || prazos.length > MAX_PARCELAS_DA_CLASSE.cartao || !prazos.every(diasValidos)) erros.push(violacao('RN-CAD-09', 'prazos_dias', MOTIVO_CARTAO_PRAZOS));
      else if (parcelas !== null && parcelas !== prazos.length) erros.push(violacao('RN-CAD-09', 'parcelas_cartao', MOTIVO_CARTAO_PRAZOS));
      break;
    case 'boleto':
      if (parcelas !== null) erros.push(violacao('RN-CAD-09', 'parcelas_cartao', MOTIVO_BOLETO));
      else if (prazos.length < 1 || prazos.length > MAX_PARCELAS_DA_CLASSE.boleto || !prazos.every(diasValidos)) erros.push(violacao('RN-CAD-09', 'prazos_dias', MOTIVO_BOLETO));
      break;
  }
  return erros;
}

/**
 * Grava `parcelas_cartao` derivada dos prazos na criação e no PATCH que muda a forma ou os prazos (o legado `parcelas_cartao` do corpo é
 * ignorado). `antes` é o cadastro gravado, no PATCH; sem mudança de forma nem de prazos o corpo volta como veio.
 */
export function completarParcelasCartao<T extends { forma_tpag?: string; prazos_dias?: readonly number[] | null }>(
  corpo: T, antes?: { forma_tpag: string; prazos_dias: readonly number[] },
): T & { parcelas_cartao?: number | null } {
  if (antes && corpo.forma_tpag === undefined && corpo.prazos_dias === undefined) return corpo;
  const mesclado = { forma_tpag: corpo.forma_tpag ?? antes?.forma_tpag ?? '', prazos_dias: corpo.prazos_dias ?? antes?.prazos_dias ?? [] };
  return { ...corpo, parcelas_cartao: derivarParcelasCartao(mesclado) };
}
