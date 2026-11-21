import type { Perfil } from '@macuxierp/platform-sdk';
import { violacao, type Violacao } from './violacao';

export type EscopoCarteira = { todos: true } | { todos: false; vendedor_ids: readonly string[] };

/**
 * D7 (desenho T-0002): o perfil `vendedor` vê só a própria carteira (`vendedor.usuario_id = usuário`); os outros veem
 * tudo. `vendedor_ids` são os vendedores ligados ao usuário (vazio = não vê cliente nenhum).
 */
export function escopoDaCarteira(perfil: Perfil, vendedorIdsDoUsuario: readonly string[]): EscopoCarteira {
  return perfil === 'vendedor' ? { todos: false, vendedor_ids: vendedorIdsDoUsuario } : { todos: true };
}

export type PlanoTransferencia = { ok: true; cliente_ids: string[] } | { ok: false; violacao: Violacao };

/** D7: transferência de carteira `de` → `para`, da carteira inteira ou de clientes escolhidos (que sejam de `de`). */
export function planejarTransferencia(p: {
  de: string;
  para: string;
  cliente_ids: readonly string[] | undefined;
  carteira_de: readonly string[];
}): PlanoTransferencia {
  const erro = (campo: string, m: string): PlanoTransferencia => ({ ok: false, violacao: violacao('D7', campo, m) });
  if (p.de === p.para) return erro('para', 'Origem e destino são o mesmo vendedor');
  const ids = p.cliente_ids ? [...new Set(p.cliente_ids)] : [...p.carteira_de];
  if (ids.length === 0) return erro('cliente_ids', 'Nenhum cliente para transferir');
  const dele = new Set(p.carteira_de);
  if (ids.some((id) => !dele.has(id))) return erro('cliente_ids', 'Há cliente que não está na carteira de origem');
  return { ok: true, cliente_ids: ids };
}
