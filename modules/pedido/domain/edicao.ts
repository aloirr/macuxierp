import type { OrigemPedido, StatusPedido } from '../contracts';

/**
 * RN-PED-02 e RF-PED-02: só o pedido lançado no BKO e ainda em análise se edita (o do FDV não: ele vem do aparelho, e o
 * aprovado ou faturado já virou compromisso). A API revalida e devolve 422.
 */
export const podeEditarPedido = (status: StatusPedido, origem: OrigemPedido): boolean => origem === 'bko' && status === 'em_analise';
