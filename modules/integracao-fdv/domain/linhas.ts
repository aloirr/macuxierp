/**
 * Linha inválida do ERP → linha do corpo do lote (RN-INF-04). O Hub só aceita um conjunto de códigos em `linhas_invalidas` do
 * Conector e exige `mensagem` (até 300): o código do ERP (catálogo próprio) é mapeado e a mensagem sai do catálogo, nunca
 * do valor do campo. Funções puras.
 */
import { CODIGOS_LINHA_HUB, type LinhaInvalida, type LinhaInvalidaHub } from '../contracts';
import { mensagemDoErro } from './mensagens';

type CodigoHub = (typeof CODIGOS_LINHA_HUB)[number];

const CODIGO_HUB_DO_ERP: Readonly<Record<string, CodigoHub>> = {
  campo_obrigatorio: 'campo_obrigatorio',
  campo_invalido: 'formato_invalido',
  quantidade_fracionaria: 'formato_invalido', // T-0085: o Hub só aceita inteiro
};

/** `filial_codigo_repetido` e demais regras do ERP viram `regra_invalida` no Hub. */
export function codigoLinhaHub(codigoErp: string): CodigoHub {
  return CODIGO_HUB_DO_ERP[codigoErp] ?? 'regra_invalida';
}

export function paraLinhaHub(l: LinhaInvalida): LinhaInvalidaHub {
  return {
    external_id: l.external_id,
    codigo: codigoLinhaHub(l.codigo),
    ...(l.campo ? { campo: l.campo } : {}),
    mensagem: mensagemDoErro(l.codigo).slice(0, 300),
  };
}

/**
 * RN-INF-02 (T-0112): a referência ainda não confirmada no FDV não é erro do cadastro. A linha NÃO vai em `linhas_invalidas`
 * (o Hub a recusaria à toa): o ERP a retém em silêncio, ela segue pendente e volta sozinha quando a referência for confirmada.
 */
export const ehLinhaRetida = (l: LinhaInvalida): boolean => l.codigo === 'referencia_ausente';
