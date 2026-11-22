import { violacao, type Violacao } from './violacao';

export type TipoMovimento = 'entrada' | 'saida' | 'ajuste';

export type ResultadoMovimento = { ok: true; delta: number; saldo: number } | { ok: false; violacao: Violacao };

/**
 * RN-CAD-07: saldo por filial, nunca negativo sem a permissão do gerente (`cadastros.estoque.negativo`).
 * Quantidades × 10^4 (D11). Entrada e saída levam quantidade positiva; o ajuste leva sinal (e não é zero).
 */
export function aplicarMovimento(p: { saldo: number; tipo: TipoMovimento; quantidade: number; podeNegativo: boolean }): ResultadoMovimento {
  const erro = (m: string): ResultadoMovimento => ({ ok: false, violacao: violacao('RN-CAD-07', 'quantidade', m) });
  if (!Number.isSafeInteger(p.quantidade)) return erro('Quantidade deve ser inteira (× 10^4)');
  if (p.tipo === 'ajuste' ? p.quantidade === 0 : p.quantidade <= 0) {
    return erro(p.tipo === 'ajuste' ? 'Ajuste não pode ser zero' : 'Quantidade deve ser positiva');
  }
  const delta = p.tipo === 'saida' ? -p.quantidade : p.quantidade;
  const saldo = p.saldo + delta;
  if (saldo < 0 && !p.podeNegativo) return erro('Saldo ficaria negativo: só o gerente pode autorizar');
  return { ok: true, delta, saldo };
}

// ---- RN-CAD-07 pela nota fiscal (T-0021) ----

export type TipoNotaEstoque = 'autorizada' | 'cancelada';

/** Item de nota como o cadastros o lê do evento do faturamento: campos opcionais (leitor tolerante). */
export interface ItemNotaEstoque {
  produto_id?: string | null;
  filial_id?: string | null;
  quantidade?: number | null;
}

export interface MovimentoDaNota {
  /** Posição do item na lista da nota (base 0): compõe o `external_id` do movimento. */
  indice: number;
  filial_id: string;
  produto_id: string;
  tipo: 'entrada' | 'saida';
  /** Positiva, × 10^4 (CHECK do banco: quantidade > 0 em entrada e saída). */
  quantidade: number;
}

/**
 * RN-CAD-07: só a nota de produção move o estoque, ou a de filial com "faturamento real com NF-e simulada" ligada
 * (homologação que vale como faturamento real, decisão R-20261122-022626). O cadastros não lê a bandeira no
 * faturamento: usa o campo `conta_como_real` do evento.
 */
export function deveMoverEstoque(p: { ambiente: string; conta_como_real?: boolean | null }): boolean {
  return p.ambiente === 'producao' || p.conta_como_real === true;
}

/**
 * RN-CAD-07: nota autorizada dá saída; nota cancelada devolve (entrada). SEM a trava de negativo: a nota autorizada é
 * fato consumado (a trava continua só no pedido e na aprovação). Item sem produto, filial ou quantidade inteira positiva é ignorado.
 */
export function movimentosDaNota(tipo: TipoNotaEstoque, itens: readonly ItemNotaEstoque[]): MovimentoDaNota[] {
  const saida = tipo === 'autorizada';
  const r: MovimentoDaNota[] = [];
  itens.forEach((i, indice) => {
    if (!i.produto_id || !i.filial_id || typeof i.quantidade !== 'number' || !Number.isSafeInteger(i.quantidade) || i.quantidade <= 0) return;
    r.push({ indice, filial_id: i.filial_id, produto_id: i.produto_id, tipo: saida ? 'saida' : 'entrada', quantidade: i.quantidade });
  });
  return r;
}
