/**
 * Regras do cadastro de regras no BKO e do catálogo base (T-0127, RF-FIS-01). Funções puras; a API sempre revalida com elas.
 * O catálogo (`fiscal.regra_base`) nunca é aplicado sozinho (o fiscal valida, o administrador aplica) e não carrega regra de ST interestadual (RN-FIS-05).
 */
import type { CatalogoRegra, ErroFiscal, RegraEntrada, RegraTributaria, SituacaoRegra, TributoRegra } from '../contracts';
import { CSOSN_ICMS, CST_ICMS } from '../contracts';
import { codigoCompativel, selecionarRegra, type AlvoRegra, type Resultado } from './regra';

export interface ProblemaRegra {
  rn: string;
  codigo: ErroFiscal['codigo'];
  /** Campo do formulário que a mensagem aponta. */
  campo: string;
  mensagem: string;
}

type CamposSt = Pick<RegraEntrada, 'codigo' | 'aliquota_interna_destino' | 'mva_original' | 'mva_ajustada'>;
const CODIGOS_ST = ['10', '30', '70', '201', '202', '203'];

/** RN-FIS-05: a regra trata ST (código de ST, alíquota interna do destino ou MVA). */
export function ehRegraSt(r: CamposSt): boolean {
  return (r.codigo !== null && CODIGOS_ST.includes(r.codigo)) || r.aliquota_interna_destino !== null || r.mva_original !== null || r.mva_ajustada !== null;
}

/** Só é intraestadual com as duas UFs informadas e iguais; UF aberta pode virar interestadual no cálculo. */
function podeSerInterestadual(r: Pick<RegraEntrada, 'uf_origem' | 'uf_destino'>): boolean {
  return !(r.uf_origem !== null && r.uf_destino !== null && r.uf_origem === r.uf_destino);
}

const semFonte = (r: Pick<RegraEntrada, 'fonte' | 'versao'>): ProblemaRegra[] => {
  const p: ProblemaRegra[] = [];
  if (!r.fonte || r.fonte.referencia.trim() === '') p.push({ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE', campo: 'fonte', mensagem: 'Informe a fonte da regra (NT, convênio ou anexo).' });
  if (r.versao.trim() === '') p.push({ rn: 'RN-FIS-04', codigo: 'REGRA_SEM_FONTE', campo: 'versao', mensagem: 'Informe a versão da fonte.' });
  return p;
};

/** RN-FIS-01/02/04/05: o que a API recusa antes de gravar a regra do tenant. Lista vazia = pode gravar. */
export function validarRegraParaCadastro(r: RegraEntrada): ProblemaRegra[] {
  const p = semFonte(r);
  if (r.vigencia_fim !== null && r.vigencia_fim < r.vigencia_inicio) {
    p.push({ rn: 'RN-FIS-04', codigo: 'REGRA_FORA_DA_VIGENCIA', campo: 'vigencia_fim', mensagem: 'O fim da vigência não pode ser anterior ao início.' });
  }
  if (r.tributo === 'icms') {
    const ok = r.crt !== null ? codigoCompativel(r.crt, r.codigo) : r.codigo !== null && ([...CST_ICMS, ...CSOSN_ICMS] as string[]).includes(r.codigo);
    if (!ok) {
      p.push({ rn: 'RN-FIS-02', codigo: 'CODIGO_INCOMPATIVEL_CRT', campo: 'codigo', mensagem: `O código ${r.codigo ?? '(vazio)'} não serve ao CRT da regra (CST no regime normal, CSOSN no Simples).` });
    }
  }
  if (ehRegraSt(r)) {
    if (r.mod_bc_st !== null && r.mod_bc_st !== 4) {
      p.push({ rn: 'RN-FIS-05', codigo: 'CODIGO_NAO_SUPORTADO', campo: 'mod_bc_st', mensagem: 'ST por pauta, preço tabelado ou lista ainda não é calculado: use MVA (modBCST 4).' });
    }
    if (podeSerInterestadual(r) && r.ajustar_mva === null && r.mva_ajustada === null) {
      p.push({ rn: 'RN-FIS-05', codigo: 'CODIGO_NAO_SUPORTADO', campo: 'ajustar_mva', mensagem: 'ST interestadual: diga se a MVA é ajustada (sim ou não) ou informe a MVA ajustada.' });
    }
  }
  if (r.aliquota_ipi !== null && r.valor_unidade_ipi !== null) {
    p.push({ rn: 'RN-FIS-01', codigo: 'REGRA_INCOMPLETA', campo: 'aliquota_ipi', mensagem: 'IPI com alíquota e valor por unidade ao mesmo tempo é ambíguo: informe só um.' });
  }
  return p;
}

/** RN-FIS-05 e RN-FIS-04: o modelo do catálogo (carga versionada que o fiscal validou) só pode ser aplicado se tem fonte e vigência coerentes e não é ST interestadual (o CHECK do banco também recusa). */
export function catalogoAplicavel(c: CatalogoRegra): ProblemaRegra[] {
  const p = semFonte(c);
  if (c.vigencia_fim !== null && c.vigencia_fim < c.vigencia_inicio) p.push({ rn: 'RN-FIS-04', codigo: 'REGRA_FORA_DA_VIGENCIA', campo: 'vigencia_fim', mensagem: 'A vigência do modelo é inválida.' });
  if (ehRegraSt(c) && podeSerInterestadual(c)) {
    p.push({ rn: 'RN-FIS-05', codigo: 'CODIGO_NAO_SUPORTADO', campo: 'uf_destino', mensagem: 'O catálogo não carrega regra de ST interestadual: cadastre a regra à mão, com a UF de origem e de destino.' });
  }
  return p;
}

/** RN-FIS-04: situação pela data civil do tenant (AAAA-MM-DD). */
export function situacaoDaRegra(r: Pick<RegraTributaria, 'vigencia_inicio' | 'vigencia_fim'>, hoje: string): SituacaoRegra {
  if (hoje < r.vigencia_inicio) return 'futura';
  if (r.vigencia_fim !== null && hoje > r.vigencia_fim) return 'encerrada';
  return 'vigente';
}

/**
 * RN-FIS-01: qual regra vale para o alvo, por tributo (a consulta "qual regra vale"). Usa só as regras do tenant: o catálogo nunca entra na resolução.
 * Mesmo critério do motor (`selecionarRegra`): a mais específica; empate e ausência são erros tipados.
 */
export function resolverRegra(regras: RegraTributaria[], alvo: Omit<AlvoRegra, 'tributo'>): Record<'icms' | 'ipi' | 'pis' | 'cofins', Resultado<RegraTributaria>> {
  const por = (tributo: TributoRegra) => selecionarRegra(regras, { ...alvo, tributo });
  return { icms: por('icms'), ipi: por('ipi'), pis: por('pis'), cofins: por('cofins') };
}
