/**
 * Conta bloqueada (RN-CORE-15): depois das tentativas erradas, só a temporária (RN-CORE-13) entra e desbloqueia;
 * a senha atual segue barrada. Vale igual para o tenant e para o superadmin (MACUXI); o aviso é o mesmo para qualquer
 * e-mail que estourar as tentativas, para não revelar se a conta existe. Sem dado pessoal nos textos fixos.
 */

export type ResultadoEntrada = 'entra' | 'entra_desbloqueando' | 'bloqueada' | 'falha';

/**
 * RN-CORE-15. `temporariaVigente`: o que foi digitado confere com uma temporária vigente (usa o hash dela).
 * `senhaConfere`: o que foi digitado confere com a senha atual ou com a temporária vigente. Quem chama distingue
 * qual das duas bateu (a temporária é consumida e leva à troca obrigatória), por isso 'entra' não precisa de valor próprio para ela.
 */
export function avaliarEntrada(e: { travada: boolean; temporariaVigente: boolean; senhaConfere: boolean }): ResultadoEntrada {
  if (e.travada) return e.temporariaVigente ? 'entra_desbloqueando' : 'bloqueada';
  return e.senhaConfere ? 'entra' : 'falha';
}

/** RN-CORE-15: resposta única de bloqueio (tenant e MACUXI); `acao` manda a tela oferecer "Recuperar a senha". */
export const RESPOSTA_CONTA_BLOQUEADA = {
  titulo: 'Conta bloqueada',
  mensagem: 'Você errou a senha muitas vezes. Para desbloquear, peça uma senha temporária.',
  acao: { rotulo: 'Recuperar a senha', destino: 'esqueci_senha' },
} as const;

/** RN-CORE-15: mostrada depois de entrar com a temporária numa conta que estava travada, junto do pedido da senha nova. */
export const TEXTO_CONTA_DESBLOQUEADA = 'Conta desbloqueada.';
