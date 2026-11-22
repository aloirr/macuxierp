import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'pedido',
  versao: '0.1.0',
  descricao: 'Pedidos vindos do FDV e lançados à mão, aprovação e status.',
  depende: ['core', 'cadastros'],
  perfis: ['administrador', 'gerente', 'faturista', 'vendedor', 'leitura'],
  web: { menus: ['Pedidos'] },
  publica: ['pedido.pedido.recebido@1', 'pedido.pedido.aprovado@1', 'pedido.pedido.recusado@1', 'pedido.pedido.cancelado@1', 'pedido.pedido.faturado@1'],
  consome: ['faturamento.nota.autorizada@1', 'faturamento.nota.cancelada@1'],
});
