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

/** O que o espelho do vendedor no integracao-fdv responde sobre o `vendedor_external_id` do pré-cadastro. */
export interface ConferenciaVendedorFdv {
  /** Id do vendedor no ERP; ausente ou `null` = o espelho não o liga a um vendedor do ERP (não encontrado). */
  vendedor_id?: string | null;
  ativo: boolean;
}

export type AvisoVendedorFdv = 'vendedor_fdv_nao_encontrado' | 'vendedor_fdv_inativo';
export interface VinculoVendedorFdv { vendedor_id: string | null; aviso: AvisoVendedorFdv | null }

/** Normaliza o `vendedor_external_id` do pré-cadastro: sem texto = `null` (sem vendedor indicado). */
export const vendedorExternoFdv = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * D7 + T-0105 item 2: cliente criado a partir do FDV entra na carteira do vendedor indicado. Não há regra escrita para o
 * vendedor inválido; vale a não-recusa: o cliente nasce sem carteira e a auditoria leva o aviso (o defeito não é do
 * cliente, e a carteira se acerta depois pela transferência). **Regra provisória, pendente de RN (PO).**
 * Sem vendedor indicado ou sem a porta do espelho ligada (`conferencia` `undefined` = não consultado): sem vínculo e sem aviso.
 * `conferencia` `null` = consultado e o espelho não conhece o vendedor.
 * Vale o pior dos dois lados: o espelho do FDV (`conferencia`) e o cadastro do ERP (`vendedorErp`, `null` = não existe).
 * Inexistente (no espelho ou no ERP) = `vendedor_fdv_nao_encontrado`; existente e inativo em qualquer lado = `vendedor_fdv_inativo`.
 */
export function vincularVendedorFdv(
  vendedorExterno: string | null,
  conferencia: ConferenciaVendedorFdv | null | undefined,
  vendedorErp: { inativo: boolean } | null,
): VinculoVendedorFdv {
  if (vendedorExterno === null || conferencia === undefined) return { vendedor_id: null, aviso: null };
  const sem = (aviso: AvisoVendedorFdv): VinculoVendedorFdv => ({ vendedor_id: null, aviso });
  if (!conferencia || !conferencia.vendedor_id || vendedorErp === null) return sem('vendedor_fdv_nao_encontrado');
  if (!conferencia.ativo || vendedorErp.inativo) return sem('vendedor_fdv_inativo');
  return { vendedor_id: conferencia.vendedor_id, aviso: null };
}
