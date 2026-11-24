'use server';
import { redirect } from 'next/navigation';
import { trocarSenhaPlataforma } from '@/lib/config/api';
import { executarConfig } from '@/lib/config/executar';
import { SenhaInformada, SenhaNova, erroSenhaForaDaRegra } from '@macuxierp/platform-sdk';
import type { EstadoTrocaSenha } from '@/components/formulario-troca-senha';
import { estadoDaTroca, SENHAS_NAO_CONFEREM } from '@/lib/troca-senha';

export async function trocarSenhaAcao(_: EstadoTrocaSenha, dados: FormData): Promise<EstadoTrocaSenha> {
  const nova = String(dados.get('senha_nova') ?? '');
  const confirmacao = String(dados.get('confirmacao') ?? '');
  // Troca da senha temporária (RN-CORE-13): sem o campo, `senha_atual` não vai (a API revalida o motivo).
  const informouAtual = dados.has('senha_atual');
  const atual = SenhaInformada.safeParse(String(dados.get('senha_atual') ?? ''));
  const novaOk = SenhaNova.safeParse(nova);
  if ((informouAtual && !atual.success) || !novaOk.success) return { erro: erroSenhaForaDaRegra(nova)?.texto ?? 'Confira a senha atual e a senha nova.' };
  if (estadoDaTroca(informouAtual && atual.success ? atual.data : '', nova, confirmacao, informouAtual).difere) return { campos: { confirmacao: SENHAS_NAO_CONFEREM } };
  const corpo = { ...(informouAtual && atual.success ? { senha_atual: atual.data } : {}), senha_nova: novaOk.data };
  const r = await executarConfig('senha', (t) => trocarSenhaPlataforma(t, corpo));
  if (r.ok) redirect('/config');
  return { erro: r.erro };
}
