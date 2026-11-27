import type { Resultado } from '@macuxierp/ui';

/**
 * Retorno de uma ação para o `ResultadoAcao` do `packages/ui` (decisão 36 A, docs/design/resultado-acao/README.md).
 * Os textos continuam sendo de quem os escreve (módulo, SDK, tela); aqui só se escolhe o tom.
 */
export const resultadoSucesso = (texto: string): Resultado => ({ tom: 'sucesso', texto });
export const resultadoErro = (texto: string): Resultado => ({ tom: 'erro', texto });
