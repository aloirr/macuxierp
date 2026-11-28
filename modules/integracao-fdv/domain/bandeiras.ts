/**
 * Bandeiras por tenant da integração com o Hub do FDV. Versionadas no código e DESLIGADAS por padrão: ligar um tenant é um PR
 * (revisado), nunca uma configuração solta.
 *
 * T-0132 (63 A): enquanto o Hub não confirmar que aceita `v_icms_st_cents` e `v_ipi_cents` no `RetornoErp`, o retorno sai sem
 * os dois campos, idêntico ao de antes. Lista de `tenant_id` (UUID) que enviam ST e IPI.
 */
export const TENANTS_ENVIA_ST_IPI: readonly string[] = [];

export function enviaStIpi(tenantId: string, lista: readonly string[] = TENANTS_ENVIA_ST_IPI): boolean {
  return lista.includes(tenantId);
}
