import type { CalculoEntrada, CalculoResultado, ErroFiscal, ItemResultado, RegraTributaria, TotaisCalculo, TributoRegra } from '../contracts';
import { calcularIcmsItem, ipiEntraNaBc } from './icms';
import { calcularIpiItem } from './ipi';
import { calcularPisCofinsItem } from './pis-cofins';
import { pisCofinsNoDas, selecionarRegra, type AlvoRegra, type Resultado } from './regra';

const ZERO = { v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: 0, v_cred_icms_sn: 0, v_pis: 0, v_cofins: 0 } satisfies TotaisCalculo;

/** Seleção de um tributo opcional: sem regra (ou só fora da vigência) vale como ausência (null); os demais erros (empate, sem fonte) continuam erro. */
function selecionarOpcional(regras: RegraTributaria[], alvo: AlvoRegra): Resultado<RegraTributaria | null> {
  const s = selecionarRegra(regras, alvo);
  if (s.ok) return s;
  const ausente = s.erros.every((e) => e.codigo === 'REGRA_NAO_ENCONTRADA' || e.codigo === 'REGRA_FORA_DA_VIGENCIA');
  return ausente ? { ok: true, valor: null } : s;
}

/**
 * RF-FIS-02: aplica a regra de cada item (RN-FIS-01/02/04), por tributo (ICMS, IPI, PIS, COFINS), e soma os totais. Os totais são a soma
 * dos itens já arredondados (Manual da NF-e), nunca um cálculo novo sobre o total. Erros de negócio voltam como resultado tipado, de todos os itens.
 * Ordem: IPI (alimenta a BC do ICMS/ST) → ICMS → PIS/COFINS (a exclusão do ICMS usa o vICMS do item).
 */
export function calcularDocumento(entrada: CalculoEntrada): CalculoResultado {
  const interestadual = entrada.emitente.uf !== entrada.destinatario.uf;
  const ipi_na_bc = ipiEntraNaBc(entrada.destinatario.tipo_contribuinte, entrada.destinatario.consumidor_final);
  const itens: ItemResultado[] = [];
  const erros: ErroFiscal[] = [];
  const t = { ...ZERO };
  const noDas = pisCofinsNoDas(entrada.emitente.crt);

  for (const itemEntrada of entrada.itens) {
    const alvo = (tributo: TributoRegra): AlvoRegra => ({
      ncm: itemEntrada.ncm,
      cfop: itemEntrada.cfop,
      uf_origem: entrada.emitente.uf,
      uf_destino: entrada.destinatario.uf,
      tipo_cliente: entrada.destinatario.tipo_contribuinte,
      crt: entrada.emitente.crt,
      data_emissao: entrada.operacao.data_emissao,
      item_id: itemEntrada.id,
      tributo,
    });
    const falha = (es: ErroFiscal[]) => erros.push(...es);

    const sel = selecionarRegra(entrada.regras, alvo('icms'));
    if (!sel.ok) {
      falha(sel.erros);
      continue;
    }
    const regra = sel.valor;
    const erroCalculo = (r: { codigo: ErroFiscal['codigo']; mensagem: string }, ids: string[]) => erros.push({ rn: 'RN-FIS-02', codigo: r.codigo, mensagem: r.mensagem, item_id: itemEntrada.id, regra_ids: ids });
    const nErros = erros.length;

    // IPI: só emitente industrial/equiparado; sem regra o grupo não sai (precedência do ipi_centavos: ver o campo no contrato).
    let item = itemEntrada;
    let ipi: ItemResultado['ipi'];
    if (entrada.emitente.industrial_ipi) {
      const s = selecionarRegra(entrada.regras, alvo('ipi'));
      if (!s.ok) falha(s.erros);
      else {
        const r = calcularIpiItem(itemEntrada, s.valor);
        if (!r.ok) erroCalculo(r, [s.valor.id]);
        else {
          ipi = r.ipi;
          item = { ...itemEntrada, ipi_centavos: r.v_ipi };
        }
      }
    }

    const ri = calcularIcmsItem({ item, regra, interestadual, ipi_na_bc, destinatario_nao_contribuinte_final: entrada.destinatario.consumidor_final && entrada.destinatario.tipo_contribuinte !== 'contribuinte' });
    if (!ri.ok) erroCalculo(ri, [regra.id]);

    // PIS e COFINS: a regra só é obrigatória no CRT 3; no DAS (CRT 1/2/4), sem regra sai CST 99 sem valor.
    const pc: Partial<Record<'pis' | 'cofins', { grupo: NonNullable<ItemResultado['pis']>; v: number }>> = {};
    for (const tr of ['pis', 'cofins'] as const) {
      const s = noDas ? selecionarOpcional(entrada.regras, alvo(tr)) : selecionarRegra(entrada.regras, alvo(tr));
      if (!s.ok) {
        falha(s.erros);
        continue;
      }
      if (!ri.ok) continue;
      const r = calcularPisCofinsItem({ tributo: tr, item, regra: s.valor, crt: entrada.emitente.crt, regime: entrada.emitente.regime_pis_cofins, v_icms: ri.icms.v_icms ?? 0 });
      if (!r.ok) erroCalculo(r, s.valor ? [s.valor.id] : []);
      else pc[tr] = { grupo: r.grupo, v: r.v_valor };
    }
    if (erros.length > nErros || !ri.ok) continue;

    const i = ri.icms;
    itens.push({
      item_id: item.id,
      icms: i,
      ...(ipi ? { ipi } : {}),
      ...(pc.pis ? { pis: pc.pis.grupo } : {}),
      ...(pc.cofins ? { cofins: pc.cofins.grupo } : {}),
      regra: { id: regra.id, fonte: regra.fonte as NonNullable<typeof regra.fonte>, versao: regra.versao },
    });
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
    t.v_pis += pc.pis?.v ?? 0;
    t.v_cofins += pc.cofins?.v ?? 0;
  }
  if (erros.length > 0) return { ok: false, erros: erros as [ErroFiscal, ...ErroFiscal[]] };
  t.v_nf = t.v_prod - t.v_desc + t.v_frete + t.v_seg + t.v_outro + t.v_st + t.v_fcp_st + t.v_ipi;
  return { ok: true, valor: { operacao: interestadual ? 'interestadual' : 'interna', itens, totais: t } };
}
