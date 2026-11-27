import { CABECALHO_CSRF_CONFIG, CAMINHO_ENTRAR_PELO_BKO, CODIGO_SEM_ACESSO_CONFIG, CODIGO_TROCAR_SENHA, COOKIE_CONFIG, MENSAGEM_SEM_ACESSO_CONFIG, SessaoPlataformaResposta } from '@macuxierp/platform-sdk';
import { buscarNaApi, usaApiFalsaAgora } from './api';
import { valorDoCookie } from './login-unico';

/**
 * C1 (45 A, v0.3.21): o usuário do BKO com `acesso_config` entra no /config sem novo login. `POST CAMINHO_ENTRAR_PELO_BKO`,
 * sem corpo, com o refresh do BKO (cookie, como no /v1/auth/sair) e o `CABECALHO_CSRF_CONFIG`. O token do portal vem só no
 * `Set-Cookie` do `COOKIE_CONFIG`; o BFF o guarda no `mx_config` (como no login único). Nada de token ou e-mail em log.
 */
export type ResultadoEntrarConfig =
  | { tipo: 'ok'; token: string; expira_em: string }
  | { tipo: 'sessao' }
  | { tipo: 'trocar_senha' }
  | { tipo: 'sem_acesso'; texto: string }
  | { tipo: 'indisponivel' };

/** Lê a resposta da API conforme o contrato (função pura sobre a `Response`). */
export async function lerEntrarConfig(r: Response): Promise<ResultadoEntrarConfig> {
  const corpo: unknown = await r.json().catch(() => null);
  const codigo = (corpo as { codigo?: unknown } | null)?.codigo;
  if (r.status === 401) return { tipo: 'sessao' };
  if (r.status === 403 && codigo === CODIGO_TROCAR_SENHA) return { tipo: 'trocar_senha' };
  if (r.status === 403 && codigo === CODIGO_SEM_ACESSO_CONFIG) {
    const m = (corpo as { mensagem?: unknown }).mensagem;
    return { tipo: 'sem_acesso', texto: typeof m === 'string' && m.trim() ? m.trim() : MENSAGEM_SEM_ACESSO_CONFIG };
  }
  if (!r.ok) return { tipo: 'indisponivel' };
  const s = SessaoPlataformaResposta.safeParse(corpo);
  const token = valorDoCookie(r, COOKIE_CONFIG);
  return s.success && token ? { tipo: 'ok', token, expira_em: s.data.expira_em } : { tipo: 'indisponivel' };
}

export async function entrarConfigPeloBko(refresh: string): Promise<ResultadoEntrarConfig> {
  if (usaApiFalsaAgora()) return { tipo: 'sem_acesso', texto: MENSAGEM_SEM_ACESSO_CONFIG };
  if (!refresh) return { tipo: 'sessao' };
  try {
    return await lerEntrarConfig(await buscarNaApi(CAMINHO_ENTRAR_PELO_BKO, { method: 'POST', headers: { cookie: refresh, [CABECALHO_CSRF_CONFIG]: '1' } }));
  } catch {
    return { tipo: 'indisponivel' };
  }
}
