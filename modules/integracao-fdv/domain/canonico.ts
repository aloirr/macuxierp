/**
 * JSON canônico, hash do registro e ordem binária (RN-INF-03). Puro: SHA-256 e SHA-1 em TS (sem módulo do Node, regra `domain-usa-modulo-do-node`).
 */
import { paraHex, sha1, sha256, utf8 } from './hash';

/** Serializa com chaves em ordem (ordem de code point), sem `undefined`, sem espaços. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') {
    const texto = JSON.stringify(valor);
    return texto === undefined ? 'null' : texto;
  }
  if (Array.isArray(valor)) return `[${valor.map((v) => jsonCanonico(v)).join(',')}]`;
  const o = valor as Record<string, unknown>;
  const partes = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort((a, b) => compararBinario(a, b))
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`);
  return `{${partes.join(',')}}`;
}

/** SHA-256 hex de um texto UTF-8. */
export function sha256HexTexto(texto: string): string {
  return paraHex(sha256(utf8(texto)));
}

/** Hash do registro: SHA-256 do JSON canônico do payload do Hub, sem `alterado_em` (RN-INF-03). */
export function hashRegistro(payload: Record<string, unknown>): string {
  const { alterado_em: _ignorado, ...resto } = payload;
  return sha256HexTexto(jsonCanonico(resto));
}

/** Comparação por bytes UTF-8, igual ao `COLLATE "C"` do banco e ao `compararCursor` do Hub. */
export function compararBinario(a: string, b: string): number {
  const x = utf8(a);
  const y = utf8(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Namespace constante do módulo para UUID v5 (M2). Nunca muda: mudar troca o `external_id` no Hub. */
export const NAMESPACE_INTEGRACAO_FDV = '3b1f7a52-6c0e-4d8a-9a1e-5f2c8d7e4b90';

export function uuidV5(nome: string, namespace: string = NAMESPACE_INTEGRACAO_FDV): string {
  const hex = namespace.replace(/-/g, '');
  const ns = Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const corpo = utf8(nome);
  const entrada = new Uint8Array(16 + corpo.length);
  entrada.set(ns);
  entrada.set(corpo, 16);
  const h = sha1(entrada);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = paraHex(h.subarray(0, 16));
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** `external_id` da forma de pagamento no Hub (M2): UUID v5 de `tenant_id:tpag:<código>`. */
export function externalIdForma(tenantId: string, formaTpag: string): string {
  return uuidV5(`${tenantId}:tpag:${formaTpag}`);
}
