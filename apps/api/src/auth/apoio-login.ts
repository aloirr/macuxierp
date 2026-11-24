/**
 * Apoio comum dos dois logins da API (tenant em `auth/servico.ts` e superadmin em `plataforma/servico.ts`): a trava após
 * `maxFalhas` falhas seguidas por `travaMinutos` (`ConfigAuth`) e a conferência contra um hash falso, para o tempo de
 * resposta não revelar se a conta existe ou está travada, e as opções do cookie de sessão. Cada login mantém a própria
 * mensagem de falha.
 */
import { randomUUID } from 'node:crypto';
import type { ErroApi } from '@macuxierp/platform-sdk';
import { conferirSenha, gerarHashSenha, type ParametrosArgon2 } from './senha';

/** Trava a partir da `maxFalhas`-ésima falha seguida, por `travaMinutos`; `null` = ainda não trava. */
export function travaAposFalha(falhas: number, agora: Date, cfg: { maxFalhas: number; travaMinutos: number }): Date | null {
  return falhas >= cfg.maxFalhas ? new Date(agora.getTime() + cfg.travaMinutos * 60_000) : null;
}

/** A conta está travada agora (`bloqueado_ate` no futuro). */
export function contaTravada(bloqueadoAte: Date | null, agora: Date): boolean {
  return !!bloqueadoAte && bloqueadoAte.getTime() > agora.getTime();
}

/** Mesmo custo de argon2 do caminho certo: confere a senha contra um hash falso (gerado uma vez) e lança o erro dado. */
export class ConferenciaCustoIgual {
  private hashFalso: Promise<string> | undefined;

  constructor(private readonly argon2: ParametrosArgon2) {}

  async falhar(senha: string, erro: () => ErroApi): Promise<never> {
    this.hashFalso ??= gerarHashSenha(randomUUID(), this.argon2);
    await conferirSenha(senha, await this.hashFalso);
    throw erro();
  }
}

/** Opções do cookie de sessão (refresh do tenant e sessão do portal `/config`): httpOnly e SameSite=Strict. */
export const opcoesCookieSessao = (path: string, seguro: boolean, expira: Date) =>
  ({ httpOnly: true, secure: seguro, sameSite: 'strict', path, expires: expira }) as const;
