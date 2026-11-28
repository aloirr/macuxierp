/**
 * ICMS-ST e IPI por regra no faturado do pedido (T-0132, RN-FIS-05, decisão 63 A). Funções puras.
 * O pedido não calcula nem inventa alíquota: só repassa o que a nota traz. Sem regra o campo é omitido ("sem regra");
 * emissor antigo sem `regra_aplicada` conta como sem regra. Dinheiro em centavos; alíquota com 4 casas (180000 = 18,0000%).
 */
export interface ImpostoCalculadoNota { v_bc: number; p_aliq: number; v_valor: number }
export interface TotalImpostoNota { v_bc: number; v_valor: number }
export interface RegraAplicadaNota { st: boolean; ipi: boolean }

export interface ItemNotaFiscal {
  sequencia: number;
  regra_aplicada?: RegraAplicadaNota;
  calc_st?: ImpostoCalculadoNota;
  calc_ipi?: ImpostoCalculadoNota;
}
export interface TotalImpostosNota { calc_st?: TotalImpostoNota; calc_ipi?: TotalImpostoNota }

const IMPOSTOS = [['st', 'calc_st'], ['ipi', 'calc_ipi']] as const;

/** Item como sai no evento: `regra_aplicada` só se a nota a trouxe; `calc_*` só com regra aplicada (0 só com regra). */
function normalizar(i: ItemNotaFiscal): ItemNotaFiscal {
  const saida: ItemNotaFiscal = { sequencia: i.sequencia };
  if (!i.regra_aplicada) return saida;
  const aplicada = { st: false, ipi: false };
  for (const [imp, campo] of IMPOSTOS) {
    const calc = i[campo];
    if (i.regra_aplicada[imp] === true && calc) {
      aplicada[imp] = true;
      saida[campo] = { v_bc: calc.v_bc, p_aliq: calc.p_aliq, v_valor: calc.v_valor };
    }
  }
  saida.regra_aplicada = aplicada;
  return saida;
}

/** Total de cada imposto: só se TODOS os itens (os da nota, em nota parcial) têm regra daquele imposto; senão omitido. */
function totalizar(itens: readonly ItemNotaFiscal[]): TotalImpostosNota {
  const total: TotalImpostosNota = {};
  if (itens.length === 0) return total;
  for (const [imp, campo] of IMPOSTOS) {
    if (!itens.every((i) => i.regra_aplicada?.[imp] === true && i[campo] !== undefined)) continue;
    total[campo] = itens.reduce((s, i) => ({ v_bc: s.v_bc + (i[campo]?.v_bc ?? 0), v_valor: s.v_valor + (i[campo]?.v_valor ?? 0) }), { v_bc: 0, v_valor: 0 });
  }
  return total;
}

/** RN-FIS-05: itens normalizados e o total da nota (só dos itens faturados nela). */
export function impostosDaNota(itens: readonly ItemNotaFiscal[]): { itens: ItemNotaFiscal[]; total: TotalImpostosNota } {
  const norm = itens.map(normalizar);
  return { itens: norm, total: totalizar(norm) };
}

/** RN-FIS-05: violações da regra 63 A num payload já montado (vazio = conforme). Para o teste de ponta e quem consome o evento. */
export function conferirRegra63A(itens: readonly ItemNotaFiscal[], total: TotalImpostosNota): string[] {
  const v: string[] = [];
  for (const i of itens) {
    for (const [imp, campo] of IMPOSTOS) {
      const aplicada = i.regra_aplicada?.[imp] === true;
      if (!aplicada && i[campo] !== undefined) v.push(`item_${i.sequencia}_${campo}_sem_regra`);
      if (aplicada && i[campo] === undefined) v.push(`item_${i.sequencia}_${campo}_ausente_com_regra`);
    }
  }
  for (const [imp, campo] of IMPOSTOS) {
    const todos = itens.length > 0 && itens.every((i) => i.regra_aplicada?.[imp] === true);
    if (!todos && total[campo] !== undefined) v.push(`total_${campo}_sem_todos_com_regra`);
    if (todos && total[campo] === undefined) v.push(`total_${campo}_ausente`);
  }
  return v;
}
