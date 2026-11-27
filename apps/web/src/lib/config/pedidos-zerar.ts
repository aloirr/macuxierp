import { plural } from '@macuxierp/platform-sdk';
import { ZeragemPedidosResposta, type MOTIVOS_MANTER_PEDIDO } from '@macuxierp/pedido/contracts';
import { chamarPortal, somaMantidos, textosMantidosCom, type Enviar, type Retorno } from './cargas';

/**
 * Zerar pedidos não faturados (T-0093, RN-CAD-10): textos e chamadas do navegador ao portal. A frase, o "Mantidos" e a
 * `Idempotency-Key` seguem o Zerar por cadastro; os tipos vêm do contrato do pedido (Zod). Só contagens, nada de dado do pedido.
 */

const basePedidos = (empresaId: string) => `/config/empresas/${encodeURIComponent(empresaId)}/pedidos/zerar`;

type Mantido = ZeragemPedidosResposta['mantidos'][number];
const MOTIVO: Record<(typeof MOTIVOS_MANTER_PEDIDO)[number], string> = { nota: 'com nota', titulo: 'com título' };

const FRASE_PREVIA_PEDIDOS = 'Pedidos faturados e notas não são apagados.';

/** "Mantidos: 5" (a soma) e uma linha por motivo: "3 pedidos com nota." Sem mantidos = null. */
export const textosMantidosPedidos = (mantidos: readonly Mantido[]) =>
  textosMantidosCom(mantidos, (m) => `${plural(m.quantidade, 'pedido', 'pedidos')} ${MOTIVO[m.motivo]}.`);

/** Pedidos apagados da tabela `pedido` da resposta (a prévia ou o zerar). */
const qtdPedidos = (r: ZeragemPedidosResposta): number => r.apagados.find((a) => a.tabela === 'pedido')?.quantidade ?? 0;

/** Prévia sem nenhum pedido a apagar: não há o que confirmar. */
export const semPedidoParaApagar = (r: ZeragemPedidosResposta): boolean => qtdPedidos(r) === 0;

/** "Vai apagar N pedidos." e, quando há do FDV, quantos só voltam pelo reenvio feito no FDV (RN-PED-01). */
export function textoApagarPedidos(r: ZeragemPedidosResposta): string {
  const n = qtdPedidos(r);
  if (n === 0) return 'Não há pedidos não faturados para apagar.';
  const f = r.apagados_fdv;
  const fdv = f > 0 ? ` ${f} ${f === 1 ? 'veio do Macuxi FDV e só volta' : 'vieram do Macuxi FDV e só voltam'} se o FDV reenviar.` : '';
  // RD-2332: com "Mantidos: N" na tela a frase dos faturados é redundante.
  const faturados = somaMantidos(r.mantidos) === 0 ? ` ${FRASE_PREVIA_PEDIDOS}` : '';
  return `Vai apagar ${plural(n, 'pedido', 'pedidos')}.${fdv}${faturados}`;
}

export type ResultadoZerarPedidos = { apagados: number; mantidos: number };

/** "Pedidos zerados: 3. Mantidos: 2." */
export function textoPedidosZerados({ apagados, mantidos }: ResultadoZerarPedidos): string {
  return `Pedidos zerados: ${apagados}.${mantidos > 0 ? ` Mantidos: ${mantidos}.` : ''}`;
}

export function pedirPreviaZerarPedidos(empresaId: string, enviar: Enviar = fetch, signal?: AbortSignal): Promise<Retorno<ZeragemPedidosResposta>> {
  return chamarPortal(`${basePedidos(empresaId)}/previa`, { method: 'POST', signal }, enviar, (c) => {
    const p = ZeragemPedidosResposta.safeParse(c.previa);
    return p.success ? p.data : null;
  });
}

export function pedirZerarPedidos(empresaId: string, frase: string, chave: string, enviar: Enviar = fetch): Promise<Retorno<ResultadoZerarPedidos>> {
  return chamarPortal(basePedidos(empresaId), { method: 'POST', body: JSON.stringify({ frase: frase.trim() }), headers: { 'content-type': 'application/json', 'idempotency-key': chave } }, enviar, (c) => {
    const p = ZeragemPedidosResposta.safeParse(c.zeragem);
    return p.success ? { apagados: qtdPedidos(p.data), mantidos: somaMantidos(p.data.mantidos) } : null;
  });
}
