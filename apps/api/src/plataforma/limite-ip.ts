/**
 * Limites de tentativa em memória do processo (uma API por VM, ADR 0003), em janela fixa por chave:
 * - login do superadmin por IP (ADR 0012 §6): `LIMITE_LOGIN_IP_PADRAO`;
 * - login da tela única (`POST /v1/auth/login`, tenant e MACUXI, T-0076): o mesmo `LIMITE_LOGIN_IP_PADRAO`, contando só
 *   as falhas (401) dos dois lados juntos (`excedido` antes, `registrar` na falha), para o login certo nunca travar o IP
 *   de um escritório inteiro;
 * - "Esqueci a senha" (T-0076, molde do FDV): `LIMITES_ESQUECI_SENHA` do SDK, por IP e por conta (empresa + e-mail), com a
 *   chave da conta em SHA-256 (`chaveEmpresaEmail`): o e-mail em claro nunca fica no Map. Conferidos antes do banco.
 * O IP e a chave ficam só aqui, nunca em log nem em banco.
 */
import { LIMITES_ESQUECI_SENHA, sha256Hex } from '@macuxierp/platform-sdk';

/** Padrão do ADR 0012 §6: 10 tentativas por IP a cada 15 min. */
export const LIMITE_LOGIN_IP_PADRAO = { maximo: 10, janelaMs: 15 * 60_000 } as const;

/** Limites do "Esqueci a senha", um por processo, comuns ao `/v1/auth/esqueci` e ao `/v1/plataforma/auth/esqueci`. */
export interface LimitesEsqueci {
  ip: LimitePorChave;
  conta: LimitePorChave;
}

export const novosLimitesEsqueci = (): LimitesEsqueci => ({
  ip: new LimitePorChave(LIMITES_ESQUECI_SENHA.por_ip.maximo, LIMITES_ESQUECI_SENHA.por_ip.janela_s * 1000),
  conta: new LimitePorChave(LIMITES_ESQUECI_SENHA.por_conta.maximo, LIMITES_ESQUECI_SENHA.por_conta.janela_s * 1000),
});

/** "Empresa" do superadmin na chave da conta (o MACUXI da tela única e o pedido do `/config`). */
export const EMPRESA_PLATAFORMA = 'plataforma';

export interface ResultadoLimite {
  permitido: boolean;
  /** Segundos que faltam para a janela vencer (arredondado para cima, mínimo 1). */
  retry_after_s: number;
}

export class LimitePorChave {
  readonly #janelas = new Map<string, { inicio: number; n: number }>();

  constructor(
    private readonly maximo: number = LIMITE_LOGIN_IP_PADRAO.maximo,
    private readonly janelaMs: number = LIMITE_LOGIN_IP_PADRAO.janelaMs,
    /** Acima disso, a próxima contagem varre as janelas vencidas. */
    private readonly limpezaAcima = 10_000,
  ) {}

  /** Conta a tentativa e diz se ela cabe no limite; acima do limite, quantos segundos faltam para a janela vencer. */
  registrar(chave: string, agoraMs: number): ResultadoLimite {
    if (this.#janelas.size > this.limpezaAcima) this.limpar(agoraMs);
    let j = this.#janelas.get(chave);
    if (!j || agoraMs - j.inicio >= this.janelaMs) {
      j = { inicio: agoraMs, n: 0 };
      this.#janelas.set(chave, j);
    }
    j.n += 1;
    return { permitido: j.n <= this.maximo, retry_after_s: Math.max(1, Math.ceil((j.inicio + this.janelaMs - agoraMs) / 1000)) };
  }

  /** Sem contar: a chave já chegou ao limite na janela corrente? (com os segundos que faltam). */
  excedido(chave: string, agoraMs: number): ResultadoLimite {
    const j = this.#janelas.get(chave);
    if (!j || agoraMs - j.inicio >= this.janelaMs) return { permitido: true, retry_after_s: 0 };
    return { permitido: j.n < this.maximo, retry_after_s: Math.max(1, Math.ceil((j.inicio + this.janelaMs - agoraMs) / 1000)) };
  }

  /** Esquece a chave (a conta entrou: a contagem recomeça, como o `falhas_login` do banco). */
  liberar(chave: string): void {
    this.#janelas.delete(chave);
  }

  get tamanho(): number {
    return this.#janelas.size;
  }

  /** Só para teste: as chaves guardadas (nunca vão a log). */
  chaves(): string[] {
    return [...this.#janelas.keys()];
  }

  private limpar(agoraMs: number): void {
    for (const [chave, j] of this.#janelas) if (agoraMs - j.inicio >= this.janelaMs) this.#janelas.delete(chave);
  }
}

/**
 * Trava em memória da conta que NÃO existe (RN-CORE-15, T-0111; decisão R-20261126-175321), com os mesmos `maxFalhas` e
 * `travaMinutos` da trava do banco da conta que existe, para o 423 sair igual nos dois casos (anti-enumeração). A conta que
 * existe segue só o banco (`falhas_login`, `bloqueado_ate`), que o `operador.sh --destravar` zera na hora. A chave é a
 * `chaveEmpresaEmail` (SHA-256): o e-mail em claro nunca fica no Map. Uma por processo (uma API por VM, ADR 0003).
 */
export class TravaContaMemoria {
  readonly #limite: LimitePorChave;

  constructor(cfg: { maxFalhas: number; travaMinutos: number }) {
    this.#limite = new LimitePorChave(cfg.maxFalhas, cfg.travaMinutos * 60_000);
  }

  travada(chave: string, agoraMs: number): boolean {
    return !this.#limite.excedido(chave, agoraMs).permitido;
  }

  falhou(chave: string, agoraMs: number): void {
    this.#limite.registrar(chave, agoraMs);
  }

  liberar(chave: string): void {
    this.#limite.liberar(chave);
  }

  /** Só para teste. */
  chaves(): string[] {
    return this.#limite.chaves();
  }
}

/** Chave do limite por empresa + e-mail: SHA-256 da empresa e do e-mail normalizados (trim e minúsculas). */
export function chaveEmpresaEmail(empresa: string, email: string): string {
  return sha256Hex(`${empresa.trim().toLowerCase()}\u0000${email.trim().toLowerCase()}`);
}
