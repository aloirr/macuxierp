/**
 * Limites de tentativa em memória do processo (uma API por VM, ADR 0003), em janela fixa por chave:
 * - login do superadmin por IP (ADR 0012 §6): `LIMITE_LOGIN_IP_PADRAO`;
 * - login da tela única (`POST /v1/auth/login`, tenant e MACUXI, T-0076) e o `/config/entrar`: o mesmo
 *   `LIMITE_LOGIN_IP_PADRAO`, contando só as falhas (401 e 423) dos dois lados juntos. Com o IP no limite, só a senha
 *   temporária válida entra (hotfix v0.3.16.1): o limite nunca impede a recuperação;
 * - "Esqueci a senha" (T-0076): `LIMITES_ESQUECI_SENHA` do SDK, só por IP (anti-spam), conferido antes do banco.
 * O IP e a chave ficam só aqui, nunca em log nem em banco.
 */
import { LIMITES_ESQUECI_SENHA, sha256Hex } from '@macuxierp/platform-sdk';

/** Padrão do ADR 0012 §6: 10 tentativas por IP a cada 15 min. */
export const LIMITE_LOGIN_IP_PADRAO = { maximo: 10, janelaMs: 15 * 60_000 } as const;

/** Limites do "Esqueci a senha", um por processo, comuns ao `/v1/auth/esqueci` e ao `/v1/plataforma/auth/esqueci`. */
export interface LimitesEsqueci {
  ip: LimitePorChave;
}

export const novosLimitesEsqueci = (): LimitesEsqueci => ({
  ip: new LimitePorChave(LIMITES_ESQUECI_SENHA.por_ip.maximo, LIMITES_ESQUECI_SENHA.por_ip.janela_s * 1000),
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
 * Trava em memória da conta que NÃO existe (RN-CORE-15, T-0111; decisão R-20261126-175321), com o mesmo `maxFalhas` do
 * bloqueio do banco da conta que existe e, como ele, SEM PRAZO (hotfix v0.3.16.1), para o 423 sair igual nos dois casos
 * (anti-enumeração). A conta que existe segue só o banco (`falhas_login`, `bloqueado_ate`). A chave é a
 * `chaveEmpresaEmail` (SHA-256): o e-mail em claro nunca fica no Map. Uma por processo (uma API por VM, ADR 0003); acima
 * de `TETO_TRAVA_MEMORIA` chaves, a mais antiga sai (o Map não cresce sem limite).
 */
export const TETO_TRAVA_MEMORIA = 100_000;

export class TravaContaMemoria {
  readonly #falhas = new Map<string, number>();
  readonly #maximo: number;

  constructor(cfg: { maxFalhas: number }) {
    this.#maximo = cfg.maxFalhas;
  }

  travada(chave: string): boolean {
    return (this.#falhas.get(chave) ?? 0) >= this.#maximo;
  }

  falhou(chave: string): void {
    this.#falhas.set(chave, (this.#falhas.get(chave) ?? 0) + 1);
    if (this.#falhas.size > TETO_TRAVA_MEMORIA) this.#falhas.delete(this.#falhas.keys().next().value!);
  }
}

/** Chave do limite por empresa + e-mail: SHA-256 da empresa e do e-mail normalizados (trim e minúsculas). */
export function chaveEmpresaEmail(empresa: string, email: string): string {
  return sha256Hex(`${empresa.trim().toLowerCase()}\u0000${email.trim().toLowerCase()}`);
}
