import { FALHA } from './textos';

/** Depois de um deploy, a página aberta ainda chama uma server action que o servidor novo não conhece mais. */
export const SISTEMA_ATUALIZADO = 'Há uma versão nova do Macuxi ERP. Recarregue a página.';

/**
 * Reconhece o erro do Next para server action inexistente. No cliente o Next 16 lança `UnrecognizedActionError` quando o
 * servidor responde com `x-nextjs-action-not-found: 1` (next/dist/client/components/router-reducer/reducers/server-action-reducer.js:103-105);
 * no servidor o texto é "Failed to find Server Action".
 */
export function ehAcaoAusente(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && ((e as { name?: unknown }).name === 'UnrecognizedActionError' || (e as { name?: unknown }).name === 'ErroVersaoNova')) return true;
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /failed to find server action|server action .*not found|server action not found/i.test(texto);
}

/** Texto de tela para uma exceção de server action: o aviso de deploy novo ou o padrão. */
export function mensagemDaFalha(e: unknown, padrao: string = FALHA): string {
  return ehAcaoAusente(e) ? SISTEMA_ATUALIZADO : padrao;
}
