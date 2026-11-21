import type { EuResposta } from '@macuxierp/platform-sdk';

/**
 * /v1/auth/eu e login falsos, até a T-0004 entrar (docs/desenho/T-0002.md, seção 7). Só funciona sem
 * MACUXIERP_API_URL e fora de produção. Dados fictícios, sem pessoa real.
 */
export const CREDENCIAL_FALSA = { empresa: 'demo', email: 'demo@exemplo.invalid', senha: 'demo' } as const;
export const TOKEN_FALSO = 'token-falso';
/** Cookie de refresh da API falsa. */
export const REFRESH_FALSO = 'mx=falso';

export const EU_FALSO: EuResposta = {
  usuario: { id: '00000000-0000-4000-8000-000000000001', nome: 'Usuária de demonstração', perfil: 'administrador' },
  empresa: { id: '00000000-0000-4000-8000-0000000000e1', slug: 'demo', razao_social: 'Empresa de Demonstração Ltda', fuso: 'America/Manaus' },
  filiais: [
    { id: '00000000-0000-4000-8000-0000000000f1', nome: 'Matriz Manaus', cnpj: '11222333000181' },
    { id: '00000000-0000-4000-8000-0000000000f2', nome: 'Filial Parintins', cnpj: '11444777000161' },
  ],
  // Fiscal e integração FDV ficam sem licença de propósito: o menu precisa esconder o que não foi contratado.
  modulos: [{ id: 'core', menus: [] }, { id: 'cadastros', menus: [] }, { id: 'pedido', menus: [] }, { id: 'faturamento', menus: [] }],
};
