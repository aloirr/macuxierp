/**
 * Chave do registro no Hub (`external_id` do Hub). Decisão do dono do produto (21/11/2026, 23h22): o `external_id` da carga
 * de migração (T-0026), quando o cadastro tem um, é a chave que o FDV já conhece; só o que nasceu no ERP usa o UUID.
 * Função pura. O `external_id` do ERP tem 1 a 64 caracteres; o Hub aceita até 200.
 */
export function chaveHub(r: { id: string; external_id?: string | null }): string {
  // O contrato do cadastros já apara (`trim`) o `external_id` ao validar o evento; o trim aqui é defesa da função pura
  // (entrada crua, fora do contrato) e não muda o que o cadastros publica.
  const e = r.external_id?.trim();
  return e ? e : r.id;
}
