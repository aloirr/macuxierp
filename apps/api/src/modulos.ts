/**
 * Módulos montados na API. Enquanto o módulo não expõe o plugin de rotas (T-0006 core, T-0007 cadastros, F2 em
 * diante), entra só o manifesto (menus do `GET /v1/auth/eu`). O plugin do módulo troca a linha dele por
 * `definirPlugin(manifest, rotas)` exportado do próprio pacote.
 */
import { manifest as cadastros } from '@macuxierp/cadastros/manifest';
import { manifest as core } from '@macuxierp/core/manifest';
import { manifest as faturamento } from '@macuxierp/faturamento/manifest';
import { manifest as fiscal } from '@macuxierp/fiscal/manifest';
import { manifest as integracaoFdv } from '@macuxierp/integracao-fdv/manifest';
import { manifest as pedido } from '@macuxierp/pedido/manifest';
import { definirPlugin, type PluginModulo } from '@macuxierp/platform-sdk';

export const MODULOS_MONTADOS: readonly PluginModulo[] = [core, cadastros, pedido, fiscal, faturamento, integracaoFdv].map((m) => definirPlugin(m, []));
