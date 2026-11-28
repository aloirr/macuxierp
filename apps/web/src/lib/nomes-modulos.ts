import type { ModuloId } from '@macuxierp/platform-sdk';

/**
 * Nome de exibição de cada módulo (título do grupo no menu e Licenças). Continua necessário: `EuResposta.modulos` traz
 * só `id` e `menus`. Some quando o contrato ganhar o nome.
 */
export const NOMES_MODULOS: Record<ModuloId, string> = {
  core: 'Empresa',
  cadastros: 'Cadastros',
  pedido: 'Pedidos',
  faturamento: 'Faturamento',
  fiscal: 'Fiscal',
  'integracao-fdv': 'Integração FDV',
};
