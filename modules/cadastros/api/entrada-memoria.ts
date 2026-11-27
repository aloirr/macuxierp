/** Dublê em memória do `RepositorioEntrada` para os testes (sem PostgreSQL). Não entra em produção. */
import { randomUUID } from 'node:crypto';
import type { CorpoLote, CursorHub, ModoLote } from '@macuxierp/platform-sdk/hub-v1';
import { maisNovoQue, type ErroGuardado, type LoteGuardado } from '../domain';
import type { FormaParaGravar, LoteCriado, LotePendente, RepositorioEntrada, SinalGravado } from './entrada-sql';

export interface LoteMemoria {
  id: string;
  credencial_id: string;
  conector_id: string;
  entidade: string;
  modo: ModoLote;
  idempotency_key: string;
  hash_corpo: string;
  corpo: CorpoLote | null;
  recebidos: number;
  estado: LoteGuardado['estado'];
  com_erro: number;
  contagens: Record<string, number>;
  erros: ErroGuardado[];
  erro_codigo: string | null;
  cursor: CursorHub | null;
  criado_em: Date;
  concluido_em: Date | null;
}

export class EntradaMemoria implements RepositorioEntrada {
  readonly lotes: LoteMemoria[] = [];
  readonly cursores = new Map<string, { cursor: CursorHub; atualizado_em: Date; ultimo_lote_id: string }>();
  readonly sinais = new Map<string, SinalGravado & { em: Date }>();
  readonly formas = new Map<string, FormaParaGravar>();
  /** Ordem em que o worker processou (ids dos lotes), para o teste da fila. */
  readonly processados: string[] = [];
  private relogio = 0;

  async criarLote(p: Parameters<RepositorioEntrada['criarLote']>[0]): Promise<{ lote: LoteCriado; criado: boolean }> {
    const antigo = this.lotes.find((l) => l.conector_id === p.conector_id && l.idempotency_key === p.idempotency_key);
    if (antigo) return { lote: this.resumo(antigo), criado: false };
    this.relogio += 1;
    const l: LoteMemoria = {
      id: randomUUID(), credencial_id: p.credencial_id, conector_id: p.conector_id, entidade: p.entidade, modo: p.modo, idempotency_key: p.idempotency_key,
      hash_corpo: p.hash_corpo, corpo: p.corpo, recebidos: p.recebidos, estado: 'recebido', com_erro: 0, contagens: {}, erros: [], erro_codigo: null, cursor: null,
      criado_em: new Date(Date.UTC(2026, 10, 26, 12, 0, this.relogio)), concluido_em: null,
    };
    this.lotes.push(l);
    return { lote: this.resumo(l), criado: true };
  }

  private resumo(l: LoteMemoria): LoteCriado {
    return { id: l.id, entidade: l.entidade, modo: l.modo, recebidos: l.recebidos, hash_corpo: l.hash_corpo };
  }

  async lerLote(conectorId: string, id: string): Promise<LoteGuardado | null> {
    const l = this.lotes.find((x) => x.id === id && x.conector_id === conectorId);
    if (!l) return null;
    return {
      id: l.id, entidade: l.entidade, modo: l.modo, estado: l.estado, contagens: l.contagens, erros: l.erros,
      cursor_alterado_em: l.cursor?.alterado_em ?? null, cursor_external_id: l.cursor?.external_id ?? null,
      recebido_em: l.criado_em.toISOString(), concluido_em: l.concluido_em?.toISOString() ?? null, erro_codigo: l.erro_codigo,
    };
  }

  async lerForma(externalId: string) {
    const f = this.formas.get(externalId);
    return f ? { codigo: f.codigo, nome: f.nome, tpag: f.tpag } : null;
  }

  async formaPorCodigo(codigo: string) {
    const f = [...this.formas.values()].find((x) => x.codigo.toUpperCase() === codigo.toUpperCase());
    return f ? { external_id: f.external_id } : null;
  }

  async gravarForma(f: FormaParaGravar) {
    const antes = this.formas.get(f.external_id);
    this.formas.set(f.external_id, { ...f });
    if (!antes) return 'nova' as const;
    return antes.codigo === f.codigo && antes.nome === f.nome && antes.tpag === f.tpag && antes.ativo === f.ativo ? ('igual' as const) : ('alterada' as const);
  }

  async lerCursor(conectorId: string, entidade: string) {
    const c = this.cursores.get(`${conectorId}|${entidade}`);
    return c ? { cursor: c.cursor, atualizado_em: c.atualizado_em.toISOString() } : null;
  }

  async gravarSinal(conectorId: string, s: SinalGravado, agora: Date): Promise<void> {
    this.sinais.set(conectorId, { ...s, em: agora });
  }

  async proximoDaFila(loteId: string): Promise<LotePendente | null> {
    const base = this.lotes.find((x) => x.id === loteId);
    if (!base) return null;
    const l = this.lotes.filter((x) => x.conector_id === base.conector_id && x.entidade === base.entidade && x.estado === 'recebido')
      .sort((a, b) => a.criado_em.getTime() - b.criado_em.getTime())[0];
    return l ? { id: l.id, conector_id: l.conector_id, entidade: l.entidade, corpo: l.corpo, recebidos: l.recebidos } : null;
  }

  async marcarProcessando(id: string): Promise<void> {
    this.processados.push(id);
    const l = this.lotes.find((x) => x.id === id) as LoteMemoria;
    l.estado = 'processando';
  }

  async concluir(id: string, r: Parameters<RepositorioEntrada['concluir']>[1], agora: Date): Promise<void> {
    const l = this.lotes.find((x) => x.id === id) as LoteMemoria;
    Object.assign(l, { estado: r.estado, com_erro: r.com_erro, contagens: { ...r.contagens }, erros: [...r.erros], cursor: r.cursor, corpo: null, concluido_em: agora });
  }

  async falhar(id: string, codigo: string, agora: Date): Promise<void> {
    const l = this.lotes.find((x) => x.id === id) as LoteMemoria;
    if (l.estado !== 'recebido' && l.estado !== 'processando') return;
    this.paraFalhou(l, codigo, agora);
  }

  private paraFalhou(l: LoteMemoria, codigo: string, agora: Date): void {
    Object.assign(l, { estado: 'falhou', erro_codigo: codigo, corpo: null, concluido_em: agora, cursor: null });
  }

  async expurgarCorpos(corte: Date, codigo: string, agora: Date): Promise<number> {
    const velhos = this.lotes.filter((l) => (l.estado === 'recebido' || l.estado === 'processando') && l.criado_em < corte);
    for (const l of velhos) this.paraFalhou(l, codigo, agora);
    return velhos.length;
  }

  async avancarCursor(conectorId: string, entidade: string, cursor: CursorHub, loteId: string): Promise<void> {
    const k = `${conectorId}|${entidade}`;
    const atual = this.cursores.get(k);
    if (atual && !maisNovoQue(cursor, atual.cursor)) return;
    this.cursores.set(k, { cursor, atualizado_em: new Date(), ultimo_lote_id: loteId });
  }
}
