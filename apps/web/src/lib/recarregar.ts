import { casarRota } from './paginas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Rota de página registrada; a de parâmetro (`:id`) só vale com o segmento em UUID (nada de rota arbitrária no revalidate). */
export function recarregarValido(rota: string): boolean {
  const c = casarRota(rota);
  return c !== undefined && Object.values(c.params).every((v) => UUID.test(v));
}
