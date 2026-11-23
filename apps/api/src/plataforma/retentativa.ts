/**
 * Retentativa única em deadlock (SQLSTATE `40P01`) no `comPlataforma` do portal `/config` (T-0056, ADR 0013): as funções
 * da 0038 travam `sinal` → `credencial` → `cursor_entidade` na mesma ordem do BKO e do worker, mas o PostgreSQL ainda
 * pode escolher a transação do portal como vítima. Ela foi desfeita inteira (inclusive a reserva da Idempotency-Key e a
 * auditoria), então refazê-la do zero é seguro:
 * - só `40P01`; `40001` (serialização) fica de fora: o portal roda em READ COMMITTED, sem SERIALIZABLE;
 * - uma vez só, depois de 20 a 80 ms aleatórios; na segunda falha, o erro segue (vira 500 no handler global);
 * - log `warn` só com `{ sqlstate: '40P01', tentativa: 2 }` (molde do `diagnosticoBanco`): nada de mensagem nem detalhe;
 * - `antesDaSessao` (login) segue sem retentativa.
 */
import type { BancoPlataformaComLogin, SessaoPlataforma, Transacao } from '@macuxierp/platform-sdk';

const SQLSTATE_DEADLOCK = '40P01';
const ESPERA_MINIMA_DEADLOCK_MS = 20;
const ESPERA_MAXIMA_DEADLOCK_MS = 80;

export interface LogRetentativa {
  warn(obj: { sqlstate: typeof SQLSTATE_DEADLOCK; tentativa: 2 }, msg: string): void;
}

export interface OpcoesRetentativa {
  /** Padrão: `setTimeout`. Os testes trocam para não esperar. */
  esperar?: (ms: number) => Promise<void>;
  /** Padrão: `Math.random` (só o espaçamento; não é segredo). */
  sortear?: () => number;
}

const ehDeadlock = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === SQLSTATE_DEADLOCK;
const esperarPadrao = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/** Espera entre 20 e 80 ms (inclusive), pelo `sortear` em [0, 1). */
export function esperaDeadlockMs(sortear: () => number = Math.random): number {
  const faixa = ESPERA_MAXIMA_DEADLOCK_MS - ESPERA_MINIMA_DEADLOCK_MS + 1;
  return ESPERA_MINIMA_DEADLOCK_MS + Math.min(faixa - 1, Math.floor(sortear() * faixa));
}

/** O mesmo banco de plataforma, com o `comPlataforma` refeito uma vez em `40P01`. */
export function comRetentativaEmDeadlock(banco: BancoPlataformaComLogin, log: LogRetentativa, o: OpcoesRetentativa = {}): BancoPlataformaComLogin {
  const esperar = o.esperar ?? esperarPadrao;
  const sortear = o.sortear ?? Math.random;
  return {
    async comPlataforma<R>(sessao: SessaoPlataforma, fn: (tx: Transacao) => Promise<R>): Promise<R> {
      try {
        return await banco.comPlataforma(sessao, fn);
      } catch (e) {
        if (!ehDeadlock(e)) throw e;
        await esperar(esperaDeadlockMs(sortear));
        log.warn({ sqlstate: SQLSTATE_DEADLOCK, tentativa: 2 }, 'deadlock no portal: transação refeita');
        return banco.comPlataforma(sessao, fn);
      }
    },
    antesDaSessao: (fn) => banco.antesDaSessao(fn),
  };
}
