/** Os `depende` dos manifestos da v1 para os testes do portal (o core não importa outro módulo; a apps/api passa os reais). */
import type { DependenciasModulo } from '@macuxierp/platform-sdk';

export const MANIFESTOS_TESTE: readonly DependenciasModulo[] = [
  { id: 'core', depende: [] },
  { id: 'cadastros', depende: ['core'] },
  { id: 'pedido', depende: ['core', 'cadastros'] },
  { id: 'fiscal', depende: ['core', 'cadastros'] },
  { id: 'faturamento', depende: ['core', 'cadastros', 'pedido', 'fiscal'] },
  { id: 'integracao-fdv', depende: ['core', 'cadastros', 'pedido'] },
];
