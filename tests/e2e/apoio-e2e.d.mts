export function argumento(nome: string, padrao: string): string;
export function argumento(nome: string, padrao: string | null): string | null;
export function exigir(cond: unknown, msg: string): asserts cond;
export function criarRoteiro(
  saida: string,
  mascarar?: (s: string) => string,
): {
  resultados: { nome: string; ok: boolean; erro?: string }[];
  prints: string[];
  passo: (nome: string, fn: () => Promise<void>) => Promise<void>;
  print: (pagina: unknown, arquivo: string, recorte?: unknown) => Promise<void>;
};
