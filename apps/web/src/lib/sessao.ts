import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { buscarEu, NaoAutenticado } from './api';
import type { EuResposta } from '@macuxierp/platform-sdk';

export const COOKIE_ACESSO = 'mx_acesso';
export const COOKIE_REFRESH = 'mx_refresh';
export const COOKIE_FILIAL = 'mx_filial';
const MIN_15 = 15 * 60;
const DIAS_30 = 30 * 24 * 60 * 60;

const base = { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' } as const;
export const opcoesAcesso = { ...base, maxAge: MIN_15 };
/** Refresh e filial escolhida duram o mesmo (30 dias). */
export const opcoesLongas = { ...base, maxAge: DIAS_30 };

/** Só caminhos internos: evita redirecionamento aberto pelo parâmetro "destino". */
export function destinoSeguro(destino: string | null | undefined): string {
  // Navegadores removem TAB/LF/CR da URL ('/\t/x.com' viraria '//x.com'): recusa controle e barra invertida em qualquer posição.
  // eslint-disable-next-line no-control-regex -- recusar caractere de controle é o objetivo
  if (!destino || /[\x00-\x1f\x7f\\]/.test(destino)) return '/';
  return /^\/(?!\/)/.test(destino) ? destino : '/';
}

export interface Contexto {
  eu: EuResposta;
  /** Filial escolhida (ou única), já resolvida contra /eu. */
  filial: EuResposta['filiais'][number] | null;
}

/** Lê a sessão do usuário; sem sessão válida, manda para o login. A filial vem do cookie, validada contra /eu. */
export async function contexto(): Promise<Contexto> {
  const jar = await cookies();
  const acesso = jar.get(COOKIE_ACESSO)?.value;
  if (!acesso) redirect('/sessao/renovar');
  try {
    const eu = await buscarEu(acesso);
    const f = jar.get(COOKIE_FILIAL)?.value;
    const filial = eu.filiais.find((x) => x.id === f) ?? (eu.filiais.length === 1 ? eu.filiais[0] : undefined) ?? null;
    return { eu, filial };
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    throw e;
  }
}
