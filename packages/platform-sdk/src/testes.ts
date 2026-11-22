/**
 * Dublês para testes de unidade (`@macuxierp/platform-sdk/testes`): banco sem PostgreSQL, relógio fixo e
 * adaptadores de outbox e auditoria em memória. Não entram no código de produção.
 */
import type { DestinoAuditoria, RegistroAuditoria } from './auditoria';
import type { Banco, Relogio, Transacao } from './banco';
import type { EnvelopeEvento, Outbox } from './eventos';
import type { FilaDeTrabalhos, PedidoTrabalho } from './trabalhos';

/** Transação de mentira: guarda o tenant e recusa SQL (o teste usa os repositórios em memória). */
export interface TransacaoMemoria extends Transacao {
  readonly tenantId: string | null;
}

export class BancoMemoria implements Banco {
  readonly aberturas: (string | null)[] = [];
  disponivel = true;

  private tx(tenantId: string | null): TransacaoMemoria {
    return {
      tenantId,
      consultar: async () => {
        throw new Error('BancoMemoria não executa SQL: use os repositórios em memória');
      },
    };
  }

  async comTenant<R>(tenantId: string, fn: (tx: Transacao) => Promise<R>): Promise<R> {
    this.aberturas.push(tenantId);
    return fn(this.tx(tenantId));
  }

  async semTenant<R>(fn: (tx: Transacao) => Promise<R>): Promise<R> {
    this.aberturas.push(null);
    return fn(this.tx(null));
  }

  async ping(): Promise<boolean> {
    return this.disponivel;
  }
}

export function tenantDaTx(tx: Transacao): string | null {
  return (tx as TransacaoMemoria).tenantId ?? null;
}

export class RelogioFixo implements Relogio {
  constructor(private instante: Date) {}
  agora(): Date {
    return new Date(this.instante.getTime());
  }
  avancar(ms: number): void {
    this.instante = new Date(this.instante.getTime() + ms);
  }
}

export class OutboxMemoria implements Outbox {
  readonly eventos: EnvelopeEvento[] = [];
  async gravar(_tx: Transacao, evento: EnvelopeEvento): Promise<number> {
    const versao = this.eventos.filter((e) => e.tenant_id === evento.tenant_id && e.agregado_id === evento.agregado_id).length + 1;
    this.eventos.push({ ...evento, versao });
    return versao;
  }
}

export class AuditoriaMemoria implements DestinoAuditoria {
  readonly registros: RegistroAuditoria[] = [];
  async inserir(_tx: Transacao, registro: RegistroAuditoria): Promise<void> {
    this.registros.push(registro);
  }
}

export class FilaDeTrabalhosMemoria implements FilaDeTrabalhos {
  readonly pedidos: (PedidoTrabalho & { id: string })[] = [];
  async enfileirar(_tx: Transacao, pedido: PedidoTrabalho): Promise<{ id: string }> {
    const repetido = pedido.external_id
      ? this.pedidos.find((p) => p.tenant_id === pedido.tenant_id && p.tipo === pedido.tipo && p.external_id === pedido.external_id)
      : undefined;
    if (repetido) return { id: repetido.id };
    const id = `00000000-0000-4000-8000-${String(this.pedidos.length + 1).padStart(12, '0')}`;
    this.pedidos.push({ ...pedido, id });
    return { id };
  }
}
