/** UUID de registro fictício dos testes de rota (404 de regra quando o registro é buscado). */
export const UUID_FICTICIO = '9f000000-0000-4000-8000-000000000001';

/**
 * Troca cada `:param` do modelo de caminho por `valores['<segmento anterior>/:param']` (ex.: `'filiais/:id'`), senão
 * `valores[param]`, senão `UUID_FICTICIO`.
 */
export function preencherCaminho(modelo: string, valores: Readonly<Record<string, string>> = {}): string {
  return modelo.replace(/:([a-z_]+)/g, (_, p: string, i: number) => {
    const anterior = modelo.slice(0, i).split('/').at(-2);
    return valores[`${anterior}/:${p}`] ?? valores[p] ?? UUID_FICTICIO;
  });
}
