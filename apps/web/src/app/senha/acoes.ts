'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { erroSenhaForaDaRegra } from '@macuxierp/platform-sdk';
import { ApiIndisponivel, NaoAutenticado, renovar, trocarSenha } from '@/lib/api';
import { SEM_RESPOSTA } from '@/lib/textos';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { COOKIE_ACESSO, COOKIE_REFRESH, destinoSeguro, opcoesAcesso, opcoesLongas } from '@/lib/sessao';
import type { EstadoTrocaSenha } from '@/components/formulario-troca-senha';
import { AVISO_SENHA_TROCADA, estadoDaTroca, SENHAS_NAO_CONFEREM } from '@/lib/troca-senha';

/** Refresh depois da troca: qualquer falha (revogado, API fora) vira `null` e a pessoa entra de novo com a senha nova. */
async function renovarSemFalhar(refresh: string | undefined) {
  if (!refresh) return null;
  try {
    return await renovar(refresh);
  } catch {
    return null;
  }
}

/**
 * Troca de senha do BKO. Revalida a regra no servidor (a API revalida de novo). As senhas só passam pelo corpo da chamada:
 * nada vai a log, URL ou estado devolvido. Obrigatória (sem `destino`): vai ao início; voluntária: volta ao destino com aviso.
 */
export async function trocarSenhaBkoAction(_: EstadoTrocaSenha, dados: FormData): Promise<EstadoTrocaSenha> {
  // Troca da senha temporária (RN-CORE-13): o formulário não tem o campo, então `senha_atual` não vai (a API revalida o motivo).
  const informouAtual = dados.has('senha_atual');
  const atual = String(dados.get('senha_atual') ?? '');
  const nova = String(dados.get('senha_nova') ?? '');
  const confirmacao = String(dados.get('confirmacao') ?? '');
  if (informouAtual && !atual) return { campos: { senha_atual: 'Informe a senha atual.' } };
  const { regrasOk, difere } = estadoDaTroca(atual, nova, confirmacao, informouAtual);
  if (!regrasOk) return { campos: { senha_nova: erroSenhaForaDaRegra(nova)?.texto ?? '' } };
  if (difere) return { campos: { confirmacao: SENHAS_NAO_CONFEREM } };
  const jar = await cookies();
  const acesso = jar.get(COOKIE_ACESSO)?.value;
  const refresh = jar.get(COOKIE_REFRESH)?.value;
  if (!acesso) redirect('/sessao/renovar');

  let resultado;
  try {
    resultado = await trocarSenha(acesso, refresh, { ...(informouAtual ? { senha_atual: atual } : {}), senha_nova: nova });
  } catch (e) {
    if (e instanceof NaoAutenticado) redirect('/sessao/renovar');
    if (e instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (e instanceof ApiIndisponivel) return { erro: SEM_RESPOSTA };
    throw e;
  }
  if (!resultado.ok) return { ...(resultado.erro ? { erro: resultado.erro } : {}), campos: resultado.campos, ...(resultado.regras ? { regras: resultado.regras } : {}) };

  // O acesso corrente ainda leva a marca de senha provisória (dts): renova já, para o shell não voltar a bloquear.
  const sessaoNova = await renovarSemFalhar(refresh);
  if (!sessaoNova) {
    jar.delete(COOKIE_ACESSO);
    jar.delete(COOKIE_REFRESH);
    redirect('/login');
  }
  jar.set(COOKIE_ACESSO, sessaoNova.acesso, opcoesAcesso);
  jar.set(COOKIE_REFRESH, sessaoNova.refresh, opcoesLongas);

  const destino = String(dados.get('destino') ?? '');
  if (!destino) redirect('/');
  const seguro = destinoSeguro(destino);
  redirect(`${seguro}${seguro.includes('?') ? '&' : '?'}aviso=${AVISO_SENHA_TROCADA}`);
}
