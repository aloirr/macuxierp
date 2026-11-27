'use server';
import { ROTA_TELA_LOGIN } from '@macuxierp/platform-sdk';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sair } from '@/lib/api';
import { COOKIE_ACESSO, COOKIE_FILIAL, COOKIE_REFRESH } from '@/lib/sessao';

export async function sairAction() {
  const jar = await cookies();
  await sair(jar.get(COOKIE_ACESSO)?.value ?? '', jar.get(COOKIE_REFRESH)?.value ?? '');
  for (const nome of [COOKIE_ACESSO, COOKIE_REFRESH, COOKIE_FILIAL]) jar.delete(nome);
  redirect(ROTA_TELA_LOGIN);
}
