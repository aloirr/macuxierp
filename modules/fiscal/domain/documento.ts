import type { CalculoEntrada, CalculoResultado, CargaAproximadaItem, ErroFiscal, ItemResultado, RegraRtcUsada, RegraTributaria, TotaisCalculo, TributoRegra } from '../contracts';
import { calcularCargaAproximada, type ResultadoCarga } from './carga-aproximada';
import type { ModoArredondamento } from './dinheiro';
import { calcularIbsCbsItem, calcularIsItem, MODO_RTC } from './ibs-cbs';
import { calcularIcmsItem, ipiEntraNaBc } from './icms';
import { calcularIpiItem } from './ipi';
import { calcularPisCofinsItem } from './pis-cofins';
import { pisCofinsNoDas, selecionarRegra, type AlvoRegra, type Resultado } from './regra';

/** Abertura por esfera da carga aproximada (tudo do resultado, menos o vTotTrib, que sai no próprio item). */
const abertura = ({ v_tot_trib: _v, ...resto }: ResultadoCarga): CargaAproximadaItem => resto;

const ZERO = { v_bc: 0, v_icms: 0, v_bc_st: 0, v_st: 0, v_fcp: 0, v_fcp_st: 0, v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_nf: 0, v_cred_icms_sn: 0, v_pis: 0, v_cofins: 0 } satisfies TotaisCalculo;

/** Seleção de um tributo opcional: sem regra (ou só fora da vigência) vale como ausência (null); os demais erros (empate, sem fonte) continuam erro. */
function selecionarOpcional(regras: RegraTributaria[], alvo: AlvoRegra): Resultado<RegraTributaria | null> {
  const s = selecionarRegra(regras, alvo);
  if (s.ok) return s;
  const ausente = s.erros.every((e) => e.codigo === 'REGRA_NAO_ENCONTRADA' || e.codigo === 'REGRA_FORA_DA_VIGENCIA');
  return ausente ? { ok: true, valor: null } : s;
}

/**
 * Opções do domínio (fora do contrato @1 de propósito; a API as passa quando precisar):
 *  - `arredondamento`: modo do IBS/CBS/IS; padrão 'meio_para_par' (decisão de 22/11/2026, igual à Calculadora RTC da RFB). ICMS, IPI, PIS e COFINS
 *    seguem sempre meio para cima (RN-CORE-03).
 * O vNF nunca soma IBS/CBS/IS; o total com eles sai em `totais.v_nf_tot` (regra e alíquotas de 2026 no cabeçalho de contracts/index.ts).
 */
export interface OpcoesDocumento {
  arredondamento?: ModoArredondamento;
}

/**
 * RF-FIS-02/03/04: aplica a regra de cada item (RN-FIS-01/02/04), por tributo (ICMS, IPI, PIS, COFINS), e soma os totais. Os totais são a soma
 * dos itens já arredondados (Manual da NF-e), nunca um cálculo novo sobre o total. Erros de negócio voltam como resultado tipado, de todos os itens.
 * Ordem: IPI (alimenta a BC do ICMS/ST) → ICMS → PIS/COFINS (a exclusão do ICMS usa o vICMS do item) → IS → IBS/CBS (a BC tira ICMS, PIS e COFINS e soma o IS)
 * → carga aproximada (RF-FIS-04, só se o item traz `carga_aproximada`). IS e IBS/CBS são opcionais: sem regra vigente o grupo não sai.
 */
export function calcularDocumento(entrada: CalculoEntrada, opcoes: OpcoesDocumento = {}): CalculoResultado {
  const modo = opcoes.arredondamento ?? MODO_RTC;
  const interestadual = entrada.emitente.uf !== entrada.destinatario.uf;
  const ipi_na_bc = ipiEntraNaBc(entrada.destinatario.tipo_contribuinte, entrada.destinatario.consumidor_final);
  const itens: ItemResultado[] = [];
  const erros: ErroFiscal[] = [];
  const t: TotaisCalculo = { ...ZERO };
  // Totais opcionais: só saem quando houver cálculo (sem regra RTC, sem IS ou sem tabela do IBPT ficam ausentes, não 0).
  const rtcT = { v_bc: 0, v_ibs_uf: 0, v_ibs_mun: 0, v_ibs: 0, v_cbs: 0 };
  let temIbsCbs = false;
  let temIs = false;
  let vIs = 0;
  let temCarga = false;
  let vTotTrib = 0;
  const noDas = pisCofinsNoDas(entrada.emitente.crt);
  let temRtc = false;

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
    const erroCalculo = (r: { codigo: ErroFiscal['codigo']; mensagem: string }, ids: string[], rn = 'RN-FIS-02') => erros.push({ rn, codigo: r.codigo, mensagem: r.mensagem, item_id: itemEntrada.id, regra_ids: ids });
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
    // IS e IBS/CBS (RN-FIS-03): regra opcional; o IS entra na BC do IBS/CBS.
    const regras_rtc: RegraRtcUsada[] = [];
    const usada = (tributo: RegraRtcUsada['tributo'], r: RegraTributaria, versao_nt_rtc: string) => regras_rtc.push({ tributo, id: r.id, fonte: r.fonte as NonNullable<typeof r.fonte>, versao: r.versao, versao_nt_rtc });
    let isRes: ReturnType<typeof calcularIsItem> | undefined;
    let rtc: ReturnType<typeof calcularIbsCbsItem> | undefined;
    if (ri.ok) {
      const sIs = selecionarOpcional(entrada.regras, alvo('is'));
      if (!sIs.ok) falha(sIs.erros);
      else if (sIs.valor) {
        isRes = calcularIsItem({ item, regra: sIs.valor, modo });
        if (!isRes.ok) erroCalculo(isRes, [sIs.valor.id], 'RN-FIS-03');
        else usada('is', sIs.valor, isRes.versao_nt_rtc);
      }
      const sIbs = selecionarOpcional(entrada.regras, alvo('ibs_cbs'));
      if (!sIbs.ok) falha(sIbs.erros);
      else if (sIbs.valor) {
        rtc = calcularIbsCbsItem({ item, regra: sIbs.valor, data_emissao: entrada.operacao.data_emissao, v_icms: ri.icms.v_icms ?? 0, v_fcp: ri.icms.v_fcp ?? 0, v_pis: pc.pis?.v ?? 0, v_cofins: pc.cofins?.v ?? 0, v_is: isRes?.ok ? isRes.v_is : 0, modo });
        if (!rtc.ok) erroCalculo(rtc, [sIbs.valor.id], 'RN-FIS-03');
        else usada('ibs_cbs', sIbs.valor, rtc.versao_nt_rtc);
      }
    }
    const carga = itemEntrada.carga_aproximada ? calcularCargaAproximada(item, itemEntrada.carga_aproximada) : undefined;
    if (erros.length > nErros || !ri.ok) continue;

    const i = ri.icms;
    const versao_nt_rtc = rtc?.ok ? rtc.versao_nt_rtc : isRes?.ok ? isRes.versao_nt_rtc : undefined;
    if (versao_nt_rtc) temRtc = true;
    itens.push({
      item_id: item.id,
      icms: i,
      ...(ipi ? { ipi } : {}),
      ...(pc.pis ? { pis: pc.pis.grupo } : {}),
      ...(pc.cofins ? { cofins: pc.cofins.grupo } : {}),
      ...(isRes?.ok ? { is: isRes.is } : {}),
      ...(rtc?.ok ? { ibs_cbs: rtc.ibs_cbs } : {}),
      // Uma versão por item: a do IBS/CBS; só com IS, a do IS (se as duas regras divergirem, `regras_rtc` traz cada uma).
      ...(versao_nt_rtc ? { versao_nt_rtc } : {}),
      cfop: itemEntrada.cfop,
      ...(carga ? { v_tot_trib: carga.v_tot_trib, carga_aproximada: abertura(carga) } : {}),
      regra: { id: regra.id, fonte: regra.fonte as NonNullable<typeof regra.fonte>, versao: regra.versao },
      ...(regras_rtc.length > 0 ? { regras_rtc } : {}),
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
    t.v_pis = (t.v_pis ?? 0) + (pc.pis?.v ?? 0);
    t.v_cofins = (t.v_cofins ?? 0) + (pc.cofins?.v ?? 0);
    if (rtc?.ok) {
      temIbsCbs = true;
      rtcT.v_bc += rtc.v_bc;
      rtcT.v_ibs_uf += rtc.v_ibs_uf;
      rtcT.v_ibs_mun += rtc.v_ibs_mun;
      rtcT.v_ibs += rtc.v_ibs;
      rtcT.v_cbs += rtc.v_cbs;
    }
    if (isRes?.ok) {
      temIs = true;
      vIs += isRes.v_is;
    }
    if (carga) {
      temCarga = true;
      vTotTrib += carga.v_tot_trib;
    }
  }
  if (erros.length > 0) return { ok: false, erros: erros as [ErroFiscal, ...ErroFiscal[]] };
  t.v_nf = t.v_prod - t.v_desc + t.v_frete + t.v_seg + t.v_outro + t.v_st + t.v_fcp_st + t.v_ipi;
  if (temIbsCbs) Object.assign(t, { v_bc_ibs_cbs: rtcT.v_bc, v_ibs_uf: rtcT.v_ibs_uf, v_ibs_mun: rtcT.v_ibs_mun, v_ibs: rtcT.v_ibs, v_cbs: rtcT.v_cbs });
  if (temIs) t.v_is = vIs;
  if (temCarga) t.v_tot_trib = vTotTrib;
  if (temRtc) t.v_nf_tot = t.v_nf + rtcT.v_ibs + rtcT.v_cbs + vIs;
  return { ok: true, valor: { operacao: interestadual ? 'interestadual' : 'interna', itens, totais: t } };
}
