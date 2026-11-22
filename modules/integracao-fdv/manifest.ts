import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'integracao-fdv',
  versao: '0.1.0',
  descricao: 'Conector nativo em nuvem com o Hub /integracao/v1 do Macuxi FDV: publica cadastros, títulos e status; recebe pedidos.',
  depende: ['core', 'cadastros', 'pedido'],
  perfis: ['administrador', 'gerente', 'leitura'],
  web: { menus: ['Integração FDV'] },
  publica: ['integracao-fdv.lote.enviado@1', 'integracao-fdv.lote.falhou@1', 'integracao-fdv.carga_inicial.solicitada@1'],
  consome: ['cadastros.cliente.alterado@1', 'cadastros.produto.alterado@1', 'cadastros.preco.alterado@1', 'cadastros.estoque.alterado@1', 'cadastros.filial.alterada@1', 'cadastros.vendedor.alterado@1', 'cadastros.carteira.alterada@1', 'cadastros.condicao_pagamento.alterada@1', 'cadastros.tabela_preco.alterada@1', 'pedido.pedido.recebido@1', 'pedido.pedido.aprovado@1', 'pedido.pedido.recusado@1', 'pedido.pedido.cancelado@1', 'faturamento.nota.autorizada@1', 'faturamento.nota.cancelada@1', 'faturamento.titulo.gerado@1'],
});
