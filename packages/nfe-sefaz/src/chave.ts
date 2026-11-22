/**
 * Chave de acesso da NF-e (44 posições, Manual de Orientação do Contribuinte): cUF(2) AAMM(4) CNPJ(14) mod(2)
 * serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1). O DV é o módulo 11 com pesos 2 a 9 da direita para a esquerda; resto 0 ou
 * 1 dá DV 0. CNPJ alfanumérico (jul/2026): cada caractere vale o código ASCII menos 48, como no DV do CNPJ.
 * Montagem (emissor, T-0018) e conferência (simulador, faturamento) usam estas funções; ninguém refaz a conta.
 */

export interface CamposChaveNFe {
  cUF: number;
  /** Ano e mês da emissão (`AAMM`). */
  aamm: string;
  /** CNPJ do emitente (14 posições; numérico ou alfanumérico). */
  cnpj: string;
  mod: '55';
  serie: number;
  nNF: number;
  tpEmis: number;
  /** Código numérico (8 dígitos) que compõe a chave. */
  cNF: string;
}

const RE_CHAVE = /^(\d{2})(\d{4})([0-9A-Z]{12}\d{2})(55)(\d{3})(\d{9})(\d)(\d{8})(\d)$/;

/** DV da chave a partir das 43 primeiras posições. */
export function dvChaveNFe(chave43: string): number {
  if (!/^[0-9A-Z]{43}$/.test(chave43)) throw new RangeError('dvChaveNFe: esperava 43 posições');
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += (chave43.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Monta a chave de 44 posições com o DV. Lança `RangeError` com campo fora do tamanho. */
export function montarChaveNFe(c: CamposChaveNFe): string {
  const pad = (v: number | string, n: number, campo: string) => {
    const s = String(v).padStart(n, '0');
    if (s.length !== n) throw new RangeError(`montarChaveNFe: ${campo} fora de ${n} posições`);
    return s;
  };
  if (!/^\d{4}$/.test(c.aamm)) throw new RangeError('montarChaveNFe: aamm deve ter 4 dígitos');
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c.cnpj)) throw new RangeError('montarChaveNFe: CNPJ deve ter 14 posições');
  if (!/^\d{8}$/.test(c.cNF)) throw new RangeError('montarChaveNFe: cNF deve ter 8 dígitos');
  const base =
    pad(c.cUF, 2, 'cUF') + c.aamm + c.cnpj + c.mod + pad(c.serie, 3, 'serie') + pad(c.nNF, 9, 'nNF') + pad(c.tpEmis, 1, 'tpEmis') + c.cNF;
  return `${base}${dvChaveNFe(base)}`;
}

/** Decompõe a chave. `null` se o formato não for o da NF-e 55; o DV não é conferido aqui (ver `chaveNFeComDvValido`). */
export function lerChaveNFe(chave: string): (CamposChaveNFe & { cDV: number }) | null {
  const m = RE_CHAVE.exec(chave);
  if (!m) return null;
  return {
    cUF: Number(m[1]),
    aamm: m[2]!,
    cnpj: m[3]!,
    mod: '55',
    serie: Number(m[5]),
    nNF: Number(m[6]),
    tpEmis: Number(m[7]),
    cNF: m[8]!,
    cDV: Number(m[9]),
  };
}

export function chaveNFeComDvValido(chave: string): boolean {
  const c = lerChaveNFe(chave);
  return c !== null && dvChaveNFe(chave.slice(0, 43)) === c.cDV;
}
