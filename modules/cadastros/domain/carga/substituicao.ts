/** Trocar pelo tipo do SDK (packages/platform-sdk/src/portal-cargas.ts) quando sair. */
export type ModoPortalCarga = 'adicionar' | 'substituir_tudo';

export interface ExistenteSubstituicao {
  id: string;
  external_id: string | null;
  inativo: boolean;
}

export interface PlanoSubstituicao {
  /** ids a inativar (nunca apagar). */
  inativar: string[];
  /** quantos dos inativados estavam em uso (continuam no histórico). */
  mantidos_em_uso: number;
  /** inativar / ativos, 2 casas (0 a 1); 0 sem ativos. Só informativo. */
  percentual_inativado: number;
}

/**
 * RN-CAD-10: no modo 'substituir_tudo', todo existente ATIVO cujo external_id não veio
 * no arquivo é inativado; nunca apagado. Em uso também é inativado e só entra na
 * contagem `mantidos_em_uso`. Existente sem external_id não pode ter vindo do arquivo,
 * logo é inativado. No modo 'adicionar' o plano é vazio. `entidade` é informativa.
 */
export function planoSubstituicao(p: {
  modo: ModoPortalCarga;
  entidade: string;
  externos_do_arquivo: readonly string[];
  existentes: readonly ExistenteSubstituicao[];
  em_uso: ReadonlySet<string>;
}): PlanoSubstituicao {
  if (p.modo !== 'substituir_tudo') return { inativar: [], mantidos_em_uso: 0, percentual_inativado: 0 };
  const vindos = new Set(p.externos_do_arquivo);
  const ativos = p.existentes.filter((e) => !e.inativo);
  const inativar = ativos.filter((e) => e.external_id === null || !vindos.has(e.external_id));
  return {
    inativar: inativar.map((e) => e.id),
    mantidos_em_uso: inativar.filter((e) => p.em_uso.has(e.id)).length,
    percentual_inativado: ativos.length === 0 ? 0 : Math.round((inativar.length / ativos.length) * 100) / 100,
  };
}
