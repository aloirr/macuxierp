/**
 * v0.3.26 (decisão 35 A): forma de pagamento única por código, prazo v2 validado e ordem de dependência no envio ao Hub.
 * Funções puras. O Hub tem `forma_pagamento_codigo_uk` (código único por empresa): a chave da forma enviada é determinística por
 * (tenant, código), qualquer que seja o `external_id` que cada condição trouxe.
 */
import type { EntidadeHub, LinhaInvalida } from '../contracts';
import { compararBinario, externalIdForma } from './canonico';
import { lerParcelasDias } from './parcelas';
import { REFERENCIAS_HUB, TPAG_PARA_FORMA, type RegistroEspelho } from './mapeamento';

export const CODIGO_FORMA_REPETIDA = 'forma_codigo_repetido';

export interface FormaDoCodigo {
  external_id: string;
  confirmada: boolean;
  confirmadaEm: string | null;
}

/**
 * RN-INF-11: a chave que vale para o código. 1) a primeira já confirmada no Hub (`confirmado_em` mais antigo; empate pelo
 * `external_id`); 2) senão a derivada do tPag do código (`externalIdForma`), se estiver entre as candidatas; 3) senão a menor
 * `external_id` (ordem binária). Sem candidata, `null`.
 */
export function chaveVencedoraDaForma(tenantId: string, codigo: string, formas: readonly FormaDoCodigo[]): string | null {
  const confirmadas = formas
    .filter((f) => f.confirmada)
    .sort((a, b) => (a.confirmadaEm ?? '').localeCompare(b.confirmadaEm ?? '') || compararBinario(a.external_id, b.external_id));
  if (confirmadas[0]) return confirmadas[0].external_id;
  const ids = new Set(formas.map((f) => f.external_id));
  const derivadas = Object.entries(TPAG_PARA_FORMA)
    .filter(([, f]) => f.codigo === codigo)
    .map(([tpag]) => externalIdForma(tenantId, tpag));
  const derivada = derivadas.find((d) => ids.has(d));
  if (derivada) return derivada;
  return [...ids].sort(compararBinario)[0] ?? null;
}

/** RN-INF-11: quem não é a vencedora do código sai do lote como linha inválida (regra do ERP; não vai ao Hub como registro). */
export function separarFormasRepetidas(registros: readonly RegistroEspelho[], vencedoraPorCodigo: ReadonlyMap<string, string>): { manter: RegistroEspelho[]; repetidas: LinhaInvalida[] } {
  const manter: RegistroEspelho[] = [];
  const repetidas: LinhaInvalida[] = [];
  for (const r of registros) {
    const v = r.entidade === 'forma_pagamento' ? vencedoraPorCodigo.get(String(r.payload.codigo)) : undefined;
    if (v !== undefined && v !== r.external_id) repetidas.push({ external_id: r.external_id, codigo: CODIGO_FORMA_REPETIDA, campo: 'codigo' });
    else manter.push(r);
  }
  return { manter, repetidas };
}

/** RN-INF-11: o prazo referencia a forma pela chave vencedora; `vencedoraDe(formaAtual)` devolve `null` se não souber (fica como está). */
export function remapearFormaDoPrazo(r: RegistroEspelho, vencedoraDe: (formaExternalId: string) => string | null): RegistroEspelho {
  if (r.entidade !== 'prazo_pagamento') return r;
  const atual = r.payload.forma_external_id;
  if (typeof atual !== 'string') return r;
  const v = vencedoraDe(atual);
  return v && v !== atual ? { ...r, payload: { ...r.payload, forma_external_id: v } } : r;
}

/** RN-INF-12: `parcelas_dias` é lista de inteiros (v2, nunca texto) e `prazo_medio_dias` é inteiro presente. */
export function prazoProntoParaHub(payload: Record<string, unknown>): boolean {
  const p = payload.parcelas_dias;
  if (!Array.isArray(p) || lerParcelasDias(p) === null) return false;
  const m = payload.prazo_medio_dias;
  return typeof m === 'number' && Number.isInteger(m) && m >= 0;
}

/**
 * RN-INF-02: o Hub recusou por dependência inexistente (referência que o espelho tinha como confirmada). `referencia_ausente`
 * ou qualquer código terminado em `_inexistente`, `_ausente` ou `_nao_encontrado(a)`.
 */
export function ehErroDeDependenciaDoHub(codigo: string): boolean {
  return /(^referencia_ausente$|inexistente$|_ausente$|nao_encontrad[oa]$)/.test(codigo);
}

/**
 * RN-INF-02: referências (entidade alvo e chave) a desmarcar quando o Hub recusa o dependente por dependência. Com o `campo` do erro,
 * só a referência dele; sem campo conhecido, todas as do dependente.
 */
export function referenciasADesmarcar(entidade: EntidadeHub, registro: Record<string, unknown>, campo: string | null | undefined): Array<{ alvo: EntidadeHub; chave: string }> {
  const refs = REFERENCIAS_HUB[entidade] ?? [];
  const doCampo = refs.filter(([c]) => c === campo);
  return (doCampo.length > 0 ? doCampo : refs).flatMap(([c, a]) => (typeof registro[c] === 'string' ? [{ alvo: a, chave: registro[c] as string }] : []));
}
