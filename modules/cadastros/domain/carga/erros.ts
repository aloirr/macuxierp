import type { EntidadeCarga } from '../../contracts';
import type { Violacao } from '../violacao';

/** Erro de uma linha. Nunca leva o valor digitado (RN-CORE-07, D9), salvo códigos fiscais (RN-CAD-04): `motivo` sai de mensagens fixas. */
export interface ErroLinha {
  linha: number;
  campo: string | null;
  codigo: string;
  motivo: string;
  /** Só no `CARGA_DEPENDENCIA` (RF-CAD-11): arquivo que falta carregar. Ausente nos demais códigos. */
  entidade_faltante?: EntidadeCarga;
}

/** Mensagens fixas por regra: as do domain citam o valor (IBGE, UF), que não pode ir ao relatório. Exceção à D9 só para códigos fiscais (decisão do PO, 23/11): RN-CAD-04 repassa a mensagem com NCM/CEST. */
const MOTIVOS: Readonly<Record<string, string>> = {
  'RN-CAD-01': 'Documento inválido pelo dígito verificador',
  'RN-CAD-02': 'IE ou indicador de IE incompatível com a UF',
  'RN-CAD-03': 'Município ou endereço inválido',
  'RN-CAD-06': 'Vigência ou preço inválido',
  'RN-CAD-07': 'Saldo de estoque inválido',
  'RN-CAD-08': 'Cadastro padrão não pode ser inativado',
  D8: 'Configuração da NF-e incompleta',
};

export function erroDeViolacao(linha: number, v: Violacao, campo?: string): ErroLinha {
  // RN-CAD-09, RN-FIS-02 e RN-CAD-04: as mensagens do domain são constantes curtas por classe, sem o valor digitado.
  return { linha, campo: campo ?? v.campo, codigo: v.rn, motivo: v.rn === 'RN-CAD-09' || v.rn === 'RN-FIS-02' || v.rn === 'RN-CAD-04' ? v.mensagem : (MOTIVOS[v.rn] ?? 'Regra de negócio violada') };
}

export const erroLinha = (linha: number, campo: string | null, codigo: string, motivo: string): ErroLinha => ({ linha, campo, codigo, motivo });

/** Texto fixo de quem manda no endereço principal (mapeamento e gravação usam o mesmo). */
export const MOTIVO_PRINCIPAL_NO_CLIENTE = 'O endereço principal vem do cliente.csv';

/**
 * Único conversor de falha do Zod do contrato em `ErroLinha`: campo pelo caminho (sem `dados` e `linha`), nunca o valor.
 * Campo ausente na criação é `CARGA_OBRIGATORIO`; o resto, `CARGA_FORMATO`.
 */
export function errosDeZod(linha: number, issues: readonly { path: readonly PropertyKey[]; code: string; received?: unknown }[]): ErroLinha[] {
  return issues.map((i) => {
    const campo = i.path.filter((x) => x !== 'dados' && x !== 'linha').map(String).join('.') || null;
    const falta = i.code === 'invalid_type' && i.received === 'undefined';
    return erroLinha(linha, campo, falta ? 'CARGA_OBRIGATORIO' : 'CARGA_FORMATO', falta ? 'Obrigatório para criar o cadastro' : 'Valor fora do formato do contrato');
  });
}

/** RN-CORE-09: motivo fixo do arquivo filial e da coluna limite_credito_cents recusados por perfil. */
export const MOTIVO_SO_ADMINISTRADOR = 'Só o administrador carrega filial e limite de crédito.';
