import type { EntidadeCarga } from '../../contracts';

export type AlvoReferencia = 'filial' | 'vendedor' | 'forma' | 'condicao_pagamento' | 'produto' | 'tabela_preco' | 'cliente';

/** RF-CAD-11: arquivos que precisam estar no banco (ou no mesmo lote) antes de cada entidade. */
export const DEPENDENCIAS: Readonly<Record<EntidadeCarga, readonly EntidadeCarga[]>> = {
  filial: [],
  vendedor: ['filial'],
  forma_pagamento: [],
  prazo_pagamento: ['forma_pagamento'],
  produto: [],
  produto_unidade: ['produto'],
  preco: ['produto', 'filial'],
  estoque: ['produto', 'filial'],
  cliente: ['filial', 'vendedor', 'prazo_pagamento', 'preco'],
  cliente_endereco: ['cliente'],
};

/** Arquivo que cria o cadastro de cada alvo de referência (a tabela de preço nasce no `preco.csv`). */
export const ARQUIVO_DO_ALVO: Readonly<Record<AlvoReferencia, EntidadeCarga>> = {
  filial: 'filial', vendedor: 'vendedor', forma: 'forma_pagamento', condicao_pagamento: 'prazo_pagamento',
  produto: 'produto', tabela_preco: 'preco', cliente: 'cliente',
};

const PLURAL: Readonly<Record<EntidadeCarga, string>> = {
  filial: 'filiais', vendedor: 'vendedores', forma_pagamento: 'formas de pagamento', prazo_pagamento: 'condições de pagamento',
  produto: 'produtos', produto_unidade: 'unidades do produto', preco: 'tabelas de preço', estoque: 'saldos de estoque',
  cliente: 'clientes', cliente_endereco: 'endereços de cliente',
};

/** RF-CAD-11 (decisão de 23/11, v0.3.6): nenhuma carga depende de outra. Formato A0, sem o valor da célula (D9). */
export const motivoDependencia = (cadastro: string, coluna: string, arquivo: EntidadeCarga): string =>
  `${cadastro} ${coluna} não encontrado: carregue o cadastro de ${PLURAL[arquivo]} ou corrija a coluna ${coluna}.`;
