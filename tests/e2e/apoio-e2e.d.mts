export function argumento(nome: string, padrao: string): string;
export function argumento(nome: string, padrao: string | null): string | null;
export function entrar(pagina: unknown, base: string, u: { email: string; senha: string }): Promise<void>;
export function ehNaoEncontrada(html: string): boolean;
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
export const CONTEXTO_PT_BR: Readonly<{ locale: 'pt-BR'; timezoneId: 'America/Manaus' }>;
export function abrirNavegador<N>(chromium: { launch(o?: object): Promise<N> }): Promise<N>;
export function novoContexto<C>(navegador: { newContext(o?: object): Promise<C> }, opcoes?: object): Promise<C>;
export function assercaoLigada(nome: 'carregadoSoComData' | 'singularRegistroCarregado'): boolean;
export function exigirQuandoLigada(nome: 'carregadoSoComData' | 'singularRegistroCarregado', cond: unknown, msg: string): boolean;
export function carregadoSemData(pagina: unknown, onde: string): Promise<{ lidas: number; defeito: string }>;
