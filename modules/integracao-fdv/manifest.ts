import { defineModule } from '@macuxierp/platform-sdk';
import { EVENTOS_DE_RETORNO } from './domain/retorno-pedido';

export const manifest = defineModule({
  id: 'integracao-fdv',
  versao: '0.1.0',
  descricao: 'Liga o ERP ao Macuxi FDV: envia cadastros, títulos e situação dos pedidos e recebe os pedidos dos vendedores.',
  depende: ['core', 'cadastros', 'pedido'],
  perfis: ['administrador', 'gerente', 'leitura'],
  web: { menus: ['Integração FDV'] },
  publica: ['integracao-fdv.lote.enviado@1', 'integracao-fdv.lote.falhou@1', 'integracao-fdv.carga_inicial.solicitada@1'],
  consome: ['cadastros.cliente.alterado@1', 'cadastros.produto.alterado@1', 'cadastros.preco.alterado@1', 'cadastros.estoque.alterado@1', 'cadastros.filial.alterada@1', 'cadastros.vendedor.alterado@1', 'cadastros.carteira.alterada@1', 'cadastros.condicao_pagamento.alterada@1', 'cadastros.tabela_preco.alterada@1', ...EVENTOS_DE_RETORNO, 'faturamento.nota.autorizada@1', 'faturamento.nota.cancelada@1', 'faturamento.titulo.gerado@1'],
});
