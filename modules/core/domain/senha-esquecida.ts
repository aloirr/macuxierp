/**
 * "Esqueci a senha" (RN-CORE-13): senha temporária de uso único, em paralelo à senha atual, com validade em horas.
 * A senha mínima (8 caracteres) e a temporária gerada vêm de RN-CORE-10 (`regrasDescumpridas` do SDK e
 * `gerarSenhaProvisoria` em `usuarios.ts`); nada é duplicado aqui.
 */

export interface UsuarioSenhaEsquecida {
  ativo: boolean;
  excluido: boolean;
}

export type MotivoSemEnvio = 'usuario_inexistente' | 'usuario_inativo' | 'empresa_inativa';

export type AvaliacaoPedidoSenha = { enviar: true } | { enviar: false; motivo: MotivoSemEnvio };

/** RN-CORE-13: só envia para usuário existente, ativo e não excluído, em empresa ativa. O chamador responde igual nos dois casos. */
export function avaliarPedidoSenhaEsquecida(usuario: UsuarioSenhaEsquecida | null, empresa: { situacao: string }): AvaliacaoPedidoSenha {
  if (!usuario) return { enviar: false, motivo: 'usuario_inexistente' };
  if (!usuario.ativo || usuario.excluido) return { enviar: false, motivo: 'usuario_inativo' };
  if (empresa.situacao !== 'ativo') return { enviar: false, motivo: 'empresa_inativa' };
  return { enviar: true };
}

/** RN-CORE-13: instante em que a temporária deixa de valer. */
export function expiraEm(agora: Date, horas: number): Date {
  if (!Number.isFinite(horas) || horas <= 0) throw new RangeError('expiraEm: horas deve ser positivo');
  return new Date(agora.getTime() + horas * 3_600_000);
}

/** RN-CORE-13: vale antes do instante de expiração; sem temporária emitida, não vale. */
export function temporariaValida(expiraEmInstante: Date | null, agora: Date): boolean {
  return expiraEmInstante !== null && agora.getTime() < expiraEmInstante.getTime();
}
