/**
 * Envio de e-mail depois da resposta HTTP (T-0076, "esqueci a senha"): quem chama não espera nem vê a falha, para a resposta
 * ser igual com ou sem e-mail (sem enumerar usuário) e não atrasar.
 * - roda no `setImmediate`; nunca lança nem deixa rejeição sem tratamento;
 * - 2 tentativas, com 2000 ms entre elas;
 * - `ErroEmailDesligado` não é falha: não tenta de novo e não loga;
 * - SMTP aceitou: um `info` "email.enviado" com um `envio_id` aleatório (UUID, sem ligação com conta, empresa ou destinatário),
 *   para a operação ver na VM que o e-mail saiu;
 * - falha final: um `warn` "email.falha" só com `evento`, `tentativas` e o `codigo` do SMTP da última tentativa (o do
 *   nodemailer, `EAUTH`, `ECONNECTION`..., já filtrado pela porta; `null` se não houver).
 * LGPD: nenhum log leva destinatário, assunto, texto ou mensagem do erro.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { type EnvioEmail, ErroEmailDesligado, ErroEnvioEmail, type MensagemEmail } from './porta';

const TENTATIVAS = 2;
const ESPERA_PADRAO_MS = 2000;

export type LogEnvioEmail = Pick<FastifyBaseLogger, 'info' | 'warn'>;

/** Resultado das tentativas: enviou, e-mail desligado, ou falhou com o código SMTP da última (ou `null`). */
type Resultado = { tipo: 'enviado' } | { tipo: 'desligado' } | { tipo: 'falha'; codigo: string | null };

export function agendarEnvioEmail(envio: EnvioEmail, m: MensagemEmail, opcoes?: { log?: LogEnvioEmail; esperaMs?: number }): void {
  const log = opcoes?.log;
  const esperaMs = opcoes?.esperaMs ?? ESPERA_PADRAO_MS;
  setImmediate(() => {
    void tentar(envio, m, esperaMs).then(
      (r) => registrar(log, r),
      () => registrar(log, { tipo: 'falha', codigo: null }),
    );
  });
}

/** Nunca rejeita. */
async function tentar(envio: EnvioEmail, m: MensagemEmail, esperaMs: number): Promise<Resultado> {
  let codigo: string | null = null;
  for (let i = 1; i <= TENTATIVAS; i++) {
    try {
      await envio.enviar(m);
      return { tipo: 'enviado' };
    } catch (e) {
      if (e instanceof ErroEmailDesligado) return { tipo: 'desligado' };
      codigo = e instanceof ErroEnvioEmail ? e.codigo : null;
      if (i < TENTATIVAS) await esperar(esperaMs);
    }
  }
  return { tipo: 'falha', codigo };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registrar(log: LogEnvioEmail | undefined, r: Resultado): void {
  try {
    if (r.tipo === 'enviado') log?.info({ evento: 'email.enviado', envio_id: randomUUID() }, 'e-mail aceito pelo SMTP');
    else if (r.tipo === 'falha') log?.warn({ evento: 'email.falha', tentativas: TENTATIVAS, codigo: r.codigo }, 'e-mail não enviado após as tentativas');
  } catch {
    // o log nunca derruba o processo
  }
}
