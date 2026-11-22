import { CHAVE_ACESSO_REGEX, type TipoEmissao } from '../contracts';

/**
 * Chave de acesso da NF-e (Manual de Orientação do Contribuinte, 44 dígitos):
 * cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
 */
export const CUF_AM = '13';
export const MODELO_NFE = '55';

const pad = (valor: number | string, n: number): string => String(valor).padStart(n, '0');

/**
 * DV módulo 11, pesos 2..9 da direita para a esquerda; resto 0 ou 1 vira DV 0 (Manual).
 * CNPJ alfanumérico (NT 2025.001): cada caractere vale seu código ASCII − 48 (dígito = ele mesmo, A = 17 ... Z = 42).
 */
export function dvModulo11(base: string): number {
  if (!/^[0-9A-Z]+$/.test(base)) throw new RangeError('dvModulo11: só dígitos e letras maiúsculas');
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += (base.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export interface DadosChave {
  /** AAMM da emissão (use `aammManaus`). */
  aamm: string;
  cnpj: string;
  serie: number;
  numero: number;
  tpEmis: TipoEmissao;
  cnf: string;
}

/** Monta a chave de 44 dígitos (cUF fixo 13 = AM, modelo 55). */
export function montarChave(d: DadosChave): string {
  if (!/^\d{4}$/.test(d.aamm)) throw new RangeError('chave: AAMM inválido');
  if (!/^[A-Z0-9]{12}\d{2}$/.test(d.cnpj)) throw new RangeError('chave: CNPJ deve ter 12 posições alfanuméricas (A-Z, 0-9) e 2 dígitos de DV');
  if (!Number.isInteger(d.serie) || d.serie < 0 || d.serie > 999) throw new RangeError('chave: série fora de 0..999');
  if (!Number.isInteger(d.numero) || d.numero < 1 || d.numero > 999_999_999) throw new RangeError('chave: nNF fora de 1..999999999');
  if (!/^\d{8}$/.test(d.cnf)) throw new RangeError('chave: cNF deve ter 8 dígitos');
  const base = `${CUF_AM}${d.aamm}${d.cnpj}${MODELO_NFE}${pad(d.serie, 3)}${pad(d.numero, 9)}${d.tpEmis}${d.cnf}`;
  return `${base}${dvModulo11(base)}`;
}

export function chaveValida(chave: string): boolean {
  return CHAVE_ACESSO_REGEX.test(chave) && dvModulo11(chave.slice(0, 43)) === Number(chave[43]);
}

/** Instante deslocado para UTC−4 (Manaus, sem horário de verão): ler com os getters UTC. */
export const instanteManaus = (instante: Date): Date => new Date(instante.getTime() - 4 * 3_600_000);

/** AAMM no fuso de Manaus. */
export function aammManaus(instante: Date): string {
  const local = instanteManaus(instante);
  return `${pad(local.getUTCFullYear() % 100, 2)}${pad(local.getUTCMonth() + 1, 2)}`;
}

/** Sorteio com Web Crypto (sem importar módulo do Node no domain). */
function sorteioSeguro(): number {
  return (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) % 100_000_000;
}

/** cNF de 8 dígitos, diferente do nNF (o Manual veda código igual ao número). `sorteio` injetável para teste. */
export function gerarCnf(numero: number, sorteio: () => number = sorteioSeguro): string {
  const nnf = pad(numero, 8);
  for (let i = 0; i < 20; i++) {
    const cnf = pad(sorteio(), 8);
    // 00000000 também não é usado; e `cNF = nNF` (8 últimos dígitos) é proibido.
    if (cnf !== nnf && cnf !== '00000000') return cnf;
  }
  throw new Error('cnf: sorteio não produziu um código válido');
}
