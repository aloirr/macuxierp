'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiIndisponivel, buscarEu, DadosInvalidos, entrar, MuitasTentativas } from '@/lib/api';
import { ROTA_SENHA } from '@/lib/troca-pendente';
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
    if (e instanceof MuitasTentativas) return { erro: e.message || 'Muitas tentativas. Tente novamente mais tarde.', empresa, email };
    if (e instanceof DadosInvalidos) return { erro: 'Dados inválidos. Confira empresa, e-mail e senha.', empresa, email };
    if (e instanceof ApiIndisponivel) return { erro: 'Serviço indisponível no momento. Tente novamente em instantes.', empresa, email };
    throw e;
  }
  if (!sessao) return { erro: 'Empresa, e-mail ou senha incorretos.', empresa, email };

  const jar = await cookies();
  jar.set(COOKIE_ACESSO, sessao.acesso, opcoesAcesso);
  jar.set(COOKIE_REFRESH, sessao.refresh, opcoesLongas);
  // Senha provisória: vai direto à troca (o shell também bloquearia, mas assim não passa por redirect em cadeia).
  const trocar = await buscarEu(sessao.acesso).then((eu) => eu.usuario.deve_trocar_senha === true).catch(() => false);
  if (trocar) redirect(ROTA_SENHA);
  redirect(destinoSeguro(String(dados.get('destino') ?? '')));
}
