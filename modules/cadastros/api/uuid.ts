import { createHash } from 'node:crypto';

/** UUID v5 (RFC 4122): o `agregado_id` do evento de estoque é derivado de filial e produto (eventos.md). */
export function uuidV5(nome: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(ns).update(nome).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Namespace fixo do ERP para agregados do cadastros (gerado uma vez; nunca muda). */
const NS_CADASTROS = 'c3f1d5a0-7b0e-5a52-9d3c-4a6b8e2f1c70';

export const agregadoEstoque = (filialId: string, produtoId: string): string => uuidV5(`estoque:${filialId}:${produtoId}`, NS_CADASTROS);

export const agregadoPreco = (tabelaId: string, filialId: string, produtoId: string): string =>
  uuidV5(`preco:${tabelaId}:${filialId}:${produtoId}`, NS_CADASTROS);
