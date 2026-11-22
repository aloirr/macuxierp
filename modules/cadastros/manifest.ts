import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'cadastros',
  versao: '0.1.0',
  descricao: 'Clientes, produtos, preços, estoque simples, equipe e carteira, filiais, condições de pagamento e tabelas oficiais (NCM, CEST, CFOP, IBGE).',
  depende: ['core'],
  perfis: ['administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura'],
  web: { menus: ['Clientes', 'Produtos', 'Tabelas de preço', 'Estoque', 'Condições de pagamento', 'Equipe e carteira', 'Filiais', 'Tabelas oficiais', 'Carga de cadastros'] },
  publica: ['cadastros.cliente.alterado@1', 'cadastros.produto.alterado@1', 'cadastros.preco.alterado@1', 'cadastros.estoque.alterado@1', 'cadastros.filial.alterada@1', 'cadastros.vendedor.alterado@1', 'cadastros.carteira.alterada@1', 'cadastros.condicao_pagamento.alterada@1', 'cadastros.tabela_preco.alterada@1'],
  consome: ['integracao-fdv.carga_inicial.solicitada@1', 'faturamento.nota.autorizada@1', 'faturamento.nota.cancelada@1'],
});
