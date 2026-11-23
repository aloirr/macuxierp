'use server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiIndisponivel, NaoAutenticado, SemPermissao, buscarRegistro, escreverJson } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { SEM_RESPOSTA } from '@/lib/textos';
import { SESSAO_EXPIRADA, escritaPermitida, leituraPermitida, resultadoDaResposta, type ResultadoEscrita } from '@/lib/descritor/escrita';
import { MANIFESTOS } from '@/lib/manifestos';
import { recarregarValido } from '@/lib/recarregar';
import { escritaDeclarada, leituraDeclarada } from '@/lib/telas';
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

/** Caminho de API vindo do cliente: texto de até 200 caracteres (a forma `/v1/<modulo>/...` é checada pela barreira). */
const CAMINHO = z.string().max(200);

/** Barreira comum da escrita e da leitura: sessão do contexto, licença e perfil (`permitido`) e o token do cookie httpOnly. */
async function barreira(permitido: (eu: Awaited<ReturnType<typeof contexto>>['eu']) => unknown, recusa: string): Promise<{ ok: true; acesso: string } | { ok: false; mensagem: string }> {
  const { eu } = await contexto();
  if (!permitido(eu)) return { ok: false, mensagem: recusa };
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  return acesso ? { ok: true, acesso } : { ok: false, mensagem: SESSAO_EXPIRADA };
}

/** Falhas de sessão e de rede da API viram texto para pessoas; outras ficam com quem chamou (`undefined`). */
function falhaDaApi(e: unknown): { ok: false; mensagem: string } | undefined {
  if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
  if (e instanceof NaoAutenticado) return { ok: false, mensagem: SESSAO_EXPIRADA };
  if (e instanceof ApiIndisponivel) return { ok: false, mensagem: SEM_RESPOSTA };
  return undefined;
}

function rethrow(e: unknown): never { throw e; }

/**
 * Escrita genérica das telas de descritor (ação do detalhe e criação). Checa sessão, licença do módulo e perfil antes de
 * chamar a API com o token do cookie httpOnly; a API revalida tudo. Nada do corpo vai a log.
 */
export async function escrever(p: PedidoEscrita): Promise<ResultadoEscrita> {
  // Só o que algum descritor declarou (API do formulário, caminhos das ações); o resto o cliente não alcança.
  if (!CAMINHO.safeParse(p.caminho).success || !escritaDeclarada(p.metodo, p.caminho)) return { ok: false, mensagem: 'Ação não reconhecida.' };
  const barra = await barreira((eu) => escritaPermitida(p.metodo, p.caminho, eu, MANIFESTOS), 'Seu perfil ou a licença da empresa não permitem esta ação.');
  if (!barra.ok) return barra;
  const acesso = barra.acesso;
  try {
    const r = await escreverJson(p.metodo, p.caminho, p.corpo, acesso, { idempotencia: p.idempotencia, versao: p.versao });
    if (r.ok && p.recarregar && recarregarValido(p.recarregar)) revalidatePath(p.recarregar);
    return resultadoDaResposta(r.status, r.ok, r.corpo);
  } catch (e) {
    return falhaDaApi(e) ?? rethrow(e);
  }
}

export type ResultadoLeitura = { ok: true; dados: unknown } | { ok: false; mensagem: string };

/**
 * Leitura (GET) que o diálogo de uma ação pede (itens do pedido, ambiente da filial). Só caminhos que um descritor declarou, com a mesma
 * barreira de sessão, licença e perfil da escrita; a resposta é validada pelo schema do descritor. A API revalida tudo.
 */
export async function ler(caminho: string): Promise<ResultadoLeitura> {
  const leitura = CAMINHO.safeParse(caminho).success ? leituraDeclarada(caminho) : undefined;
  if (!leitura) return { ok: false, mensagem: 'Leitura não reconhecida.' };
  const barra = await barreira((eu) => leituraPermitida(caminho, eu, MANIFESTOS), 'Seu perfil ou a licença da empresa não permitem esta leitura.');
  if (!barra.ok) return barra;
  const acesso = barra.acesso;
  try {
    const dados = await buscarRegistro(caminho, leitura.schema, acesso, 'leitura do diálogo');
    return dados === null ? { ok: false, mensagem: 'Registro não encontrado.' } : { ok: true, dados };
  } catch (e) {
    if (e instanceof SemPermissao) return { ok: false, mensagem: 'Seu perfil não pode ver estes dados.' };
    return falhaDaApi(e) ?? { ok: false, mensagem: 'Não foi possível carregar agora.' };
  }
}
