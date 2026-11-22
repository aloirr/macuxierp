/**
 * Formato da chave que nasce no ERP (RD-0317, ADR 0010): o UUID canônico, 36 caracteres, hexadecimal minúsculo, com os
 * quatro hifens. O `external_id` é sempre de fora (kit, migração, integrador): nunca pode ter esse formato quando o
 * valor é o `id` de outro registro, senão a chave do Hub (`external_id ?? id`) ficaria ambígua.
 */
import { violacao, type Violacao } from './violacao';

export const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ehUuidCanonico = (v: string): boolean => UUID_CANONICO.test(v);

/**
 * RN-CORE-05 (RD-0317): `external_id` no formato canônico que seja o `id` de QUALQUER registro da tabela no tenant,
 * inclusive o próprio e o inativo, é recusado: o ERP nunca grava no `external_id` um valor que ele mesmo gerou. A
 * checagem de formato mora aqui; `existeRegistroComEsseId` (consulta que enxerga o inativo) só roda quando o formato
 * é canônico e nunca filtra `deleted_at`.
 */
export async function externalIdColideComId(externalId: unknown, existeRegistroComEsseId: (id: string) => Promise<boolean>): Promise<Violacao | null> {
  if (typeof externalId !== 'string' || !ehUuidCanonico(externalId) || !(await existeRegistroComEsseId(externalId))) return null;
  return violacao('RN-CORE-05', 'external_id', 'O external_id no formato UUID canônico é o id de um cadastro: use a chave de origem (ADR 0010, RD-0317)');
}
