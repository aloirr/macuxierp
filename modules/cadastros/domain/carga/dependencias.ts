import type { EntidadeCarga } from '../../contracts';

export type AlvoReferencia = 'filial' | 'vendedor' | 'condicao_pagamento' | 'produto' | 'tabela_preco' | 'cliente';

/** Arquivo que cria o cadastro de cada alvo de referência (a tabela de preço nasce no `preco.csv`). */
export const ARQUIVO_DO_ALVO: Readonly<Record<AlvoReferencia, EntidadeCarga>> = {
  filial: 'filial', vendedor: 'vendedor', condicao_pagamento: 'condicao_pagamento',
  produto: 'produto', tabela_preco: 'preco', cliente: 'cliente',
};

const PLURAL: Readonly<Record<EntidadeCarga, string>> = {
  filial: 'filiais', vendedor: 'vendedores', condicao_pagamento: 'condições de pagamento',
  produto: 'produtos', produto_unidade: 'unidades do produto', preco: 'tabelas de preço', estoque: 'saldos de estoque',
  cliente: 'clientes',
};

/** RF-CAD-11 (decisão de 23/11, v0.3.7): nenhuma carga depende de outra. Formato A0, sem o valor da célula (D9). */
export const motivoDependencia = (cadastro: string, coluna: string, arquivo: EntidadeCarga): string =>
  `${cadastro} ${coluna} não encontrado: carregue o cadastro de ${PLURAL[arquivo]} ou corrija a coluna ${coluna}.`;
