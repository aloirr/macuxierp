'use server';
import { EntrarPlataformaEntrada } from '@macuxierp/platform-sdk';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { entrarPlataforma } from '@/lib/config/api';
import { CREDENCIAL_INVALIDA, mensagemDoErro } from '@/lib/config/erros';
import { COOKIE_CONFIG_WEB, opcoesConfig } from '@/lib/config/sessao';

export interface EstadoEntrarConfig {
  erro?: string;
  /** Devolvido para o campo não se esvaziar; a senha nunca volta. */
  email?: string;
}

export async function entrarConfigAcao(_: EstadoEntrarConfig, dados: FormData): Promise<EstadoEntrarConfig> {
  const email = String(dados.get('email') ?? '').trim();
  const p = EntrarPlataformaEntrada.safeParse({ email, senha: String(dados.get('senha') ?? '') });
  if (!p.success) return { erro: CREDENCIAL_INVALIDA, email };
  let sessao;
  try {
    sessao = await entrarPlataforma(p.data);
  } catch (e) {
    return { erro: mensagemDoErro(e, 'entrar').texto, email };
  }
  if (!sessao) return { erro: CREDENCIAL_INVALIDA, email };
  (await cookies()).set(COOKIE_CONFIG_WEB, sessao.token, opcoesConfig(sessao.expira_em));
  redirect('/config');
}
