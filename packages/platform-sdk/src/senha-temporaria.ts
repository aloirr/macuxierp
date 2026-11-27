/**
 * Senha temporária e provisória (44 B, v0.3.20; decisão do PO retransmitida pelo gerente em 27/11): fonte única do
 * alfabeto, do tamanho e do gerador para a apps/api (o "esqueci a senha"), o modulo-core (a provisória do 1º acesso) e o
 * scripts/deploy/producao/operador.sh (cópia em bash, travada pelo apps/api/src/operador-senha.test.ts).
 * - Só letras e números, sem os caracteres que se confundem: 0/O/o, 1/I/i/l, 2/Z, 5/S e 8/B.
 * - 18 caracteres, com pelo menos um de cada classe: 48 símbolos, cerca de 100 bits.
 * - Isenta da regra "especial" (RN da 44 B): é trocada no primeiro acesso. A regra da senha escolhida pelo usuário
 *   (`REGRAS_SENHA`, `senha.ts`) não muda.
 * Sem Node: o sorteio vem de fora (a API passa o `crypto.randomInt`), para a função seguir pura.
 */
import { regrasDescumpridas, type RegraSenhaId } from './senha';

export const MAIUSCULAS_SENHA_TEMPORARIA = 'ACDEFGHJKMNPQRTUVWXY';
export const MINUSCULAS_SENHA_TEMPORARIA = 'abcdefghjkmnpqrstuvwxyz';
export const DIGITOS_SENHA_TEMPORARIA = '34679';
export const CLASSES_SENHA_TEMPORARIA = Object.freeze([MAIUSCULAS_SENHA_TEMPORARIA, MINUSCULAS_SENHA_TEMPORARIA, DIGITOS_SENHA_TEMPORARIA] as const);
export const ALFABETO_SENHA_TEMPORARIA = CLASSES_SENHA_TEMPORARIA.join('');
export const TAMANHO_SENHA_TEMPORARIA = 18;

/** Inteiro uniforme em [0, n), de um gerador criptográfico (na API, `crypto.randomInt`). */
export type Sortear = (n: number) => number;

/** Um de cada classe, o resto do alfabeto inteiro e Fisher-Yates: nenhuma classe some e a posição de cada uma varia. */
export function gerarSenhaTemporaria(sortear: Sortear): string {
  const de = (alfabeto: string) => alfabeto[sortear(alfabeto.length)]!;
  const c = [
    ...CLASSES_SENHA_TEMPORARIA.map(de),
    ...Array.from({ length: TAMANHO_SENHA_TEMPORARIA - CLASSES_SENHA_TEMPORARIA.length }, () => de(ALFABETO_SENHA_TEMPORARIA)),
  ];
  for (let i = c.length - 1; i > 0; i--) {
    const k = sortear(i + 1);
    [c[i], c[k]] = [c[k]!, c[i]!];
  }
  return c.join('');
}

/** As regras que a senha temporária precisa cumprir: as do usuário, menos a "especial" (a isenção da 44 B). */
const REGRAS_ISENTAS_SENHA_TEMPORARIA: readonly RegraSenhaId[] = Object.freeze(['especial']);

/** Ids das regras que a temporária descumpre (vazio = cumpre). Função pura. */
export function regrasDescumpridasTemporaria(senha: string): RegraSenhaId[] {
  return regrasDescumpridas(senha).filter((r) => !REGRAS_ISENTAS_SENHA_TEMPORARIA.includes(r));
}

/** A temporária no formato do gerador: o tamanho, só o alfabeto e uma de cada classe. */
export function senhaTemporariaNoFormato(senha: string): boolean {
  const c = [...senha];
  return (
    c.length === TAMANHO_SENHA_TEMPORARIA &&
    c.every((x) => ALFABETO_SENHA_TEMPORARIA.includes(x)) &&
    CLASSES_SENHA_TEMPORARIA.every((classe) => c.some((x) => classe.includes(x)))
  );
}
