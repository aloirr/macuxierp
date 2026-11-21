import type { Eu } from './eu';

/**
 * /v1/auth/eu e login falsos, até a T-0004 entrar (docs/desenho/T-0002.md, seção 7). Só funciona sem
 * MACUXIERP_API_URL e fora de produção (ou com MACUXIERP_API_FALSA=1). Dados fictícios, sem pessoa real.
 */
export const CREDENCIAL_FALSA = { empresa: 'demo', email: 'demo@exemplo.invalid', senha: 'demo' } as const;
export const TOKEN_FALSO = 'token-falso';

export const EU_FALSO: Eu = {
  usuario: { id: '00000000-0000-4000-8000-000000000001', nome: 'Usuária de demonstração' },
  perfil: 'administrador',
  empresa: { id: '00000000-0000-4000-8000-0000000000e1', slug: 'demo', razao_social: 'Empresa de Demonstração Ltda' },
  filiais: [
    { id: '00000000-0000-4000-8000-0000000000f1', nome: 'Matriz Manaus', cnpj: '00.000.000/0001-00' },
    { id: '00000000-0000-4000-8000-0000000000f2', nome: 'Filial Parintins', cnpj: '00.000.000/0002-81' },
  ],
  // Fiscal e integração FDV ficam sem licença de propósito: o menu precisa esconder o que não foi contratado.
  modulos: [{ id: 'core' }, { id: 'cadastros' }, { id: 'pedido' }, { id: 'faturamento' }],
};
