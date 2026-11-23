/**
 * Limite de tentativas de login do superadmin por origem (ADR 0012 §6): no máximo `maximo` tentativas por IP numa
 * janela fixa, em memória do processo (uma API por VM, ADR 0003). O IP fica só aqui, nunca em log nem em banco.
 */
/** Padrão do ADR 0012 §6: 10 tentativas por IP a cada 15 min. */
export const LIMITE_LOGIN_IP_PADRAO = { maximo: 10, janelaMs: 15 * 60_000 } as const;

export class LimitePorIp {
  readonly #janelas = new Map<string, { inicio: number; n: number }>();

  constructor(
    private readonly maximo: number = LIMITE_LOGIN_IP_PADRAO.maximo,
    private readonly janelaMs: number = LIMITE_LOGIN_IP_PADRAO.janelaMs,
    /** Acima disso, a próxima contagem varre as janelas vencidas. */
    private readonly limpezaAcima = 10_000,
  ) {}

  /** Conta a tentativa; `false` = acima do limite (a tentativa não chega a conferir senha). */
  contar(ip: string, agoraMs: number): boolean {
    if (this.#janelas.size > this.limpezaAcima) this.limpar(agoraMs);
    const j = this.#janelas.get(ip);
    if (!j || agoraMs - j.inicio >= this.janelaMs) {
      this.#janelas.set(ip, { inicio: agoraMs, n: 1 });
      return true;
    }
    j.n += 1;
    return j.n <= this.maximo;
  }

  get tamanho(): number {
    return this.#janelas.size;
  }

  private limpar(agoraMs: number): void {
    for (const [ip, j] of this.#janelas) if (agoraMs - j.inicio >= this.janelaMs) this.#janelas.delete(ip);
  }
}
