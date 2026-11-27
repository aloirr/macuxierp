/**
 * Apoio comum dos dois logins da API (tenant em `auth/servico.ts` e superadmin em `plataforma/servico.ts`): o bloqueio
 * SEM PRAZO após `maxFalhas` falhas seguidas (RN-CORE-15, hotfix v0.3.16.1: só a temporária ou o `--destravar` liberam)
 * e a conferência contra um hash falso, para o tempo de
 * resposta não revelar se a conta existe ou está travada, e as opções do cookie de sessão. Cada login mantém a própria
 * mensagem de falha.
 */
import { randomUUID } from 'node:crypto';
import { avaliarEntrada, temporariaValida, type ResultadoEntrada } from '@macuxierp/core/api';
import { erros, type ErroApi } from '@macuxierp/platform-sdk';
import type { TravaContaMemoria } from '../plataforma/limite-ip';
import { conferirSenha, gerarHashSenha, type ParametrosArgon2 } from './senha';

/**
 * `bloqueado_ate` do bloqueio sem prazo (RN-CORE-15, hotfix v0.3.16.1, pedido do Alexandre): não vence sozinho. Sai só com
 * a senha temporária válida (que desbloqueia na hora) ou com o `operador.sh superadmin --destravar`/o administrador.
 */
export const BLOQUEIO_SEM_PRAZO = new Date('9999-12-31T00:00:00.000Z');

/** Bloqueia a partir da `maxFalhas`-ésima falha seguida, sem prazo; `null` = ainda não bloqueia. */
export function travaAposFalha(falhas: number, cfg: { maxFalhas: number }): Date | null {
  return falhas >= cfg.maxFalhas ? BLOQUEIO_SEM_PRAZO : null;
}

/** A conta está travada agora (`bloqueado_ate` no futuro). */
export function contaTravada(bloqueadoAte: Date | null, agora: Date): boolean {
  return !!bloqueadoAte && bloqueadoAte.getTime() > agora.getTime();
}

/**
 * Conferências argon2 de toda recusa do login (RN-CORE-15, T-0111; RD-2288 e RD-2301): a senha atual e a temporária.
 * Conta inexistente, travada, com ou sem temporária, vigente ou vencida: a recusa completa com o hash falso até este
 * número, para o tempo não revelar se a conta existe, se está travada nem se há temporária pendente.
 */
export const CONFERENCIAS_POR_RECUSA = 2;

/** O que o login lê da conta que existe (tenant e superadmin). */
export interface ContaParaEntrada {
  senha_hash: string;
  bloqueado_ate: Date | null;
  senha_temporaria_hash?: string | null;
  senha_temporaria_expira_em?: Date | null;
}

/** Decisão do login: o resultado do `avaliarEntrada` do core, o fim da temporária que conferiu e quantas conferências já custou. */
export interface DecisaoEntrada {
  resultado: ResultadoEntrada;
  fimTemporaria: Date | null;
  conferencias: number;
}

/** Recusa devolvida (não lançada) de dentro da transação, para a falha gravada não ser desfeita. */
export type Recusa = { recusa: 'bloqueada' | 'falha'; conferencias: number };

/** O custo igual (hash falso gerado uma vez) e a decisão do login, num ponto só para o tenant e o superadmin. */
export class ConferenciaCustoIgual {
  private hashFalso: Promise<string> | undefined;

  constructor(private readonly argon2: ParametrosArgon2) {}

  /**
   * RN-CORE-15: a conta travada não confere a senha atual; a temporária só é conferida se estiver vigente (a vencida não
   * custa nada aqui e a recusa completa o custo). O banco revalida a temporária no consumo atômico. `soTemporaria` (IP no
   * limite de falhas): a senha atual também não é conferida; só a temporária válida entra.
   */
  async decidirEntrada(senha: string, conta: ContaParaEntrada, agora: Date, soTemporaria = false): Promise<DecisaoEntrada> {
    const travada = contaTravada(conta.bloqueado_ate, agora);
    let conferencias = 0;
    let atual = false;
    if (!travada && !soTemporaria) {
      atual = await conferirSenha(senha, conta.senha_hash);
      conferencias++;
    }
    let fimTemporaria: Date | null = null;
    const fim = conta.senha_temporaria_expira_em;
    if (!atual && conta.senha_temporaria_hash && fim && temporariaValida(fim, agora)) {
      fimTemporaria = (await conferirSenha(senha, conta.senha_temporaria_hash)) ? fim : null;
      conferencias++;
    }
    const resultado = avaliarEntrada({ travada, temporariaVigente: fimTemporaria !== null, senhaConfere: atual || fimTemporaria !== null });
    return { resultado, fimTemporaria, conferencias };
  }

  /** Completa até `CONFERENCIAS_POR_RECUSA` com o hash falso e lança o erro dado. */
  async recusar(senha: string, feitas: number, erro: () => ErroApi): Promise<never> {
    this.hashFalso ??= gerarHashSenha(randomUUID(), this.argon2);
    for (let i = feitas; i < CONFERENCIAS_POR_RECUSA; i++) await conferirSenha(senha, await this.hashFalso);
    throw erro();
  }

  /** A recusa da conta que existe: 423 travada, senão a falha neutra do login; com `limite` (IP no limite), o 429 dele. */
  recusarConta(senha: string, r: Recusa, falha: () => ErroApi, limite?: () => ErroApi): Promise<never> {
    return this.recusar(senha, r.conferencias, limite ?? (r.recusa === 'bloqueada' ? erros.contaBloqueada : falha));
  }

  /**
   * A conta que não existe (empresa ou e-mail, ou inativa): a trava em memória (`TravaContaMemoria`) dá o mesmo 423 da
   * conta travada no banco; senão conta a falha e devolve a falha neutra. O mesmo custo em todo caso. Com `limite` (IP no
   * limite de falhas), a recusa é o 429 do limite, sem contar na trava: o mesmo da conta que existe.
   */
  recusarSemConta(senha: string, trava: TravaContaMemoria, chave: string, falha: () => ErroApi, limite?: () => ErroApi): Promise<never> {
    if (limite) return this.recusar(senha, 0, limite);
    if (trava.travada(chave)) return this.recusar(senha, 0, erros.contaBloqueada);
    trava.falhou(chave);
    return this.recusar(senha, 0, falha);
  }
}

/** Opções do cookie de sessão (refresh do tenant e sessão do portal `/config`): httpOnly e SameSite=Strict. */
export const opcoesCookieSessao = (path: string, seguro: boolean, expira: Date) =>
  ({ httpOnly: true, secure: seguro, sameSite: 'strict', path, expires: expira }) as const;
