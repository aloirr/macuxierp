export function argumento(nome: string, padrao: string): string;
export function argumento(nome: string, padrao: string | null): string | null;
export function entrar(pagina: unknown, base: string, u: { empresa: string; email: string; senha: string }): Promise<void>;
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
export interface UrlTela {
  url: string;
  origem: string;
  contexto: 'sem-sessao' | 'portal' | 'bko';
  comParametro?: boolean;
  abas?: boolean;
}
export function urlsDasTelas(dados: unknown): UrlTela[];
export function abasDaEmpresa(pagina: unknown, base: string, url: string): Promise<string[]>;
