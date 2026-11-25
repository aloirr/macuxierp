import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do repositório. */
export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

/** Nomes das pastas de `modules/` (módulo novo entra sozinho). */
export const modulos = (): string[] => readdirSync(join(RAIZ, 'modules'));

/**
 * Fontes de produção do web: apps/web/src e modules/<m>/web, só .ts/.tsx, sem `*.test.ts(x)` nem `apoio-teste.ts`.
 * Caminhos absolutos. Usado pela fumaça das telas (T-0065) e pelo contrato dos `CAMINHOS_*` (T-0066).
 */
export function arquivosDoWeb(): string[] {
  const pastas = [join(RAIZ, 'apps', 'web', 'src'), ...modulos().map((m) => join(RAIZ, 'modules', m, 'web'))];
  const fora = /\.test\.tsx?$|apoio-teste\.ts$/;
  return pastas.flatMap((p) => {
    try {
      return (readdirSync(p, { recursive: true }) as string[]).map((f) => join(p, f)).filter((f) => /\.tsx?$/.test(f) && !fora.test(f));
    } catch {
      return []; // módulo sem web (ex.: fiscal)
    }
  });
}

/** 404 genérico do `setNotFoundHandler` (apps/api/src/app.ts): a rota não existe na API (404 de regra traz outra mensagem). */
export const ehRotaInexistente = (status: number, corpo: string): boolean =>
  status === 404 && /"mensagem":"Rota não encontrada"/.test(corpo);
