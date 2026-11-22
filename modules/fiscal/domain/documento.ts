import type { CalculoEntrada, CalculoResultado, ErroFiscal, ItemResultado, TotaisCalculo } from '../contracts';
import { calcularIcmsItem, ipiEntraNaBc } from './icms';
import { selecionarRegra } from './regra';

const ZERO: TotaisCalculo = { v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: 0, v_cred_icms_sn: 0 };

/**
 * RF-FIS-02: aplica a regra de cada item (RN-FIS-01/02/04) e soma os totais. Os totais são a soma dos itens já arredondados
 * (Manual da NF-e), nunca um cálculo novo sobre o total. Erros de negócio voltam como resultado tipado, de todos os itens.
 */
export function calcularDocumento(entrada: CalculoEntrada): CalculoResultado {
  const interestadual = entrada.emitente.uf !== entrada.destinatario.uf;
  const ipi_na_bc = ipiEntraNaBc(entrada.destinatario.tipo_contribuinte, entrada.destinatario.consumidor_final);
  const itens: ItemResultado[] = [];
  const erros: ErroFiscal[] = [];
  const t = { ...ZERO };

  for (const item of entrada.itens) {
    const sel = selecionarRegra(entrada.regras, {
      ncm: item.ncm,
      cfop: item.cfop,
      uf_origem: entrada.emitente.uf,
      uf_destino: entrada.destinatario.uf,
      tipo_cliente: entrada.destinatario.tipo_contribuinte,
      crt: entrada.emitente.crt,
      data_emissao: entrada.operacao.data_emissao,
      item_id: item.id,
    });
    if (!sel.ok) {
      erros.push(...sel.erros);
      continue;
    }
    const regra = sel.valor;
    const r = calcularIcmsItem({ item, regra, interestadual, ipi_na_bc, destinatario_nao_contribuinte_final: entrada.destinatario.consumidor_final && entrada.destinatario.tipo_contribuinte !== 'contribuinte' });
    if (!r.ok) {
      erros.push({ rn: 'RN-FIS-02', codigo: r.codigo, mensagem: r.mensagem, item_id: item.id, regra_ids: [regra.id] });
      continue;
    }
    const i = r.icms;
    itens.push({ item_id: item.id, icms: i, regra: { id: regra.id, fonte: regra.fonte as NonNullable<typeof regra.fonte>, versao: regra.versao } });
    t.v_bc += i.v_bc ?? 0;
    t.v_icms += i.v_icms ?? 0;
    t.v_bc_st += i.v_bc_st ?? 0;
    t.v_st += i.v_icms_st ?? 0;
    t.v_fcp += i.v_fcp ?? 0;
    t.v_fcp_st += i.v_fcp_st ?? 0;
    t.v_cred_icms_sn += i.v_cred_icms_sn ?? 0;
    t.v_prod += item.valor_bruto_centavos;
    t.v_desc += item.desconto_centavos;
    t.v_frete += item.frete_centavos;
    t.v_seg += item.seguro_centavos;
    t.v_outro += item.outras_despesas_centavos;
    t.v_ipi += item.ipi_centavos;
  }
  if (erros.length > 0) return { ok: false, erros: erros as [ErroFiscal, ...ErroFiscal[]] };
  t.v_nf = t.v_prod - t.v_desc + t.v_frete + t.v_seg + t.v_outro + t.v_st + t.v_fcp_st + t.v_ipi;
  return { ok: true, valor: { operacao: interestadual ? 'interestadual' : 'interna', itens, totais: t } };
}
