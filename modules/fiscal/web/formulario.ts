/**
 * Formulário da regra fiscal (T-0127): campos como dados, na grade de 12 colunas (regra 11), valores em texto digitado e o corpo que vai à API
 * (`POST /v1/fiscal/regras`; `PUT /v1/fiscal/regras/:id` com `If-Match`). A regra vem do `domain` (`validarRegraParaCadastro`); a API revalida.
 * Botões só na barra do rodapé da página (regra 12): `acoesDaRegra`.
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { RegraEntrada, type RegraDetalhe } from '../contracts';
import { validarRegraParaCadastro } from '../domain';

export type TipoCampoRegra = 'texto' | 'selecao' | 'percentual' | 'decimal4' | 'booleano3' | 'data';
export type ColunasRegra = 1 | 2 | 3 | 4 | 6 | 8 | 12;
export interface CampoRegra {
  nome: string;
  rotulo: string;
  tipo: TipoCampoRegra;
  /** Largura na grade de 12; cada linha do grupo soma até 12. */
  colunas: ColunasRegra;
  obrigatorio?: boolean;
  opcoes?: readonly { valor: string; rotulo: string }[];
  ajuda?: string;
}
export interface GrupoRegra {
  id: string;
  titulo: string;
  campos: readonly CampoRegra[];
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const TODAS = { valor: '', rotulo: 'Todos' } as const;
const UF_OPCOES = [TODAS, ...UFS.map((u) => ({ valor: u, rotulo: u }))];
const SIM_NAO = [{ valor: '', rotulo: 'Não informado' }, { valor: 'sim', rotulo: 'Sim' }, { valor: 'nao', rotulo: 'Não' }] as const;

const MOD_BC = [
  { valor: '0', rotulo: '0 – Margem de valor agregado' },
  { valor: '1', rotulo: '1 – Pauta' },
  { valor: '2', rotulo: '2 – Preço tabelado máximo' },
  { valor: '3', rotulo: '3 – Valor da operação' },
] as const;
/** modBCST do Manual da NF-e: o motor só calcula a margem de valor agregado; a API recusa as demais com mensagem em português. */
const MOD_BC_ST = [
  { valor: '', rotulo: 'Não se aplica' },
  { valor: '4', rotulo: '4 – Margem de valor agregado' },
  { valor: '5', rotulo: '5 – Pauta' },
  { valor: '0', rotulo: '0 – Preço tabelado ou máximo sugerido' },
  { valor: '1', rotulo: '1 – Lista negativa' },
  { valor: '2', rotulo: '2 – Lista positiva' },
  { valor: '3', rotulo: '3 – Lista neutra' },
] as const;
const CST_ICMS = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '00', rotulo: '00 – Tributada integralmente' }, { valor: '10', rotulo: '10 – Tributada com ST' }, { valor: '20', rotulo: '20 – Com redução de base' },
  { valor: '30', rotulo: '30 – Isenta ou não tributada, com ST' }, { valor: '40', rotulo: '40 – Isenta' }, { valor: '41', rotulo: '41 – Não tributada' },
  { valor: '50', rotulo: '50 – Suspensão' }, { valor: '51', rotulo: '51 – Diferimento' }, { valor: '60', rotulo: '60 – Cobrada antes por ST' },
  { valor: '70', rotulo: '70 – Redução de base, com ST' }, { valor: '90', rotulo: '90 – Outras' },
  { valor: '101', rotulo: '101 – Simples, com crédito' }, { valor: '102', rotulo: '102 – Simples, sem crédito' }, { valor: '103', rotulo: '103 – Simples, faixa isenta' },
  { valor: '201', rotulo: '201 – Simples, com crédito e ST' }, { valor: '202', rotulo: '202 – Simples, sem crédito e com ST' }, { valor: '203', rotulo: '203 – Simples, faixa isenta e com ST' },
  { valor: '300', rotulo: '300 – Simples, imune' }, { valor: '400', rotulo: '400 – Simples, não tributada' }, { valor: '500', rotulo: '500 – Simples, ST cobrada antes' }, { valor: '900', rotulo: '900 – Simples, outros' },
] as const;
const CRT_OPCOES = [TODAS, { valor: '1', rotulo: '1 Simples' }, { valor: '2', rotulo: '2 Sublimite' }, { valor: '3', rotulo: '3 Normal' }, { valor: '4', rotulo: '4 MEI' }] as const;

const t = (nome: string, rotulo: string, colunas: ColunasRegra, extra: Partial<CampoRegra> = {}): CampoRegra => ({ nome, rotulo, tipo: 'texto', colunas, ...extra });
const p = (nome: string, rotulo: string, colunas: ColunasRegra = 2): CampoRegra => ({ nome, rotulo, tipo: 'percentual', colunas });
const d4 = (nome: string, rotulo: string, colunas: ColunasRegra = 2): CampoRegra => ({ nome, rotulo, tipo: 'decimal4', colunas });
const sel = (nome: string, rotulo: string, colunas: ColunasRegra, opcoes: CampoRegra['opcoes'], extra: Partial<CampoRegra> = {}): CampoRegra => ({ nome, rotulo, tipo: 'selecao', colunas, opcoes, ...extra });

export const GRUPOS_REGRA: readonly GrupoRegra[] = [
  {
    id: 'alvo', titulo: 'A quem a regra se aplica',
    campos: [
      sel('tributo', 'Tributo', 2, [{ valor: 'icms', rotulo: 'ICMS' }, { valor: 'ipi', rotulo: 'IPI' }, { valor: 'pis', rotulo: 'PIS' }, { valor: 'cofins', rotulo: 'COFINS' }, { valor: 'ibs_cbs', rotulo: 'IBS/CBS' }, { valor: 'is', rotulo: 'IS' }], { obrigatorio: true }),
      t('ncm_prefixo', 'NCM (prefixo)', 2, { ajuda: 'De 2 a 8 dígitos. Deixe em branco para todos' }),
      t('cfop', 'CFOP', 1),
      sel('uf_origem', 'UF origem', 2, UF_OPCOES),
      sel('uf_destino', 'UF destino', 2, UF_OPCOES),
      sel('tipo_cliente', 'Cliente', 2, [TODAS, { valor: 'contribuinte', rotulo: 'Contribuinte' }, { valor: 'isento', rotulo: 'Isento' }, { valor: 'nao_contribuinte', rotulo: 'Não contribuinte' }]),
      sel('crt', 'CRT', 1, CRT_OPCOES),
    ],
  },
  {
    id: 'icms', titulo: 'ICMS e FCP',
    campos: [
      sel('codigo', 'CST/CSOSN', 2, CST_ICMS, { ajuda: 'CST (2 dígitos) ou CSOSN (3)' }),
      sel('mod_bc', 'Base de cálculo do ICMS', 4, MOD_BC),
      p('aliquota_icms', 'ICMS (%)', 1),
      p('reducao_bc', 'Redução (%)', 1),
      p('p_fcp', 'FCP (%)', 1),
      p('p_cred_sn', 'Crédito (%)', 1),
      p('p_dif', 'Diferido (%)', 1),
      p('p_icms_efet', 'Efetivo (%)', 1),
    ],
  },
  {
    id: 'st', titulo: 'ICMS-ST (por MVA)',
    campos: [
      sel('mod_bc_st', 'Base de cálculo da ST', 4, MOD_BC_ST, { ajuda: 'O cálculo atual atende a margem de valor agregado' }),
      p('mva_original', 'MVA (%)', 1),
      p('mva_ajustada', 'MVA ajust. (%)', 1),
      { nome: 'ajustar_mva', rotulo: 'Ajustar a MVA', tipo: 'booleano3', colunas: 2, opcoes: SIM_NAO, ajuda: 'ST interestadual exige sim ou não' },
      p('reducao_bc_st', 'Redução ST (%)', 1),
      p('aliquota_interna_destino', 'Alíq. destino (%)', 2),
      p('p_fcp_st', 'FCP ST (%)', 1),
    ],
  },
  {
    id: 'ipi-pis-cofins', titulo: 'IPI, PIS e COFINS',
    campos: [
      t('cst_ipi', 'CST IPI', 1), p('aliquota_ipi', 'IPI (%)', 1), d4('valor_unidade_ipi', 'IPI por unidade (R$)'), t('c_enq', 'Enquadramento', 2, { ajuda: 'Deixe em branco quando não houver enquadramento' }),
      t('cst_pis', 'CST PIS', 1), p('aliquota_pis', 'PIS (%)', 1), t('cst_cofins', 'CST COFINS', 2), p('aliquota_cofins', 'COFINS (%)'),
    ],
  },
  {
    id: 'ibs-cbs-is', titulo: 'Reforma tributária (IBS, CBS e IS)',
    campos: [
      t('cst_ibs_cbs', 'CST IBS/CBS', 2), t('c_class_trib', 'Classificação tributária', 2, { ajuda: 'cClassTrib, conforme a NT 2025.002-RTC' }), p('p_ibs_uf', 'IBS UF (%)'), p('p_ibs_mun', 'IBS Mun. (%)'), p('p_cbs', 'CBS (%)'), t('versao_nt_rtc', 'Versão da NT', 2),
      p('p_red_ibs', 'Redução IBS (%)'), p('p_red_cbs', 'Redução CBS (%)'), t('cst_is', 'CST IS', 2), t('c_class_trib_is', 'Classificação do IS', 2), p('p_is', 'IS (%)'), d4('valor_unidade_is', 'IS por unidade (R$)'),
    ],
  },
  {
    id: 'fonte', titulo: 'Fonte e vigência',
    campos: [
      sel('fonte_tipo', 'Tipo da fonte', 2, [{ valor: 'NT', rotulo: 'NT' }, { valor: 'convenio', rotulo: 'Convênio' }, { valor: 'anexo', rotulo: 'Anexo' }, { valor: 'lei', rotulo: 'Lei' }, { valor: 'ajuste_sinief', rotulo: 'Ajuste SINIEF' }, { valor: 'resolucao', rotulo: 'Resolução' }, { valor: 'outro', rotulo: 'Outro' }], { obrigatorio: true }),
      t('fonte_referencia', 'Referência', 4, { obrigatorio: true }),
      t('versao', 'Versão', 2, { obrigatorio: true }),
      { nome: 'vigencia_inicio', rotulo: 'Início da vigência', tipo: 'data', colunas: 2, obrigatorio: true },
      { nome: 'vigencia_fim', rotulo: 'Fim da vigência', tipo: 'data', colunas: 2 },
    ],
  },
];

export const CAMPOS_REGRA: readonly CampoRegra[] = GRUPOS_REGRA.flatMap((g) => g.campos);
export type ValoresRegra = Readonly<Record<string, string>>;
export type ErrosRegra = Record<string, string>;

/** "18,5" → 185000 (×10^4, sem float); vazio → null; formato inválido → `undefined`. Serve a alíquota, MVA e valor por unidade (mesma escala). */
export function inteiro4(texto: string): number | null | undefined {
  const s = texto.trim().replace('%', '').trim();
  if (s === '') return null;
  const m = /^(\d{1,9})(?:,(\d{1,4}))?$/.exec(s.replace(/\.(?=\d{3}\b)/g, ''));
  if (!m) return undefined;
  return Number(m[1]) * 10_000 + Number((m[2] ?? '').padEnd(4, '0'));
}
/** 185000 → "18,5"; nulo → "". */
export function texto4(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  const frac = String(n % 10_000).padStart(4, '0').replace(/0+$/, '');
  return `${Math.trunc(n / 10_000)}${frac ? `,${frac}` : ''}`;
}

const NUMERICOS = new Set(['mod_bc', 'mod_bc_st']);

/** Valores digitados de uma regra aberta (edição) ou do formulário vazio (nova). */
export function valoresDaRegra(r?: Partial<RegraDetalhe>): Record<string, string> {
  const v: Record<string, string> = {};
  const fonte = r?.fonte;
  for (const c of CAMPOS_REGRA) {
    const bruto = c.nome === 'fonte_tipo' ? fonte?.tipo : c.nome === 'fonte_referencia' ? fonte?.referencia : (r as Record<string, unknown> | undefined)?.[c.nome];
    if (c.tipo === 'percentual' || c.tipo === 'decimal4') v[c.nome] = texto4(bruto as number | null | undefined);
    else if (c.tipo === 'booleano3') v[c.nome] = bruto === true ? 'sim' : bruto === false ? 'nao' : '';
    else if (c.nome === 'c_enq' && bruto === '999') v[c.nome] = '';
    else v[c.nome] = bruto === null || bruto === undefined ? '' : String(bruto);
  }
  if (!r) {
    v.tributo = 'icms';
    v.mod_bc = '3';
  }
  return v;
}

export type ResultadoCorpoRegra = { ok: true; corpo: RegraEntrada } | { ok: false; erros: ErrosRegra };

/** Do texto digitado ao corpo da API: formato, contrato (Zod) e regras do domain. Mensagem curta por campo, sem rótulo na frente. */
export function corpoDaRegra(v: ValoresRegra): ResultadoCorpoRegra {
  const erros: ErrosRegra = {};
  const bruto: Record<string, unknown> = {};
  for (const c of CAMPOS_REGRA) {
    const texto = (v[c.nome] ?? '').trim();
    if (c.obrigatorio && texto === '') erros[c.nome] = 'Preencha este campo';
    if (c.tipo === 'percentual' || c.tipo === 'decimal4') {
      const n = inteiro4(texto);
      if (n === undefined) erros[c.nome] = 'Use números com até 4 casas, como 18,5';
      else bruto[c.nome] = n;
    } else if (c.tipo === 'booleano3') bruto[c.nome] = texto === 'sim' ? true : texto === 'nao' ? false : null;
    else if (NUMERICOS.has(c.nome) || c.nome === 'crt') bruto[c.nome] = texto === '' ? (c.nome === 'mod_bc' ? 3 : null) : Number(texto);
    else bruto[c.nome] = texto === '' ? null : texto;
  }
  const { fonte_tipo, fonte_referencia, ...resto } = bruto;
  const candidato = { ...resto, c_enq: bruto.c_enq ?? '999', fonte: fonte_tipo && fonte_referencia ? { tipo: fonte_tipo, referencia: fonte_referencia } : null };
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  const r = RegraEntrada.safeParse(candidato);
  if (!r.success) {
    for (const i of r.error.issues) erros[String(i.path[0] === 'fonte' ? 'fonte_referencia' : (i.path[0] ?? 'tributo'))] = 'Valor inválido';
    return { ok: false, erros };
  }
  for (const pr of validarRegraParaCadastro(r.data)) erros[pr.campo === 'fonte' ? 'fonte_referencia' : pr.campo] = pr.mensagem;
  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, corpo: r.data };
}

export interface AcaoRodape {
  id: 'salvar' | 'descartar' | 'excluir';
  rotulo: string;
  /** Destrutivo: vermelho, à direita da barra. */
  destrutiva?: boolean;
}
export interface BarraRodape {
  esquerda: readonly AcaoRodape[];
  direita: readonly AcaoRodape[];
}

/** Barra única do rodapé da página (regra 12): ação à esquerda, destrutiva (vermelha) à direita. Quem só vê não tem barra. */
export function acoesDaRegra(perfil: Perfil, modo: 'criar' | 'editar'): BarraRodape {
  if (!pode(perfil, 'fiscal.regra.editar')) return { esquerda: [], direita: [] };
  return {
    esquerda: [{ id: 'salvar', rotulo: modo === 'criar' ? 'Salvar regra' : 'Salvar alterações' }, { id: 'descartar', rotulo: 'Descartar' }],
    direita: modo === 'editar' ? [{ id: 'excluir', rotulo: 'Excluir regra', destrutiva: true }] : [],
  };
}
