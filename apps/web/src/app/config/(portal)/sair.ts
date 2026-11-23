'use server';
import { sairPlataforma } from '@/lib/config/api';
import { encerrarEVoltar, tokenConfig } from '@/lib/config/sessao';

/** "Sair": POST (server action, Origin conferido pelo Next). Revoga na API e apaga o cookie do /config. */
export async function sairConfigAcao() {
  const token = await tokenConfig();
  if (token) await sairPlataforma(token);
  return encerrarEVoltar();
}
