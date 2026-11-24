/** Dublê em memória da fila de descida (testes do serviço e das rotas; não entra em produção). */
import type { NotaReferenciaCliente, StatusPedido } from '../contracts';
import { STATUS_DESCEM } from '../domain';
import type { FilaDescida, LinhaDescida } from './descida';

export class FilaDescidaMemoria implements FilaDescida {
  readonly linhas: LinhaDescida[] = [];
  /** Espelho das colunas `nota_cliente_*` de `pedido.pedido`, por pedido. */
  readonly notas = new Map<string, NotaReferenciaCliente>();
  /** `statusDe` é o do armazém do pedido (o SQL faz o JOIN com `pedido.pedido`). */
  constructor(private readonly statusDe: (pedidoId: string) => StatusPedido | undefined) {}

  async enfileirar(pedidoId: string, pedidoUuid: string, quando: Date): Promise<boolean> {
    if (this.linhas.some((l) => l.pedido_id === pedidoId)) return false;
    this.linhas.push({ pedido_id: pedidoId, pedido_uuid: pedidoUuid, enfileirado_em: quando.toISOString(), descido_em: null });
    return true;
  }
  async obter(pedidoId: string) {
    const l = this.linhas.find((x) => x.pedido_id === pedidoId);
    return l ? { ...l } : null;
  }
  async pendentes(limite: number) {
    return this.linhas
      .filter((l) => l.descido_em === null && STATUS_DESCEM.includes(this.statusDe(l.pedido_id) as StatusPedido))
      .sort((a, b) => a.enfileirado_em.localeCompare(b.enfileirado_em) || a.pedido_id.localeCompare(b.pedido_id))
      .slice(0, limite)
      .map((l) => ({ ...l }));
  }
  async marcarDescido(pedidoId: string, quando: Date) {
    const l = this.linhas.find((x) => x.pedido_id === pedidoId);
    if (!l || l.descido_em !== null) return false;
    l.descido_em = quando.toISOString();
    return true;
  }
  async notaCliente(pedidoId: string) {
    const n = this.notas.get(pedidoId);
    return n ? { ...n } : null;
  }
  async gravarNotaCliente(pedidoId: string, nota: NotaReferenciaCliente) {
    this.notas.set(pedidoId, { ...nota });
  }
}
