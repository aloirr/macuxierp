import { defineModule } from '@macuxierp/platform-sdk';

export const manifest = defineModule({
  id: 'faturamento',
  versao: '0.1.0',
  descricao: 'NF-e modelo 55: emissão, DANFE, cancelamento, CC-e, inutilização, contingência, consulta, guarda do XML e títulos a receber.',
  depende: ['core', 'cadastros', 'pedido', 'fiscal'],
  perfis: ['administrador', 'gerente', 'faturista', 'fiscal', 'leitura'],
  web: { menus: ['Notas fiscais', 'Títulos a receber'] },
  publica: ['faturamento.nota.autorizada@1', 'faturamento.nota.cancelada@1', 'faturamento.nota.rejeitada@1', 'faturamento.titulo.gerado@1', 'faturamento.titulo.baixado@1'],
  consome: ['pedido.pedido.aprovado@1'],
});
