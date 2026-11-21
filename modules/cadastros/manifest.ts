import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'cadastros',
  versao: '0.1.0',
  descricao: 'Clientes, produtos, preços, estoque simples, equipe e carteira, filiais, condições de pagamento e tabelas oficiais (NCM, CEST, CFOP, IBGE).',
  depende: ['core'],
  perfis: ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'],
  web: { menus: ['Clientes', 'Produtos', 'Tabelas de preço', 'Equipe e carteira', 'Filiais'] },
  publica: ['cadastros.cliente.alterado@1', 'cadastros.produto.alterado@1', 'cadastros.preco.alterado@1', 'cadastros.estoque.alterado@1', 'cadastros.filial.alterada@1', 'cadastros.vendedor.alterado@1', 'cadastros.carteira.alterada@1', 'cadastros.condicao_pagamento.alterada@1'],
  consome: [],
});
