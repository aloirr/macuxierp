/** Chaves `ligado` | `desligado` do worker com o Hub do FDV (`MACUXIERP_FDV_ENVIO`, `MACUXIERP_FDV_RECEBIMENTO`). */
export type EstadoChaveFdv = 'ligado' | 'desligado';

/** Ausente ou vazio = `desligado` (sem caixa nem espaço). Valor fora da lista derruba a partida, citando só o nome. */
export function chaveLigadoDesligado(env: Readonly<Record<string, string | undefined>>, nome: string): EstadoChaveFdv {
  const v = env[nome]?.trim().toLowerCase();
  if (!v || v === 'desligado') return 'desligado';
  if (v === 'ligado') return 'ligado';
  throw new Error(`configuração inválida: ${nome} (ligado ou desligado)`);
}
