import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { buscarEu, NaoAutenticado } from './api';
import type { Eu } from './eu';

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
  return destino && /^\/(?!\/|\\)/.test(destino) ? destino : '/';
}

export interface Contexto {
  eu: Eu;
  filialId: string | null;
  /** Filial escolhida (ou única), já resolvida contra /eu. */
  filial: Eu['filiais'][number] | null;
}

/** Lê a sessão do usuário; sem sessão válida, manda para o login. A filial vem do cookie, validada contra /eu. */
export async function contexto(): Promise<Contexto> {
  const jar = await cookies();
  const acesso = jar.get(COOKIE_ACESSO)?.value;
  if (!acesso) redirect('/sessao/renovar');
  try {
    const eu = await buscarEu(acesso);
    const f = jar.get(COOKIE_FILIAL)?.value;
    const filialId = eu.filiais.find((x) => x.id === f)?.id ?? (eu.filiais.length === 1 ? (eu.filiais[0]?.id ?? null) : null);
    const filial = eu.filiais.find((x) => x.id === filialId) ?? null;
    return { eu, filialId: filial?.id ?? null, filial };
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    throw e;
  }
}
