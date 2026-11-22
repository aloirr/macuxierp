/**
 * Endereço do cliente com o nome do município do IBGE, montado em um lugar só: o evento do cliente (C-1/C-3) e a
 * consulta para o pedido (T-0015) usam o mesmo helper, em lote (uma consulta por chamada, sem repetir código).
 */
import type { Repositorios } from './portas';

/** `municipio_nome` é `null` quando o código não está na tabela oficial do IBGE. */
export async function comNomeMunicipio<E extends { municipio_ibge: string }>(
  r: Repositorios, enderecos: readonly E[],
): Promise<(E & { municipio_nome: string | null })[]> {
  const mapa = await r.oficiais.nomesMunicipios([...new Set(enderecos.map((e) => e.municipio_ibge))]);
  return enderecos.map((e) => ({ ...e, municipio_nome: mapa.get(e.municipio_ibge) ?? null }));
}
