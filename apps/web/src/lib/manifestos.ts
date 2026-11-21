import { manifest as cadastros } from '@macuxierp/cadastros/manifest';
import { manifest as core } from '@macuxierp/core/manifest';
import { manifest as faturamento } from '@macuxierp/faturamento/manifest';
import { manifest as fiscal } from '@macuxierp/fiscal/manifest';
import { manifest as integracaoFdv } from '@macuxierp/integracao-fdv/manifest';
import { manifest as pedido } from '@macuxierp/pedido/manifest';
import type { ManifestoModulo } from '@macuxierp/platform-sdk';

/** Todos os módulos da v1, na ordem do menu. Módulo novo entra aqui e no package.json do web. */
export const MANIFESTOS: readonly ManifestoModulo[] = [core, cadastros, pedido, faturamento, fiscal, integracaoFdv];
