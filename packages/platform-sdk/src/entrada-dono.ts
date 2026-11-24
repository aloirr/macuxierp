/**
 * Dono por entidade da `/entrada/v1` (ADR 0014 §14): `cliente` = o banco do cliente (via Conector), `erp` = o Macuxi ERP (padrão).
 * Sem Node: serve ao `domain` e ao `web`.
 */
export const DONOS_ENTIDADE = ['cliente', 'erp'] as const;
export type DonoEntidade = (typeof DONOS_ENTIDADE)[number];

/** `detalhes.codigo` do 409 da escrita do BKO numa entidade com dono `cliente`. */
export const CODIGO_DONO_CLIENTE = 'dono_cliente';
/** Texto fixo do BKO e do 409 para a entidade com dono `cliente`. */
export const MENSAGEM_DONO_CLIENTE = 'Vem do servidor do cliente';
