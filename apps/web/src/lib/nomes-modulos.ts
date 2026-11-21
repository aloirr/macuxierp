import type { ModuloId } from '@macuxierp/platform-sdk';

/**
 * Nome de exibição de cada módulo, usado no menu e em Licenças. Fonte única no web, até o ManifestoModulo
 * do platform-sdk ganhar o campo `nome` (pedido ao engenheiro-software); aí este arquivo some.
 */
export const NOMES_MODULOS: Record<ModuloId, string> = {
  core: 'Plataforma',
  cadastros: 'Cadastros',
  pedido: 'Pedidos',
  faturamento: 'Faturamento',
  fiscal: 'Fiscal',
  'integracao-fdv': 'Integração FDV',
};
