import type { ModoGravarCarga } from '@macuxierp/platform-sdk';

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
  /** ativos sem external_id: não vieram do arquivo e não se sabe se saíram; NÃO são inativados, só contados. */
  sem_chave: number;
  /** inativar / ativos COM chave, 2 casas (0 a 1); 0 sem ativos com chave. Só informativo. */
  percentual_inativado: number;
}

/**
 * RN-CAD-10: no modo 'substituir_tudo', todo existente ATIVO cujo external_id não veio
 * no arquivo é inativado; nunca apagado. Em uso também é inativado e só entra na
 * contagem `mantidos_em_uso`. Existente ATIVO sem external_id NÃO é inativado (não dá para dizer
 * que saiu do arquivo): só entra em `sem_chave`, fora do percentual. No modo 'adicionar' o plano é vazio. `entidade` é informativa.
 */
export function planoSubstituicao(p: {
  modo: ModoGravarCarga;
  entidade: string;
  externos_do_arquivo: readonly string[];
  existentes: readonly ExistenteSubstituicao[];
  em_uso: ReadonlySet<string>;
}): PlanoSubstituicao {
  if (p.modo !== 'substituir_tudo') return { inativar: [], mantidos_em_uso: 0, sem_chave: 0, percentual_inativado: 0 };
  const vindos = new Set(p.externos_do_arquivo);
  const ativos = p.existentes.filter((e) => !e.inativo);
  const comChave = ativos.filter((e) => e.external_id !== null);
  const inativar = comChave.filter((e) => !vindos.has(e.external_id as string));
  return {
    inativar: inativar.map((e) => e.id),
    mantidos_em_uso: inativar.filter((e) => p.em_uso.has(e.id)).length,
    sem_chave: ativos.length - comChave.length,
    percentual_inativado: comChave.length === 0 ? 0 : Math.round((inativar.length / comChave.length) * 100) / 100,
  };
}
