/** Filas em memória com o mesmo contrato das portas (testes de unidade até o adaptador PostgreSQL, T-0003). */
import type { PedidoTrabalho, Trabalho, Transacao } from '@macuxierp/platform-sdk';
import type { EventoPendente, FilaOutbox, FilaTrabalho, RegistroConsumo } from './portas';

interface LinhaEvento extends EventoPendente {
  publicado_em: Date | null;
  proximo_em: Date;
  erro: string | null;
}

export class FilaOutboxMemoria implements FilaOutbox {
  readonly linhas: LinhaEvento[] = [];

  adicionar(e: Omit<EventoPendente, 'tentativas'>): void {
    this.linhas.push({ ...e, tentativas: 0, publicado_em: null, proximo_em: new Date(e.ocorrido_em), erro: null });
  }

  async reservar(_tx: Transacao, limite: number, agora: Date): Promise<EventoPendente[]> {
    const pendentes = this.linhas.filter((l) => !l.publicado_em).sort((a, b) => a.ocorrido_em.localeCompare(b.ocorrido_em));
    const primeiroDoAgregado = new Set<string>();
    const saida: EventoPendente[] = [];
    for (const l of pendentes) {
      const ehPrimeiro = !primeiroDoAgregado.has(l.agregado_id);
      primeiroDoAgregado.add(l.agregado_id);
      // contrato: evento com outro anterior pendente do mesmo agregado só sai no mesmo lote, atrás dele
      if (l.proximo_em.getTime() > agora.getTime()) continue;
      if (!ehPrimeiro && !saida.some((s) => s.agregado_id === l.agregado_id)) continue;
      saida.push({ ...l });
      if (saida.length === limite) break;
    }
    return saida;
  }

  async marcarPublicado(_tx: Transacao, id: string, agora: Date): Promise<void> {
    this.linha(id).publicado_em = agora;
  }

  async marcarFalha(_tx: Transacao, id: string, tentativas: number, proximoEm: Date, erro: string): Promise<void> {
    Object.assign(this.linha(id), { tentativas, proximo_em: proximoEm, erro });
  }

  private linha(id: string): LinhaEvento {
    const l = this.linhas.find((x) => x.id === id);
    if (!l) throw new Error(`evento ${id} inexistente`);
    return l;
  }
}

export class RegistroConsumoMemoria implements RegistroConsumo {
  readonly consumidos = new Set<string>();
  async jaConsumido(_tx: Transacao, consumidor: string, eventoId: string): Promise<boolean> {
    return this.consumidos.has(`${consumidor}|${eventoId}`);
  }
  async registrar(_tx: Transacao, consumidor: string, eventoId: string): Promise<void> {
    const chave = `${consumidor}|${eventoId}`;
    if (this.consumidos.has(chave)) throw new Error('violação de unicidade em evento_consumido');
    this.consumidos.add(chave);
  }
}

interface LinhaTrabalho extends Trabalho {
  estado: 'pendente' | 'concluido' | 'falhou';
  proximo_em: Date;
  resultado: Record<string, unknown> | null;
  erro: string | null;
}

export class FilaTrabalhoMemoria implements FilaTrabalho {
  readonly linhas: LinhaTrabalho[] = [];

  adicionar(id: string, p: PedidoTrabalho, quando: Date): void {
    this.linhas.push({ ...p, id, tentativas: 0, estado: 'pendente', proximo_em: quando, resultado: null, erro: null });
  }

  async reservar(_tx: Transacao, tipos: readonly string[], limite: number, agora: Date): Promise<Trabalho[]> {
    return this.linhas
      .filter((l) => l.estado === 'pendente' && tipos.includes(l.tipo) && l.proximo_em.getTime() <= agora.getTime())
      .slice(0, limite)
      .map((l) => ({ id: l.id, tipo: l.tipo, tenant_id: l.tenant_id, payload: l.payload, tentativas: l.tentativas }));
  }

  async concluir(_tx: Transacao, id: string, resultado: Record<string, unknown> | null): Promise<void> {
    Object.assign(this.linha(id), { estado: 'concluido', resultado });
  }

  async falhar(_tx: Transacao, id: string, tentativas: number, proximoEm: Date | null, erro: string): Promise<void> {
    const l = this.linha(id);
    Object.assign(l, { tentativas, erro, estado: proximoEm ? 'pendente' : 'falhou', proximo_em: proximoEm ?? l.proximo_em });
  }

  private linha(id: string): LinhaTrabalho {
    const l = this.linhas.find((x) => x.id === id);
    if (!l) throw new Error(`trabalho ${id} inexistente`);
    return l;
  }
}
