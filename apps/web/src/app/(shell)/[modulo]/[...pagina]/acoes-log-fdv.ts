'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LogCadastroFdvTenant, ENTIDADES_ENVIO_FDV } from '@macuxierp/platform-sdk';
import { NaoAutenticado, SemPermissao, getValidado } from '@/lib/api';
import { ROTA_SENHA, TrocarSenhaPendente } from '@/lib/troca-pendente';
import { temAcessoAoModulo } from '@/lib/acesso-modulo';
import { SESSAO_EXPIRADA } from '@/lib/descritor/escrita';
import { COOKIE_ACESSO } from '@/lib/sessao';

export type ResultadoLogFdv = { ok: true; log: LogCadastroFdvTenant } | { ok: false; motivo: 'sem_permissao' | 'erro'; mensagem?: string };

/**
 * Lê o Log de um cadastro (`GET /v1/integracao-fdv/entidades/:entidade/log`) com o token do cookie httpOnly. Confere licença e
 * `integracao-fdv.ver` antes; a API revalida (RN-CORE-02). Nada do conteúdo vai a log.
 */
export async function lerLogFdv(entidade: string): Promise<ResultadoLogFdv> {
  const e = ENTIDADES_ENVIO_FDV.find((x) => x === entidade);
  if (!e) return { ok: false, motivo: 'erro' };
  if (!(await temAcessoAoModulo('integracao-fdv', 'integracao-fdv.ver'))) return { ok: false, motivo: 'sem_permissao' };
  const acesso = (await cookies()).get(COOKIE_ACESSO)?.value;
  if (!acesso) return { ok: false, motivo: 'erro', mensagem: SESSAO_EXPIRADA };
  try {
    const log = await getValidado(`/v1/integracao-fdv/entidades/${encodeURIComponent(e)}/log`, LogCadastroFdvTenant, acesso, 'log da integração', true);
    return { ok: true, log };
  } catch (err) {
    if (err instanceof TrocarSenhaPendente) redirect(ROTA_SENHA);
    if (err instanceof NaoAutenticado) return { ok: false, motivo: 'erro', mensagem: SESSAO_EXPIRADA };
    if (err instanceof SemPermissao) return { ok: false, motivo: 'sem_permissao' };
    return { ok: false, motivo: 'erro' };
  }
}
