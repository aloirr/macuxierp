/**
 * Log do motivo de um pedido do "Esqueci a senha" que não gera e-mail (T-0076; defeito R-20261124-222933). A resposta HTTP
 * continua o mesmo 202 neutro: o motivo só vai ao log do servidor, para a operação saber na VM por que nada saiu.
 * Um `info` "esqueci.sem_envio" com um código fixo. LGPD: sem e-mail, empresa, temporária, IP ou id de conta.
 * - `conta_inexistente_ou_inativa`: e-mail sem conta, ou conta inativa (tenant ou superadmin);
 * - `empresa_inexistente_ou_suspensa`: e-mail de usuário de empresa sem tenant ativo (suspensa ou encerrada);
 * - `email_desligado`: API sem a porta de e-mail (`esqueciSemEnvio`);
 * - `plataforma_indisponivel`: e-mail só de superadmin com o portal `/config` não montado na API.
 */
import type { FastifyBaseLogger } from 'fastify';

export type MotivoSemEnvioEsqueci = 'conta_inexistente_ou_inativa' | 'empresa_inexistente_ou_suspensa' | 'email_desligado' | 'plataforma_indisponivel';

export type LogEsqueci = Pick<FastifyBaseLogger, 'info'>;

export function registrarSemEnvio(log: LogEsqueci | undefined, motivo: MotivoSemEnvioEsqueci): void {
  try {
    log?.info({ evento: 'esqueci.sem_envio', motivo }, 'pedido de senha temporária sem envio');
  } catch {
    // o log nunca derruba o pedido
  }
}
