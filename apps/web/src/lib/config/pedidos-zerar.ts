import { plural } from '@macuxierp/platform-sdk';
import { ZeragemPedidosResposta, type MOTIVOS_MANTER_PEDIDO } from '@macuxierp/pedido/contracts';
import { chamarPortal, type Enviar, type Retorno } from './cargas';

/**
 * Zerar pedidos não faturados (T-0093, RN-CAD-10): textos e chamadas do navegador ao portal. A frase, o "Mantidos" e a
 * `Idempotency-Key` seguem o Zerar por cadastro; os tipos vêm do contrato do pedido (Zod). Só contagens, nada de dado do pedido.
 */

export const basePedidos = (empresaId: string) => `/config/empresas/${encodeURIComponent(empresaId)}/pedidos/zerar`;

type Mantido = ZeragemPedidosResposta['mantidos'][number];
const MOTIVO: Record<(typeof MOTIVOS_MANTER_PEDIDO)[number], string> = { nota: 'com nota', titulo: 'com título' };

export const TEXTO_ANTES_DE_ZERAR_PEDIDOS = 'Apaga só os pedidos sem nota e sem título. Antes de zerar, exporte pelo BKO da empresa.';
/** O pedido do FDV zerado não volta sozinho (RN-PED-01): só pelo reenvio feito no FDV. */
export const AVISO_PEDIDOS_FDV = 'Os pedidos que vieram do FDV só voltam quando o FDV reenviar.';

/** "Mantidos: 5" (a soma) e uma linha por motivo: "3 pedidos com nota." Sem mantidos = null. */
export function textosMantidosPedidos(mantidos: readonly Mantido[]): { total: string; detalhes: string[] } | null {
  const itens = mantidos.filter((m) => m.quantidade > 0);
  if (itens.length === 0) return null;
  return {
    total: `Mantidos: ${itens.reduce((n, m) => n + m.quantidade, 0)}`,
    detalhes: itens.map((m) => `${plural(m.quantidade, 'pedido', 'pedidos')} ${MOTIVO[m.motivo]}.`),
  };
}

/** "Vai apagar N pedidos." (da tabela `pedido` da prévia) e, do FDV, quantos só voltam pelo reenvio. */
export function textoApagarPedidos(r: ZeragemPedidosResposta): string {
  const n = r.apagados.find((a) => a.tabela === 'pedido')?.quantidade ?? 0;
  if (n === 0) return 'Não há pedidos sem nota e sem título para apagar.';
  const fdv = r.apagados_fdv > 0 ? ` Do FDV: ${r.apagados_fdv}.` : '';
  return `Vai apagar ${plural(n, 'pedido', 'pedidos')}.${fdv}`;
}

export type ResultadoZerarPedidos = { apagados: number; mantidos: number };

/** "Pedidos zerados: 3. Mantidos: 2 (com nota ou título)." */
export function textoPedidosZerados({ apagados, mantidos }: ResultadoZerarPedidos): string {
  return `Pedidos zerados: ${apagados}.${mantidos > 0 ? ` Mantidos: ${mantidos} (com nota ou título).` : ''}`;
}

export function pedirPreviaZerarPedidos(empresaId: string, enviar: Enviar = fetch, signal?: AbortSignal): Promise<Retorno<ZeragemPedidosResposta>> {
  return chamarPortal(`${basePedidos(empresaId)}/previa`, { method: 'POST', signal }, enviar, (c) => {
    const p = ZeragemPedidosResposta.safeParse(c.previa);
    return p.success ? p.data : null;
  });
}

export function pedirZerarPedidos(empresaId: string, frase: string, chave: string, enviar: Enviar = fetch): Promise<Retorno<ResultadoZerarPedidos>> {
  return chamarPortal(`${basePedidos(empresaId)}`, { method: 'POST', body: JSON.stringify({ frase: frase.trim() }), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }, enviar, (c) => {
    const p = ZeragemPedidosResposta.safeParse(c.zeragem);
    return p.success ? { apagados: p.data.apagados.find((a) => a.tabela === 'pedido')?.quantidade ?? 0, mantidos: p.data.mantidos.reduce((n, m) => n + m.quantidade, 0) } : null;
  });
}
