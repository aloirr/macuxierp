'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiIndisponivel, entrar } from '@/lib/api';
import { COOKIE_ACESSO, COOKIE_REFRESH, destinoSeguro, opcoesAcesso, opcoesLongas } from '@/lib/sessao';

export interface EstadoLogin {
  erro?: string;
  /** Devolvidos para o formulário não se esvaziar após o erro (a senha nunca volta). */
  empresa?: string;
  email?: string;
}

export async function entrarAction(_: EstadoLogin, dados: FormData): Promise<EstadoLogin> {
  const empresa = String(dados.get('empresa') ?? '').trim().toLowerCase();
  const email = String(dados.get('email') ?? '').trim();
  const senha = String(dados.get('senha') ?? '');
  if (!empresa || !email || !senha) return { erro: 'Preencha empresa, e-mail e senha.', empresa, email };

  let sessao;
  try {
    sessao = await entrar(empresa, email, senha);
  } catch (e) {
    if (e instanceof ApiIndisponivel) return { erro: 'Serviço indisponível no momento. Tente novamente em instantes.', empresa, email };
    throw e;
  }
  if (!sessao) return { erro: 'Empresa, e-mail ou senha incorretos.', empresa, email };

  const jar = await cookies();
  jar.set(COOKIE_ACESSO, sessao.acesso, opcoesAcesso);
  jar.set(COOKIE_REFRESH, sessao.refresh, opcoesLongas);
  redirect(destinoSeguro(String(dados.get('destino') ?? '')));
}
