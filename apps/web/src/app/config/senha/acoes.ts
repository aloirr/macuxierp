'use server';
import { erroSenhaForaDaRegra, TrocarSenhaPlataformaEntrada } from '@macuxierp/platform-sdk';
import { redirect } from 'next/navigation';
import { trocarSenhaPlataforma } from '@/lib/config/api';
import { executarConfig } from '@/lib/config/executar';

export interface EstadoSenha {
  erro?: string;
}

export async function trocarSenhaAcao(_: EstadoSenha, dados: FormData): Promise<EstadoSenha> {
  const nova = String(dados.get('senha_nova') ?? '');
  const fora = erroSenhaForaDaRegra(nova);
  if (fora) return { erro: `${fora.mensagem}: ${fora.texto}.` };
  const p = TrocarSenhaPlataformaEntrada.safeParse({ senha_atual: String(dados.get('senha_atual') ?? ''), senha_nova: nova });
  if (!p.success) return { erro: 'Confira a senha atual e a senha nova.' };
  const r = await executarConfig('senha', (t) => trocarSenhaPlataforma(t, p.data));
  if (r.ok) redirect('/config');
  return { erro: r.erro };
}
