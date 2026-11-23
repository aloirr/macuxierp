import type { EntidadeCarga } from '../../contracts';
import { nomeArquivoCarga } from './layout';

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

/** RF-CAD-11, D9: mensagem fixa, sem o valor da célula. */
export const motivoDependencia = (arquivo: EntidadeCarga): string => `Faltam ${PLURAL[arquivo]}: carregue ${nomeArquivoCarga(arquivo)} antes.`;
