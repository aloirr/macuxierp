/**
 * Troca e conflito de chave do Hub (ADR 0010, item 3; RN-CORE-05, RN-INF-04). Função pura: o consumidor compara a chave
 * que o evento traz com a que o espelho já tem para o mesmo `erp_id`.
 */
export type DecisaoDeChave = 'nada' | 'troca' | 'chave_alterada' | 'chave_duplicada';

export interface EntradaTrocaDeChave {
  /** Chave do Hub da linha ativa do espelho para este `erp_id`; `null` = o registro ainda não está no espelho. */
  chaveEspelho: string | null;
  /** `chaveHub` do evento (`external_id ?? id`). */
  chaveNova: string;
  /**
   * `external_id_anterior` do evento (C-10): `undefined` = campo ausente (evento antigo, sem marcador); `null` = adoção
   * (o `external_id` era nulo); string = o valor de antes.
   */
  anterior: string | null | undefined;
  /** `erp_id` de OUTRO registro da mesma entidade que já usa `chaveNova`; `null` = ninguém. */
  outroErpIdComChaveNova: string | null;
  /** UUID do ERP do registro: a adoção (`anterior = null`) só vale se a chave do espelho era o próprio UUID. */
  erpId: string;
}

/**
 * - `chave_duplicada`: a chave nova é de outro `erp_id` (nada é sobrescrito, nem na troca coerente).
 * - `nada`: sem chave no espelho ou chave igual.
 * - `troca`: marcador igual à chave do espelho, ou `null` (adoção) quando a chave do espelho era o UUID.
 * - `chave_alterada`: a chave mudou sem marcador coerente (campo ausente inclusive).
 */
export function decidirTrocaDeChave(e: EntradaTrocaDeChave): DecisaoDeChave {
  if (e.outroErpIdComChaveNova !== null) return 'chave_duplicada';
  if (e.chaveEspelho === null || e.chaveEspelho === e.chaveNova) return 'nada';
  if (e.anterior === undefined) return 'chave_alterada';
  if (e.anterior === null) return e.chaveEspelho === e.erpId ? 'troca' : 'chave_alterada';
  return e.anterior === e.chaveEspelho ? 'troca' : 'chave_alterada';
}

/** Decisões que abrem `conflito_chave` (nada é gravado do registro). */
export type CodigoConflitoChave = Exclude<DecisaoDeChave, 'nada' | 'troca'>;

export function ehConflitoDeChave(d: DecisaoDeChave): d is CodigoConflitoChave {
  return d === 'chave_alterada' || d === 'chave_duplicada';
}
