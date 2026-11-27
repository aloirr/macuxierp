'use server';
import { ROTA_TELA_LOGIN } from '@macuxierp/platform-sdk';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PATH_CONFIG } from '@/lib/config/constantes';
import { COOKIE_CONFIG_WEB, opcoesConfig } from '@/lib/config/sessao';
import { entrarConfigPeloBko } from '@/lib/entrar-config';
import { COOKIE_REFRESH } from '@/lib/sessao';
import { FALHA } from '@/lib/textos';
import { ROTA_SENHA } from '@/lib/troca-pendente';

export interface EstadoEntrarConfig { erro?: string }

/** C1 (45 A): "Configuração" no menu do BKO abre o /config com a sessão do BKO; a API decide quem pode (o web só mostra o item). */
export async function entrarConfigAction(_: EstadoEntrarConfig): Promise<EstadoEntrarConfig> {
  const jar = await cookies();
  const r = await entrarConfigPeloBko(jar.get(COOKIE_REFRESH)?.value ?? '');
  if (r.tipo === 'ok') {
    jar.set(COOKIE_CONFIG_WEB, r.token, opcoesConfig(r.expira_em));
    redirect(PATH_CONFIG);
  }
  if (r.tipo === 'sessao') redirect(ROTA_TELA_LOGIN);
  if (r.tipo === 'trocar_senha') redirect(ROTA_SENHA);
  return { erro: r.tipo === 'sem_acesso' ? r.texto : FALHA };
}
