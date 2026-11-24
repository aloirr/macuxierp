/**
 * Chaves `ligado` | `desligado` das variáveis do worker com o Hub do FDV (`MACUXIERP_FDV_ENVIO`,
 * `MACUXIERP_FDV_RECEBIMENTO`, `MACUXIERP_FDV_CLIENTE_REVISAO`). Fonte única: o worker e o SDK leem por aqui.
 */
export type EstadoChaveFdv = 'ligado' | 'desligado';

/**
 * Ausente ou vazio = `padrao` (`desligado` se omitido); sem caixa nem espaço. Valor fora da lista derruba a partida,
 * citando só o nome.
 */
export function chaveLigadoDesligado(
  env: Readonly<Record<string, string | undefined>>,
  nome: string,
  padrao: EstadoChaveFdv = 'desligado',
): EstadoChaveFdv {
  const v = env[nome]?.trim().toLowerCase();
  if (!v) return padrao;
  if (v === 'ligado' || v === 'desligado') return v;
  throw new Error(`configuração inválida: ${nome} (ligado ou desligado)`);
}
