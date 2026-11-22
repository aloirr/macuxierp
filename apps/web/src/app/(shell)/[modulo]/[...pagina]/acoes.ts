'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ApiIndisponivel, NaoAutenticado, escreverJson } from '@/lib/api';
import { SESSAO_EXPIRADA, escritaPermitida, resultadoDaResposta, type ResultadoEscrita } from '@/lib/descritor/escrita';
import { MANIFESTOS } from '@/lib/manifestos';
import { casarRota } from '@/lib/paginas';
import { escritaDeclarada } from '@/lib/telas';
import { COOKIE_ACESSO, contexto } from '@/lib/sessao';

export interface PedidoEscrita {
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  caminho: string;
  corpo?: unknown;
  idempotencia?: string;
  versao?: string;
  /** Rota da tela a recarregar depois do sucesso; só vale se for rota registrada de página. */
  recarregar?: string;
}

/**
 * Escrita genérica das telas de descritor (ação do detalhe e criação). Checa sessão, licença do módulo e perfil antes de
 * chamar a API com o token do cookie httpOnly; a API revalida tudo. Nada do corpo vai a log.
 */
export async function escrever(p: PedidoEscrita): Promise<ResultadoEscrita> {
  // Só o que algum descritor declarou (API do formulário, caminhos das ações); o resto o cliente não alcança.
  if (!escritaDeclarada(p.metodo, p.caminho)) return { ok: false, mensagem: 'Ação não reconhecida.' };
  const { eu } = await contexto();
  if (!escritaPermitida(p.metodo, p.caminho, eu, MANIFESTOS)) return { ok: false, mensagem: 'Seu perfil ou a licença da empresa não permitem esta ação.' };
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return { ok: false, mensagem: SESSAO_EXPIRADA };
  try {
    const r = await escreverJson(p.metodo, p.caminho, p.corpo, acesso, { idempotencia: p.idempotencia, versao: p.versao });
    if (r.ok && p.recarregar && casarRota(p.recarregar)) revalidatePath(p.recarregar);
    return resultadoDaResposta(r.status, r.ok, r.corpo);
  } catch (e) {
    if (e instanceof NaoAutenticado) return { ok: false, mensagem: SESSAO_EXPIRADA };
    if (e instanceof ApiIndisponivel) return { ok: false, mensagem: 'A API não respondeu. Tente de novo em instantes.' };
    throw e;
  }
}
