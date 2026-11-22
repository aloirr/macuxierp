import type { StatusPedido } from '../contracts';

/** Item do pedido como o faturamento enxerga: Qtd4 inteiro (4 casas implícitas). */
export interface ItemFaturavel {
  sequencia: number;
  quantidade: number;
  quantidade_faturada: number;
}
export interface ItemDeNota {
  sequencia: number;
  quantidade: number;
  valor_centavos?: number;
}

export type CodigoRecusaNota = 'status_invalido' | 'nota_sem_itens' | 'quantidade_invalida' | 'sequencia_inexistente' | 'quantidade_acima_do_saldo' | 'quantidade_acima_do_faturado' | 'valor_acima_do_faturado' | 'valor_faturado_incoerente';

export type ResultadoNota =
  | { ok: true; status: StatusPedido; itens: { sequencia: number; quantidade_faturada: number }[]; valor_centavos: number }
  | { ok: false; rn: 'RN-PED-02'; codigo: CodigoRecusaNota; mensagem: string };

const recusa = (codigo: CodigoRecusaNota, mensagem: string): ResultadoNota => ({ ok: false, rn: 'RN-PED-02', codigo, mensagem });

/** Soma as linhas da nota por sequência; `null` = quantidade inválida (não inteira ou <= 0). */
function somarPorSequencia(itensNota: readonly ItemDeNota[]): { soma: Map<number, number>; valor: number } | null {
  const soma = new Map<number, number>();
  let valor = 0;
  for (const i of itensNota) {
    if (!Number.isInteger(i.quantidade) || i.quantidade <= 0) return null;
    soma.set(i.sequencia, (soma.get(i.sequencia) ?? 0) + i.quantidade);
    valor += i.valor_centavos ?? 0;
  }
  return { soma, valor };
}

function aplicar(
  itens: readonly ItemFaturavel[], itensNota: readonly ItemDeNota[], statusAtual: StatusPedido, origens: readonly StatusPedido[], sinal: 1 | -1,
): ResultadoNota {
  if (!origens.includes(statusAtual)) return recusa('status_invalido', `Status ${statusAtual} não recebe esta nota; esperado: ${origens.join(', ')}`);
  if (itensNota.length === 0) return recusa('nota_sem_itens', 'Nota sem itens');
  const somado = somarPorSequencia(itensNota);
  if (!somado) return recusa('quantidade_invalida', 'Quantidade da nota deve ser inteira e maior que zero');
  for (const seq of somado.soma.keys()) if (!itens.some((i) => i.sequencia === seq)) return recusa('sequencia_inexistente', `Sequência ${seq} não existe no pedido`);
  const novos: { sequencia: number; quantidade_faturada: number }[] = [];
  for (const i of itens) {
    const qtd = i.quantidade_faturada + sinal * (somado.soma.get(i.sequencia) ?? 0);
    if (sinal === 1 && qtd > i.quantidade) return recusa('quantidade_acima_do_saldo', `Sequência ${i.sequencia}: quantidade acima do saldo a faturar`);
    if (sinal === -1 && qtd < 0) return recusa('quantidade_acima_do_faturado', `Sequência ${i.sequencia}: quantidade acima do faturado`);
    novos.push({ sequencia: i.sequencia, quantidade_faturada: qtd });
  }
  const porSeq = new Map(itens.map((i) => [i.sequencia, i.quantidade]));
  const tudo = novos.every((n) => n.quantidade_faturada === porSeq.get(n.sequencia));
  const nada = novos.every((n) => n.quantidade_faturada === 0);
  const status: StatusPedido = tudo ? 'faturado' : nada ? 'aprovado' : 'faturado_parcial';
  return { ok: true, status, itens: novos, valor_centavos: somado.valor };
}

/** RN-PED-02: nota autorizada soma ao faturado; aprovado e faturado_parcial → faturado_parcial ou faturado. Pura. */
export const aplicarNotaAutorizada = (itens: readonly ItemFaturavel[], itensNota: readonly ItemDeNota[], statusAtual: StatusPedido): ResultadoNota =>
  aplicar(itens, itensNota, statusAtual, ['aprovado', 'faturado_parcial'], 1);

/** RN-PED-02: nota cancelada subtrai do faturado; faturado e faturado_parcial → faturado_parcial ou aprovado (recuo). Pura, sem consumidor no lote 4a. */
export const aplicarNotaCancelada = (itens: readonly ItemFaturavel[], itensNota: readonly ItemDeNota[], statusAtual: StatusPedido): ResultadoNota =>
  aplicar(itens, itensNota, statusAtual, ['faturado', 'faturado_parcial'], -1);

export type ResultadoRecuo =
  | { ok: true; status: StatusPedido; itens: { sequencia: number; quantidade_faturada: number }[]; valor_faturado_centavos: number }
  | { ok: false; rn: 'RN-PED-02'; codigo: CodigoRecusaNota; mensagem: string };

/**
 * RN-PED-02: recuo do pedido por nota cancelada. Além de `aplicarNotaCancelada`, calcula o novo `valor_faturado_centavos` e garante o
 * que o gatilho do banco (0027) exige: o recuo a `aprovado` só com itens zerados e valor faturado zero; valor negativo é recusado.
 * Pura. `itens` são só os não excluídos.
 */
export function recuarPorNotaCancelada(itens: readonly ItemFaturavel[], itensNota: readonly ItemDeNota[], statusAtual: StatusPedido, valorFaturado: number): ResultadoRecuo {
  const r = aplicarNotaCancelada(itens, itensNota, statusAtual);
  if (!r.ok) return r;
  const valor = valorFaturado - r.valor_centavos;
  if (valor < 0) return { ok: false, rn: 'RN-PED-02', codigo: 'valor_acima_do_faturado', mensagem: 'Valor da nota cancelada acima do valor faturado do pedido' };
  if (r.status === 'aprovado' && (valor !== 0 || r.itens.some((i) => i.quantidade_faturada !== 0))) {
    return { ok: false, rn: 'RN-PED-02', codigo: 'valor_faturado_incoerente', mensagem: 'Recuo a aprovado exige valor faturado e quantidades faturadas zerados' };
  }
  return { ok: true, status: r.status, itens: r.itens, valor_faturado_centavos: valor };
}
