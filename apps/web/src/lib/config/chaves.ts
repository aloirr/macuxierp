/** Idempotency-Key por ação (ADR 0013, §5): a mesma chave se repete enquanto a resposta não for definitiva (falha de rede reaproveita). */
export class ChavesIdempotencia {
  private readonly mapa = new Map<string, string>();
  constructor(private readonly gerar: () => string = () => crypto.randomUUID()) {}

  de(id: string): string {
    let k = this.mapa.get(id);
    if (!k) {
      k = this.gerar();
      this.mapa.set(id, k);
    }
    return k;
  }

  /** Sucesso ou resposta definitiva guardada pela API (409/422: `chaveNova`) liberam a chave; rede e 5xx a mantêm. */
  aposResposta(id: string | null, r: { ok: boolean; chaveNova?: boolean }): void {
    if (id && (r.ok || r.chaveNova)) this.mapa.delete(id);
  }
}
