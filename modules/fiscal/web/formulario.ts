/**
 * Formulário da regra fiscal (T-0127): campos como dados, na grade de 12 colunas (regra 11), valores em texto digitado e o corpo que vai à API
 * (`POST /v1/fiscal/regras`; `PUT /v1/fiscal/regras/:id` com `If-Match`). A regra vem do `domain` (`validarRegraParaCadastro`); a API revalida.
 * Botões só na barra do rodapé da página (regra 12): `acoesDaRegra`.
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { RegraEntrada, type RegraDetalhe } from '../contracts';
import { validarRegraParaCadastro } from '../domain';

export type TipoCampoRegra = 'texto' | 'selecao' | 'percentual' | 'decimal4' | 'booleano3' | 'data';
export type ColunasRegra = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12;
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
/** CST (Tabela B) e CSOSN do ICMS, com os nomes de `db/tabelas-fiscais/cst/tradicionais-2026-11-21.csv` (fonte: ver `fontes.json`; inclui 02, 15, 53 e 61 da NT 2023.001). */
const CST_ICMS = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '00', rotulo: '00 – Tributada integralmente' },
  { valor: '02', rotulo: '02 – Tributação monofásica própria sobre combustíveis' },
  { valor: '10', rotulo: '10 – Tributada e com cobrança do ICMS por substituição tributária' },
  { valor: '15', rotulo: '15 – Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis' },
  { valor: '20', rotulo: '20 – Com redução de base de cálculo' },
  { valor: '30', rotulo: '30 – Isenta ou não tributada e com cobrança do ICMS por substituição tributária' },
  { valor: '40', rotulo: '40 – Isenta' },
  { valor: '41', rotulo: '41 – Não tributada' },
  { valor: '50', rotulo: '50 – Suspensão' },
  { valor: '51', rotulo: '51 – Diferimento' },
  { valor: '53', rotulo: '53 – Tributação monofásica sobre combustíveis com recolhimento diferido' },
  { valor: '60', rotulo: '60 – ICMS cobrado anteriormente por substituição tributária' },
  { valor: '61', rotulo: '61 – Tributação monofásica sobre combustíveis cobrada anteriormente' },
  { valor: '70', rotulo: '70 – Com redução de base de cálculo e cobrança do ICMS por substituição tributária' },
  { valor: '90', rotulo: '90 – Outras' },
  { valor: '101', rotulo: '101 – Tributada pelo Simples Nacional com permissão de crédito' },
  { valor: '102', rotulo: '102 – Tributada pelo Simples Nacional sem permissão de crédito' },
  { valor: '103', rotulo: '103 – Isenção do ICMS no Simples Nacional para faixa de receita bruta' },
  { valor: '201', rotulo: '201 – Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária' },
  { valor: '202', rotulo: '202 – Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária' },
  { valor: '203', rotulo: '203 – Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária' },
  { valor: '300', rotulo: '300 – Imune' },
  { valor: '400', rotulo: '400 – Não tributada pelo Simples Nacional' },
  { valor: '500', rotulo: '500 – ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação' },
  { valor: '900', rotulo: '900 – Outros' },
] as const;
/** CST de IPI, PIS e COFINS: `db/tabelas-fiscais/cst/tradicionais-2026-11-21.csv`; IBS/CBS e IS: `ibs-cbs-v1.60.csv` (IT 2025.002 v1.60). Nomes iguais aos da tabela (fonte em `fontes.json`). */
const CST_IPI = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '00', rotulo: '00 – Entrada com recuperação de crédito' },
  { valor: '01', rotulo: '01 – Entrada tributada com alíquota zero' },
  { valor: '02', rotulo: '02 – Entrada isenta' },
  { valor: '03', rotulo: '03 – Entrada não-tributada' },
  { valor: '04', rotulo: '04 – Entrada imune' },
  { valor: '05', rotulo: '05 – Entrada com suspensão' },
  { valor: '49', rotulo: '49 – Outras entradas' },
  { valor: '50', rotulo: '50 – Saída tributada' },
  { valor: '51', rotulo: '51 – Saída tributada com alíquota zero' },
  { valor: '52', rotulo: '52 – Saída isenta' },
  { valor: '53', rotulo: '53 – Saída não-tributada' },
  { valor: '54', rotulo: '54 – Saída imune' },
  { valor: '55', rotulo: '55 – Saída com suspensão' },
  { valor: '99', rotulo: '99 – Outras saídas' },
] as const;
const CST_PIS = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '01', rotulo: '01 – Operação Tributável com Alíquota Básica' },
  { valor: '02', rotulo: '02 – Operação Tributável com Alíquota Diferenciada' },
  { valor: '03', rotulo: '03 – Operação Tributável com Alíquota por Unidade de Medida de Produto' },
  { valor: '04', rotulo: '04 – Operação Tributável Monofásica - Revenda a Alíquota Zero' },
  { valor: '05', rotulo: '05 – Operação Tributável por Substituição Tributária' },
  { valor: '06', rotulo: '06 – Operação Tributável a Alíquota Zero' },
  { valor: '07', rotulo: '07 – Operação Isenta da Contribuição' },
  { valor: '08', rotulo: '08 – Operação sem Incidência da Contribuição' },
  { valor: '09', rotulo: '09 – Operação com Suspensão da Contribuição' },
  { valor: '49', rotulo: '49 – Outras Operações de Saída' },
  { valor: '50', rotulo: '50 – Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno' },
  { valor: '51', rotulo: '51 – Operação com Direito a Crédito – Vinculada Exclusivamente a Receita Não Tributada no Mercado Interno' },
  { valor: '52', rotulo: '52 – Operação com Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação' },
  { valor: '53', rotulo: '53 – Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno' },
  { valor: '54', rotulo: '54 – Operação com Direito a Crédito - Vinculada a Receitas Tributadas no Mercado Interno e de Exportação' },
  { valor: '55', rotulo: '55 – Operação com Direito a Crédito - Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação' },
  { valor: '56', rotulo: '56 – Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação' },
  { valor: '60', rotulo: '60 – Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Tributada no Mercado Interno' },
  { valor: '61', rotulo: '61 – Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno' },
  { valor: '62', rotulo: '62 – Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita de Exportação' },
  { valor: '63', rotulo: '63 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno' },
  { valor: '64', rotulo: '64 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas no Mercado Interno e de Exportação' },
  { valor: '65', rotulo: '65 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação' },
  { valor: '66', rotulo: '66 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno, e de Exportação' },
  { valor: '67', rotulo: '67 – Crédito Presumido - Outras Operações' },
  { valor: '70', rotulo: '70 – Operação de Aquisição sem Direito a Crédito' },
  { valor: '71', rotulo: '71 – Operação de Aquisição com Isenção' },
  { valor: '72', rotulo: '72 – Operação de Aquisição com Suspensão' },
  { valor: '73', rotulo: '73 – Operação de Aquisição a Alíquota Zero' },
  { valor: '74', rotulo: '74 – Operação de Aquisição sem Incidência da Contribuição' },
  { valor: '75', rotulo: '75 – Operação de Aquisição por Substituição Tributária' },
  { valor: '98', rotulo: '98 – Outras Operações de Entrada' },
  { valor: '99', rotulo: '99 – Outras Operações' },
] as const;
const CST_COFINS = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '01', rotulo: '01 – Operação Tributável com Alíquota Básica' },
  { valor: '02', rotulo: '02 – Operação Tributável com Alíquota Diferenciada' },
  { valor: '03', rotulo: '03 – Operação Tributável com Alíquota por Unidade de Medida de Produto' },
  { valor: '04', rotulo: '04 – Operação Tributável Monofásica - Revenda a Alíquota Zero' },
  { valor: '05', rotulo: '05 – Operação Tributável por Substituição Tributária' },
  { valor: '06', rotulo: '06 – Operação Tributável a Alíquota zero' },
  { valor: '07', rotulo: '07 – Operação Isenta da Contribuição' },
  { valor: '08', rotulo: '08 – Operação sem Incidência da Contribuição' },
  { valor: '09', rotulo: '09 – Operação com Suspensão da Contribuição' },
  { valor: '49', rotulo: '49 – Outras Operações de Saída' },
  { valor: '50', rotulo: '50 – Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Tributada no Mercado Interno' },
  { valor: '51', rotulo: '51 – Operação com Direito a Crédito - Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno' },
  { valor: '52', rotulo: '52 – Operação com Direito a Crédito - Vinculada Exclusivamente a Receita de Exportação' },
  { valor: '53', rotulo: '53 – Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno' },
  { valor: '54', rotulo: '54 – Operação com Direito a Crédito - Vinculada a Receitas Tributadas no Mercado Interno e de Exportação' },
  { valor: '55', rotulo: '55 – Operação com Direito a Crédito - Vinculada a Receitas Não Tributadas no Mercado Interno e de Exportação' },
  { valor: '56', rotulo: '56 – Operação com Direito a Crédito - Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno e de Exportação' },
  { valor: '60', rotulo: '60 – Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Tributada no Mercado Interno' },
  { valor: '61', rotulo: '61 – Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita Não-Tributada no Mercado Interno' },
  { valor: '62', rotulo: '62 – Crédito Presumido - Operação de Aquisição Vinculada Exclusivamente a Receita de Exportação' },
  { valor: '63', rotulo: '63 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno' },
  { valor: '64', rotulo: '64 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas no Mercado Interno e de Exportação' },
  { valor: '65', rotulo: '65 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Não-Tributadas no Mercado Interno e de Exportação' },
  { valor: '66', rotulo: '66 – Crédito Presumido - Operação de Aquisição Vinculada a Receitas Tributadas e Não-Tributadas no Mercado Interno e de Exportação' },
  { valor: '67', rotulo: '67 – Crédito Presumido - Outras Operações' },
  { valor: '70', rotulo: '70 – Operação de Aquisição sem Direito a Crédito' },
  { valor: '71', rotulo: '71 – Operação de Aquisição com Isenção' },
  { valor: '72', rotulo: '72 – Operação de Aquisição com Suspensão' },
  { valor: '73', rotulo: '73 – Operação de Aquisição a Alíquota Zero' },
  { valor: '74', rotulo: '74 – Operação de Aquisição sem Incidência da Contribuição' },
  { valor: '75', rotulo: '75 – Operação de Aquisição por Substituição Tributária' },
  { valor: '98', rotulo: '98 – Outras Operações de Entrada' },
  { valor: '99', rotulo: '99 – Outras Operações' },
] as const;
const CST_IBS_CBS = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '000', rotulo: '000 – Tributação integral' },
  { valor: '010', rotulo: '010 – Tributação com alíquotas uniformes' },
  { valor: '011', rotulo: '011 – Tributação com alíquotas uniformes reduzidas' },
  { valor: '200', rotulo: '200 – Alíquota reduzida' },
  { valor: '220', rotulo: '220 – Alíquota fixa' },
  { valor: '221', rotulo: '221 – Alíquota fixa proporcional' },
  { valor: '222', rotulo: '222 – Redução de Base de Cálculo' },
  { valor: '400', rotulo: '400 – Isenção' },
  { valor: '410', rotulo: '410 – Imunidade e não incidência' },
  { valor: '510', rotulo: '510 – Diferimento' },
  { valor: '515', rotulo: '515 – Diferimento com redução de alíquota' },
  { valor: '550', rotulo: '550 – Suspensão' },
  { valor: '620', rotulo: '620 – Tributação monofásica' },
  { valor: '800', rotulo: '800 – Transferência de crédito' },
  { valor: '810', rotulo: '810 – Ajustes de IBS na ZFM' },
  { valor: '811', rotulo: '811 – Ajustes' },
  { valor: '820', rotulo: '820 – Tributação em documento específico' },
  { valor: '830', rotulo: '830 – Exclusão de base de cálculo' },
] as const;
const CST_IS = [
  { valor: '', rotulo: 'Não informado' },
  { valor: '000', rotulo: '000 – Tributado com Imposto Seletivo' },
  { valor: '100', rotulo: '100 – Imunidade' },
  { valor: '200', rotulo: '200 – Não ocorrência do Fato Gerador' },
  { valor: '300', rotulo: '300 – Devolução' },
  { valor: '400', rotulo: '400 – Suspensão' },
  { valor: '500', rotulo: '500 – Alíquota Zero' },
  { valor: '600', rotulo: '600 – Isenção' },
] as const;
const CRT_OPCOES = [TODAS, { valor: '1', rotulo: '1 – Simples Nacional' }, { valor: '2', rotulo: '2 – Simples Nacional, excesso de sublimite' }, { valor: '3', rotulo: '3 – Regime normal' }, { valor: '4', rotulo: '4 – MEI' }] as const;

const t = (nome: string, rotulo: string, colunas: ColunasRegra, extra: Partial<CampoRegra> = {}): CampoRegra => ({ nome, rotulo, tipo: 'texto', colunas, ...extra });
const p = (nome: string, rotulo: string, colunas: ColunasRegra = 2): CampoRegra => ({ nome, rotulo, tipo: 'percentual', colunas });
const d4 = (nome: string, rotulo: string, colunas: ColunasRegra = 2): CampoRegra => ({ nome, rotulo, tipo: 'decimal4', colunas });
const sel = (nome: string, rotulo: string, colunas: ColunasRegra, opcoes: CampoRegra['opcoes'], extra: Partial<CampoRegra> = {}): CampoRegra => ({ nome, rotulo, tipo: 'selecao', colunas, opcoes, ...extra });

export const GRUPOS_REGRA: readonly GrupoRegra[] = [
  {
    id: 'alvo', titulo: 'A quem a regra se aplica',
    campos: [
      sel('tributo', 'Tributo', 3, [{ valor: 'icms', rotulo: 'ICMS' }, { valor: 'ipi', rotulo: 'IPI' }, { valor: 'pis', rotulo: 'PIS' }, { valor: 'cofins', rotulo: 'COFINS' }, { valor: 'ibs_cbs', rotulo: 'IBS/CBS' }, { valor: 'is', rotulo: 'IS' }], { obrigatorio: true }),
      t('ncm_prefixo', 'NCM (prefixo)', 3, { ajuda: 'De 2 a 8 dígitos. Deixe em branco para todos.' }),
      t('cfop', 'CFOP', 2),
      sel('uf_origem', 'UF origem', 2, UF_OPCOES),
      sel('uf_destino', 'UF destino', 2, UF_OPCOES),
      sel('tipo_cliente', 'Cliente', 6, [TODAS, { valor: 'contribuinte', rotulo: 'Contribuinte' }, { valor: 'isento', rotulo: 'Isento' }, { valor: 'nao_contribuinte', rotulo: 'Não contribuinte' }]),
      sel('crt', 'CRT', 6, CRT_OPCOES),
    ],
  },
  {
    id: 'icms', titulo: 'ICMS e FCP',
    campos: [
      sel('codigo', 'CST/CSOSN', 5, CST_ICMS, { ajuda: 'CST (2 dígitos) ou CSOSN (3).' }),
      sel('mod_bc', 'Base de cálculo do ICMS', 3, MOD_BC),
      p('aliquota_icms', 'Alíquota do ICMS (%)', 2),
      p('reducao_bc', 'Redução da base (%)', 2),
      p('p_fcp', 'FCP (%)', 3),
      p('p_cred_sn', 'Crédito do Simples (%)', 3),
      p('p_dif', 'Diferimento (%)', 3),
      p('p_icms_efet', 'ICMS efetivo (%)', 3),
    ],
  },
  {
    id: 'st', titulo: 'ICMS-ST (por MVA)',
    campos: [
      sel('mod_bc_st', 'Base de cálculo da ST', 4, MOD_BC_ST, { ajuda: 'O cálculo atual atende a margem de valor agregado.' }),
      p('mva_original', 'MVA original (%)', 2),
      p('mva_ajustada', 'MVA ajustada (%)', 2),
      { nome: 'ajustar_mva', rotulo: 'Ajustar a MVA', tipo: 'booleano3', colunas: 4, opcoes: SIM_NAO, ajuda: 'ST interestadual exige sim ou não.' },
      p('reducao_bc_st', 'Redução da base da ST (%)', 4),
      p('aliquota_interna_destino', 'Alíquota interna do destino (%)', 4),
      p('p_fcp_st', 'FCP da ST (%)', 4),
    ],
  },
  {
    id: 'ipi-pis-cofins', titulo: 'IPI, PIS e COFINS',
    campos: [
      sel('cst_ipi', 'CST IPI', 5, CST_IPI), p('aliquota_ipi', 'IPI (%)', 1), d4('valor_unidade_ipi', 'IPI por unidade (R$)', 3), t('c_enq', 'Enquadramento', 3, { ajuda: 'Deixe em branco quando não houver enquadramento.' }),
      sel('cst_pis', 'CST PIS', 5, CST_PIS), p('aliquota_pis', 'PIS (%)', 1), sel('cst_cofins', 'CST COFINS', 5, CST_COFINS), p('aliquota_cofins', 'COFINS (%)', 1),
    ],
  },
  {
    id: 'ibs-cbs-is', titulo: 'Reforma tributária (IBS, CBS e IS)',
    campos: [
      sel('cst_ibs_cbs', 'CST IBS/CBS', 5, CST_IBS_CBS), t('c_class_trib', 'Classificação tributária', 4, { ajuda: 'cClassTrib, conforme a NT 2025.002-RTC.' }), t('versao_nt_rtc', 'Versão da NT', 3),
      p('p_ibs_uf', 'IBS do estado (%)'), p('p_ibs_mun', 'IBS do município (%)'), p('p_cbs', 'CBS (%)'), p('p_red_ibs', 'Redução IBS (%)', 3), p('p_red_cbs', 'Redução CBS (%)', 3),
      sel('cst_is', 'CST IS', 4, CST_IS), t('c_class_trib_is', 'Classificação do IS', 4), p('p_is', 'IS (%)'), d4('valor_unidade_is', 'IS por unidade (R$)'),
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

/** "00 – Tributada integralmente": o nome da tabela oficial junto ao CST/CSOSN do ICMS (código fora da tabela sai só como código). */
export function rotuloDoCodigoIcms(codigo: string | null | undefined): string {
  if (!codigo) return '';
  return CST_ICMS.find((o) => o.valor === codigo)?.rotulo ?? codigo;
}

/** Opções do campo para o valor atual: código salvo que não está na lista aparece como "código não listado" em vez de abrir vazio. */
export function opcoesDoCampo(campo: CampoRegra, atual: string): readonly { valor: string; rotulo: string }[] {
  const o = campo.opcoes ?? [];
  return campo.tipo !== 'selecao' || atual === '' || o.some((x) => x.valor === atual) ? o : [...o, { valor: atual, rotulo: `${atual} – código não listado` }];
}

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
