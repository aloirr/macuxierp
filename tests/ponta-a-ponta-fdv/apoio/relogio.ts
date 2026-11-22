/**
 * T-0012: relógio do arnês. Contra o dublê, o tempo é do teste (`RelogioDeTeste`: `dormir` avança o relógio na hora,
 * sem esperar de verdade, e registra cada espera). Contra o tenant real, o relógio e a espera são reais.
 */
export interface Relogio {
  agora(): Date;
  /** Espera `ms` (o `Retry-After`, o intervalo da consulta do lote). */
  dormir(ms: number): Promise<void>;
}

export class RelogioDeTeste implements Relogio {
  private ms: number;
  /** Cada espera pedida, em ms, na ordem. */
  readonly esperas: number[] = [];

  constructor(inicio: Date) {
    this.ms = inicio.getTime();
  }

  agora(): Date {
    return new Date(this.ms);
  }

  avancar(ms: number): void {
    this.ms += ms;
  }

  async dormir(ms: number): Promise<void> {
    this.esperas.push(ms);
    this.ms += ms;
    // devolve a vez ao laço de eventos (o servidor do dublê responde no meio)
    await new Promise<void>((r) => setImmediate(r));
  }
}

export const relogioReal: Relogio = {
  agora: () => new Date(),
  dormir: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
};
