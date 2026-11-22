/**
 * RN-PED-04 (T-0013 §2): chave int64 estável para `pg_advisory_xact_lock`, por (tenant, cliente).
 * FNV-1a de 64 bits em BigInt: o domain é puro (a regra de fronteiras proíbe `node:crypto` aqui) e o hash
 * só precisa ser estável e bem espalhado, não criptográfico.
 */
export function travaCliente(tenantId: string, clienteId: string): bigint {
  const MASCARA = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(`pedido.credito:${tenantId}:${clienteId}`)) {
    h = ((h ^ BigInt(byte)) * 0x100000001b3n) & MASCARA;
  }
  return BigInt.asIntN(64, h);
}
