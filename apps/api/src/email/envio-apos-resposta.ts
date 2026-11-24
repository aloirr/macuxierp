/**
 * Envio de e-mail depois da resposta HTTP (T-0076, "esqueci a senha"): quem chama não espera nem vê a falha, para a resposta
 * ser igual com ou sem e-mail (sem enumerar usuário) e não atrasar. Quem solta o envio depois da resposta é o
 * `segundoPlanoAposResposta` (`auth/esqueci.ts`).
 * - nunca lança nem rejeita;
 * - 2 tentativas, com 2000 ms entre elas;
 * - `ErroEmailDesligado` não é falha: não tenta de novo e não loga;
 * - na falha final, um `warn` só com `evento` e `tentativas` (LGPD: sem destinatário, assunto, texto nem mensagem do erro). O código
 *   do SMTP já sai no log da porta (`porta.ts`), em cada tentativa, e não se repete aqui.
 */
import type { FastifyBaseLogger } from 'fastify';
import { type EnvioEmail, ErroEmailDesligado, type MensagemEmail } from './porta';

const TENTATIVAS = 2;
const ESPERA_PADRAO_MS = 2000;

/** Envia com as tentativas; resolve sempre (a falha final vira só o `warn`). */
export async function enviarComTentativas(
  envio: EnvioEmail,
  m: MensagemEmail,
  opcoes?: { log?: Pick<FastifyBaseLogger, 'warn'>; esperaMs?: number },
): Promise<void> {
  const falhou = await tentar(envio, m, opcoes?.esperaMs ?? ESPERA_PADRAO_MS);
  if (falhou) logSemFalhar(opcoes?.log, 'warn', { evento: 'email.falha', tentativas: TENTATIVAS }, 'e-mail não enviado após as tentativas');
}

/** Resolve `true` se todas as tentativas falharam; `false` se enviou ou se o e-mail está desligado. Nunca rejeita. */
async function tentar(envio: EnvioEmail, m: MensagemEmail, esperaMs: number): Promise<boolean> {
  for (let i = 1; i <= TENTATIVAS; i++) {
    try {
      await envio.enviar(m);
      return false;
    } catch (e) {
      if (e instanceof ErroEmailDesligado) return false;
      if (i < TENTATIVAS) await esperar(esperaMs);
    }
  }
  return true;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Escreve no log sem nunca lançar: o log nunca derruba o processo. */
export function logSemFalhar<N extends 'warn' | 'error'>(
  log: Pick<FastifyBaseLogger, N> | undefined,
  nivel: N,
  objeto: Record<string, unknown>,
  texto: string,
): void {
  try {
    (log?.[nivel] as ((o: Record<string, unknown>, t: string) => void) | undefined)?.call(log, objeto, texto);
  } catch {
    // o log nunca derruba o processo
  }
}
