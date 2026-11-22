import type { IbsCbsGrupo, IsItem, ItemCalculo, RegraTributaria } from '../contracts';
import { aplicarPercentual, BASE_PERCENTUAL, divArredonda, numeradorPercentual, numeradorPorUnidade, valorOperacao, type ModoArredondamento } from './dinheiro';
import type { CodigoErroCalculo } from './erros';

/**
 * IBS, CBS e IS na NF-e (RF-FIS-03, RN-FIS-03). Fonte: NT 2025.002-RTC (grupos IBSCBS/gIBSCBS e gIS), LC 214/2025 e o código da Calculadora RTC da RFB
 * (github.com/ReceitaFederal/calculadora-rtc-regime-regular: ElementoBaseCalculo e BaseCalculoUnificadaService). A versão da NT vem da regra
 * (`versao_nt_rtc`) e é devolvida no resultado; sem ela o cálculo é recusado. Regra do vBC, vNF, arredondamento e alíquotas de 2026: ver o cabeçalho
 * de `contracts/index.ts` (explicadas lá, num lugar só).
 *
 * Premissas: os componentes v_ii, v_icms_uf_dest, v_fcp_uf_dest, v_icms_mono e v_issqn vêm do item (padrão 0), como a calculadora os recebe; o motor
 * trata todo item como bem (sem ISSQN próprio).
 */

/** Modo do IBS/CBS/IS (decisão de 22/11/2026): meio-para-par, igual à Calculadora RTC. Os demais tributos seguem meio para cima (RN-CORE-03). */
export const MODO_RTC: ModoArredondamento = 'meio_para_par';

/** CST de IBS/CBS (tabela oficial v1.60) com valor calculado: tributação integral/uniforme (000, 010) e com redução de alíquota (011, 200). */
const CST_SEM_REDUCAO = ['000', '010'];
const CST_COM_REDUCAO = ['011', '200'];
/** Sem valor (grupo só com CST e cClassTrib): isenção (400), imunidade/não incidência (410) e suspensão (550). */
// premissa: suspensão sem valor destacado; conferir com a NT 2025.002-RTC v1.53 na homologação, T-0046.
const CST_SEM_VALOR = ['400', '410', '550'];
/** Total (a regra de cada CST do IS): só o 000 tributa; 100..600 saem sem valor (500 = alíquota zero). */
const CST_IS_SEM_VALOR = ['100', '200', '300', '400', '500', '600'];

type Falha = { ok: false; codigo: CodigoErroCalculo; mensagem: string };
export type ResultadoIbsCbs =
  | { ok: true; ibs_cbs: IbsCbsGrupo; versao_nt_rtc: string; v_bc: number; v_ibs_uf: number; v_ibs_mun: number; v_ibs: number; v_cbs: number }
  | Falha;
export type ResultadoIs = { ok: true; is: IsItem; versao_nt_rtc: string; v_is: number } | Falha;

/** pAliqEfet (4 casas) = alíquota × (100% − redução), no modo do IBS/CBS (meio-para-par, como a calculadora). */
export function aliquotaEfetiva(aliquota: number, reducao: number, modo: ModoArredondamento = MODO_RTC): number {
  return Number(divArredonda(BigInt(aliquota) * (BASE_PERCENTUAL - BigInt(reducao)), BASE_PERCENTUAL, modo));
}

/**
 * Cabeçalho comum das regras de IBS/CBS e de IS (RN-FIS-03): CST e cClassTrib preenchidos, versão da NT informada e cClassTrib que começa com o CST
 * (os 3 primeiros dígitos são o CST, como na tabela oficial). A existência do cClassTrib na tabela é conferida no cadastro da regra, não aqui.
 * Devolve a falha, ou null quando está tudo certo.
 */
export function validarCabecalhoRtc(r: RegraTributaria, rotulo: 'IBS/CBS' | 'IS', cst: string | null, classe: string | null): Falha | null {
  const nomes = rotulo === 'IS' ? 'cst_is e c_class_trib_is' : 'cst_ibs_cbs e c_class_trib';
  if (cst === null || classe === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (${rotulo}) exige ${nomes}.` };
  if (r.versao_nt_rtc === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (${rotulo}) não informa a versão da NT 2025.002-RTC (RN-FIS-03).` };
  if (classe.slice(0, 3) !== cst) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `O cClassTrib ${classe} (${rotulo}) da regra ${r.id} não pertence ao CST ${cst} (os 3 primeiros dígitos são o CST).` };
  return null;
}

export interface ContextoIbsCbs {
  item: ItemCalculo;
  regra: RegraTributaria;
  /** Data de emissão AAAA-MM-DD: decide quais componentes entram na vBC (ICMS e afins só de 2026 a 2032; IS só a partir de 2027). */
  data_emissao: string;
  v_icms: number;
  v_fcp: number;
  v_pis: number;
  v_cofins: number;
  /** vIS do item (integra a BC só a partir de 2027). */
  v_is: number;
  modo?: ModoArredondamento;
}

/**
 * vBC do IBS/CBS (fórmula e fonte no cabeçalho de contracts/index.ts). Tudo em centavos inteiros: a soma é exata e há um único arredondamento (o
 * dos próprios componentes, já em centavos). O vIPI não entra.
 */
export function baseIbsCbs(item: ItemCalculo, v: Pick<ContextoIbsCbs, 'v_icms' | 'v_fcp' | 'v_pis' | 'v_cofins' | 'v_is' | 'data_emissao'>): number {
  const ano = Number(v.data_emissao.slice(0, 4));
  const transicaoIcms = ano >= 2026 && ano <= 2032;
  const icms = transicaoIcms ? v.v_icms + item.v_icms_uf_dest + v.v_fcp + item.v_fcp_uf_dest + item.v_icms_mono : 0;
  const is = ano >= 2027 ? v.v_is : 0;
  return valorOperacao(item) + item.v_ii + is - v.v_pis - v.v_cofins - icms - item.v_issqn;
}

/**
 * RF-FIS-03 / RN-FIS-03: IBS UF, IBS Mun e CBS do item, no leiaute da NT. CST 000/010 não aceitam redução; 011/200 exigem p_red_ibs e p_red_cbs;
 * 400/410/550 saem sem valor; os demais (220, 221, 222, 510, 515, 620, 8xx) são recusados (CODIGO_NAO_SUPORTADO) até o lote que os cobrir.
 */
export function calcularIbsCbsItem(c: ContextoIbsCbs): ResultadoIbsCbs {
  const r = c.regra;
  const modo = c.modo ?? MODO_RTC;
  const falha = (codigo: CodigoErroCalculo, mensagem: string): Falha => ({ ok: false, codigo, mensagem });
  const { cst_ibs_cbs: cst, c_class_trib: classe } = r;
  const cab = validarCabecalhoRtc(r, 'IBS/CBS', cst, classe);
  if (cab) return cab;
  if (cst === null || classe === null || r.versao_nt_rtc === null) return falha('REGRA_INCOMPLETA', `A regra ${r.id} (IBS/CBS) está incompleta.`);
  const versao_nt_rtc = r.versao_nt_rtc;
  if (CST_SEM_VALOR.includes(cst)) return { ok: true, ibs_cbs: { cst, c_class_trib: classe }, versao_nt_rtc, v_bc: 0, v_ibs_uf: 0, v_ibs_mun: 0, v_ibs: 0, v_cbs: 0 };
  const reduz = CST_COM_REDUCAO.includes(cst);
  if (!reduz && !CST_SEM_REDUCAO.includes(cst)) return falha('CODIGO_NAO_SUPORTADO', `O CST ${cst} de IBS/CBS ainda não é calculado pelo motor (suportados: 000, 010, 011, 200, 400, 410 e 550).`);
  if (r.p_ibs_uf === null || r.p_ibs_mun === null || r.p_cbs === null) return falha('REGRA_INCOMPLETA', `A regra ${r.id} (CST ${cst}) exige p_ibs_uf, p_ibs_mun e p_cbs.`);
  if (reduz && (r.p_red_ibs === null || r.p_red_cbs === null)) return falha('REGRA_INCOMPLETA', `A regra ${r.id} (CST ${cst}) exige p_red_ibs e p_red_cbs.`);
  if (!reduz && ((r.p_red_ibs ?? 0) > 0 || (r.p_red_cbs ?? 0) > 0)) return falha('REGRA_INCOMPLETA', `O CST ${cst} é sem redução de alíquota, mas a regra ${r.id} traz p_red_ibs/p_red_cbs.`);
  const bc = baseIbsCbs(c.item, c);
  if (bc < 0) return falha('BASE_NEGATIVA', 'A base de IBS/CBS ficou negativa (desconto ou tributos excluídos maiores que o valor da operação).');
  const redIbs = r.p_red_ibs ?? 0;
  const redCbs = r.p_red_cbs ?? 0;
  const efUf = aliquotaEfetiva(r.p_ibs_uf, redIbs, modo);
  const efMun = aliquotaEfetiva(r.p_ibs_mun, redIbs, modo);
  const efCbs = aliquotaEfetiva(r.p_cbs, redCbs, modo);
  const v_ibs_uf = aplicarPercentual(bc, efUf, modo);
  const v_ibs_mun = aplicarPercentual(bc, efMun, modo);
  const v_cbs = aplicarPercentual(bc, efCbs, modo);
  const v_ibs = v_ibs_uf + v_ibs_mun;
  const gRed = (p_red_aliq: number, p_aliq_efet: number) => (reduz ? { g_red: { p_red_aliq, p_aliq_efet } } : {});
  return {
    ok: true,
    ibs_cbs: {
      cst,
      c_class_trib: classe,
      v_bc: bc,
      g_ibs_uf: { p_ibs_uf: r.p_ibs_uf, ...gRed(redIbs, efUf), v_ibs_uf },
      g_ibs_mun: { p_ibs_mun: r.p_ibs_mun, ...gRed(redIbs, efMun), v_ibs_mun },
      v_ibs,
      g_cbs: { p_cbs: r.p_cbs, ...gRed(redCbs, efCbs), v_cbs },
    },
    versao_nt_rtc,
    v_bc: bc,
    v_ibs_uf,
    v_ibs_mun,
    v_ibs,
    v_cbs,
  };
}

export interface ContextoIs {
  item: ItemCalculo;
  regra: RegraTributaria;
  modo?: ModoArredondamento;
}

/**
 * RF-FIS-03 / RN-FIS-03: Imposto Seletivo (gIS, NT 2025.002-RTC; LC 214 arts. 413 a 422). BC (vBCIS) = valorOperacao do item (o IS não integra a
 * própria base). CST 000: ad valorem (p_is × BC), específica (valor_unidade_is × qTrib) ou combinada ("ad valorem e ad rem" da tabela oficial): na
 * combinada as duas partes são somadas na escala exata e o vIS é arredondado uma só vez. 100..600 saem só com CST e cClassTrib. O grupo só existe
 * quando há regra de IS para o NCM/cClassTrib.
 */
export function calcularIsItem(c: ContextoIs): ResultadoIs {
  const r = c.regra;
  const modo = c.modo ?? MODO_RTC;
  const { cst_is: cst, c_class_trib_is: classe } = r;
  const cab = validarCabecalhoRtc(r, 'IS', cst, classe);
  if (cab) return cab;
  if (cst === null || classe === null || r.versao_nt_rtc === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (IS) está incompleta.` };
  const versao_nt_rtc = r.versao_nt_rtc;
  if (CST_IS_SEM_VALOR.includes(cst)) return { ok: true, is: { cst_is: cst, c_class_trib_is: classe }, versao_nt_rtc, v_is: 0 };
  if (cst !== '000') return { ok: false, codigo: 'CODIGO_NAO_SUPORTADO', mensagem: `O CST ${cst} de IS é inválido (000 ou 100..600).` };
  if (r.p_is === null && r.valor_unidade_is === null) return { ok: false, codigo: 'REGRA_INCOMPLETA', mensagem: `A regra ${r.id} (IS CST 000) exige p_is ou valor_unidade_is.` };
  const bc = valorOperacao(c.item);
  if (bc < 0) return { ok: false, codigo: 'BASE_NEGATIVA', mensagem: 'O desconto é maior que o valor do item: base de IS negativa.' };
  const advalorem = r.p_is === null ? 0n : numeradorPercentual(bc, r.p_is);
  const adrem = r.valor_unidade_is === null ? 0n : numeradorPorUnidade(c.item.quantidade, r.valor_unidade_is);
  const v_is = Number(divArredonda(advalorem + adrem, BASE_PERCENTUAL, modo));
  return {
    ok: true,
    v_is,
    versao_nt_rtc,
    is: {
      cst_is: cst,
      c_class_trib_is: classe,
      v_bc_is: bc,
      ...(r.p_is !== null ? { p_is: r.p_is } : {}),
      ...(r.valor_unidade_is !== null ? { p_is_espec: r.valor_unidade_is, q_trib: c.item.quantidade, ...(c.item.u_trib ? { u_trib: c.item.u_trib } : {}) } : {}),
      v_is,
    },
  };
}
