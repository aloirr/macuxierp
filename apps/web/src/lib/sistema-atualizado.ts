import { unstable_isUnrecognizedActionError as acaoNaoReconhecida } from 'next/navigation';
import { FALHA } from './textos';

/** Depois de um deploy, a página aberta ainda chama uma server action que o servidor novo não conhece mais. */
export const SISTEMA_ATUALIZADO = 'O sistema foi atualizado. Recarregue a página.';

/** Reconhece o erro do Next para server action inexistente ("Failed to find Server Action", "Server Action ... was not found on the server", "Server action not found."). */
export function ehAcaoAusente(e: unknown): boolean {
  if (typeof acaoNaoReconhecida === 'function' && acaoNaoReconhecida(e)) return true;
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /failed to find server action|server action .*not found|server action not found/i.test(texto);
}

/** Texto de tela para uma exceção de server action: o aviso de deploy novo ou o padrão. */
export function mensagemDaFalha(e: unknown, padrao: string = FALHA): string {
  return ehAcaoAusente(e) ? SISTEMA_ATUALIZADO : padrao;
}
