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
  const atual = SenhaInformada.safeParse(String(dados.get('senha_atual') ?? ''));
  const novaOk = SenhaNova.safeParse(nova);
  if (!atual.success || !novaOk.success) return { erro: erroSenhaForaDaRegra(nova)?.texto ?? 'Confira a senha atual e a senha nova.' };
  if (estadoDaTroca(atual.data, nova, confirmacao).difere) return { campos: { confirmacao: SENHAS_NAO_CONFEREM } };
  const r = await executarConfig('senha', (t) => trocarSenhaPlataforma(t, { senha_atual: atual.data, senha_nova: novaOk.data }));
  if (r.ok) redirect('/config');
  return { erro: r.erro };
}
