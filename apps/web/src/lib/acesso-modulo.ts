import { pode } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from '@/lib/manifestos';
import { contexto } from '@/lib/sessao';

/**
 * Licença do módulo, perfil no manifesto e `pode` da ação para quem está na sessão. É a checagem do shell (esconder, dar 404 ou
 * "sem permissão"); a API revalida tudo (RN-CORE-02).
 */
export async function temAcessoAoModulo(modulo: string, acao: Parameters<typeof pode>[1]): Promise<boolean> {
  const { eu } = await contexto();
  const licenciado = eu.modulos.some((m) => m.id === modulo);
  const perfilOk = MANIFESTOS.some((m) => m.id === modulo && m.perfis.includes(eu.usuario.perfil));
  return licenciado && perfilOk && pode(eu.usuario.perfil, acao);
}
