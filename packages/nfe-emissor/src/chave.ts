/**
 * Código numérico (cNF) da chave de acesso: o sorteio e a conferência. A montagem da chave e o DV são do
 * `@macuxierp/nfe-sefaz` (`montarChaveNFe`, `chaveNFeComDvValido`; RD-0293): aqui não se refaz a conta.
 *
 * Porte em TypeScript da lógica do sped-common/sped-nfe (`NFePHP\Common\Keys::cnfIsValid`), opção MIT, com
 * atribuição: Copyright (c) NFePHP — https://github.com/nfephp-org/sped-nfe (MIT, uma das licenças oferecidas).
 */
import { randomInt } from 'node:crypto';

/** Sequências que a SEFAZ recusa como cNF (sped-common `Keys::cnfIsValid`; regra de validação da chave B03). */
const CNF_PROIBIDOS = new Set([
  ...Array.from({ length: 10 }, (_, d) => String(d).repeat(8)),
  '12345678',
  '23456789',
  '34567890',
  '45678901',
  '56789012',
  '67890123',
  '78901234',
  '89012345',
  '90123456',
  '01234567',
]);

/** O cNF não pode repetir o nNF nem ser uma das sequências triviais. */
export function cnfValido(cNF: string, nNF: number): boolean {
  if (!/^\d{8}$/.test(cNF)) return false;
  if (Number(cNF) === nNF) return false;
  return !CNF_PROIBIDOS.has(cNF);
}

/** Sorteia um cNF válido. `aleatorio(max)` devolve inteiro em [0, max); injetável nos testes. */
export function gerarCNF(nNF: number, aleatorio: (max: number) => number = (max) => randomInt(max)): string {
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    const cNF = String(aleatorio(100_000_000)).padStart(8, '0');
    if (cnfValido(cNF, nNF)) return cNF;
  }
  throw new Error('gerarCNF: o gerador não produziu um cNF válido em 100 tentativas');
}
