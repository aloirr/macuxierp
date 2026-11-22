/**
 * Escolha do CFOP de saída por item e mapeamento do `ind_ie_dest` (RN-FIS-01: o CFOP é filtro da regra e o `fiscal.calculo@1` o recebe na entrada).
 * Funções puras. Fonte: tabela de CFOP do Ajuste SINIEF 07/2001 (anexo "Tabela de Códigos Fiscais de Operações e Prestações"):
 *  - 5101/6101 venda de produção do estabelecimento (emitente industrial, `industrial_ipi`); 5102/6102 venda de mercadoria adquirida de terceiros;
 *  - interestadual para não contribuinte (`ind_ie_dest` 9): 6107 (produção própria) e 6108 (de terceiros);
 *  - ST, quando a regra de ICMS escolhida resulta em CST 10/30/70 ou CSOSN 201/202/203 (substituto): 5401/6401 (produção própria) e 5403/6403 (de terceiros);
 *    CST 60 / CSOSN 500 (substituído, ST já retido na compra): 5405 (interna) e 6404 (interestadual), com ou sem emitente industrial;
 *  - interna (5xxx) quando a UF do emitente é a do destinatário; interestadual (6xxx) nas demais. Exterior (7xxx) e devolução ficam fora (a porta só tem venda).
 * Limite da v1 (README do fiscal): o emitente industrial usa 5101/6101 em todo item.
 */
export type TipoContribuinte = 'contribuinte' | 'isento' | 'nao_contribuinte';
export type IndIeDest = '1' | '2' | '9';

export interface EntradaCfop {
  uf_emitente: string;
  uf_destino: string;
  industrial_ipi: boolean;
  tipo_contribuinte: TipoContribuinte;
}

const ehInterna = (e: EntradaCfop): boolean => e.uf_emitente === e.uf_destino;

/** `ind_ie_dest` → tipo de contribuinte e consumidor final (mesma regra do `indFinal` do faturamento: consumidor final se não for contribuinte de ICMS). */
export function destinatarioPeloIndIe(ind: IndIeDest): { tipo_contribuinte: TipoContribuinte; consumidor_final: boolean } {
  const tipo_contribuinte = ind === '1' ? 'contribuinte' : ind === '2' ? 'isento' : 'nao_contribuinte';
  return { tipo_contribuinte, consumidor_final: ind !== '1' };
}

/** CFOP da primeira passada (antes de conhecer o CST do ICMS). */
export function cfopBase(e: EntradaCfop): string {
  if (ehInterna(e)) return e.industrial_ipi ? '5101' : '5102';
  if (e.tipo_contribuinte === 'nao_contribuinte') return e.industrial_ipi ? '6107' : '6108';
  return e.industrial_ipi ? '6101' : '6102';
}

/** Refina o CFOP pelo código de ICMS (CST/CSOSN) que a regra devolveu; sem ST fica o CFOP base. */
export function cfopPeloIcms(e: EntradaCfop, codigoIcms: string | undefined): string {
  const p = ehInterna(e) ? '5' : '6';
  switch (codigoIcms) {
    case '10':
    case '30':
    case '70':
    case '201':
    case '202':
    case '203':
      return `${p}${e.industrial_ipi ? '401' : '403'}`;
    case '60':
    case '500':
      return ehInterna(e) ? '5405' : '6404';
    default:
      return cfopBase(e);
  }
}
