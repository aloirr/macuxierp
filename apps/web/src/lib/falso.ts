import type { EuResposta, ModuloId } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from './manifestos';

/**
 * /v1/auth/eu e login falsos, até a T-0004 entrar (docs/desenho/T-0002.md, seção 7). Só funciona sem
 * MACUXIERP_API_URL e fora de produção. Dados fictícios, sem pessoa real.
 */
export const CREDENCIAL_FALSA = { email: 'demo@exemplo.invalid', senha: 'demo' } as const;
export const TOKEN_FALSO = 'token-falso';
/** Cookie de refresh da API falsa. */
export const REFRESH_FALSO = 'mx=falso';

const LICENCIADOS_FALSOS: readonly ModuloId[] = ['core', 'cadastros', 'pedido', 'faturamento'];
const MODULOS_FALSOS = MANIFESTOS.filter((m) => LICENCIADOS_FALSOS.includes(m.id)).map((m) => ({ id: m.id, menus: [...(m.web?.menus ?? [])] }));

export const EU_FALSO: EuResposta = {
  usuario: { id: '00000000-0000-4000-8000-000000000001', nome: 'Usuária de demonstração', perfil: 'administrador' },
  empresa: { id: '00000000-0000-4000-8000-0000000000e1', slug: 'demo', razao_social: 'Empresa de Demonstração Ltda', fuso: 'America/Manaus' },
  filiais: [
    { id: '00000000-0000-4000-8000-0000000000f1', nome: 'Matriz Manaus', cnpj: '11222333000181' },
    { id: '00000000-0000-4000-8000-0000000000f2', nome: 'Filial Parintins', cnpj: '11444777000161' },
  ],
  // Fiscal e integração FDV ficam sem licença de propósito: o menu precisa esconder o que não foi contratado.
  modulos: MODULOS_FALSOS,
};

/** Razão social fictícia com mais de 60 caracteres e acento, para a massa MEI (empresa = filial). */
export const RAZAO_MEI_FALSA = 'Comércio de Açaí e Cupuaçu da Família Conceição Ribeiro MEI Ltda';

/**
 * Massa MEI fictícia (A0, regra do catálogo do corretor): empresa e filial com o mesmo nome, razão social longa e com acento.
 * CNPJ do padrão de teste já usado nesta massa (o contrato exige dígito válido): não é de empresa real. Ligada por MACUXIERP_FALSO_MEI=1.
 */
export const EU_FALSO_MEI: EuResposta = {
  ...EU_FALSO,
  empresa: { ...EU_FALSO.empresa, razao_social: RAZAO_MEI_FALSA },
  filiais: [{ id: '00000000-0000-4000-8000-0000000000f3', nome: RAZAO_MEI_FALSA, cnpj: '11222333000181' }],
};
