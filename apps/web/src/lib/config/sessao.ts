import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_CONFIG_WEB, PATH_CONFIG, ROTA_ENTRAR } from './constantes';

/**
 * Sessão do superadmin no shell (ADR 0012, seção 2): cookie PRÓPRIO, com nome e path distintos do BKO (`mx_acesso`, `mx_refresh`,
 * path `/`). O valor é o token opaco da API (o cookie `macuxierp_config` dela, `Path=/v1/plataforma`), guardado httpOnly aqui.
 * Path `/config`: o navegador nunca o manda ao BKO; e este código nunca lê os cookies do BKO. Sem refresh: venceu, entra de novo.
 */
export { COOKIE_CONFIG_WEB, PATH_CONFIG, ROTA_ENCERRAR, ROTA_ENTRAR, ROTA_SENHA } from './constantes';

/** Teto da sessão (8 h, ADR 0012); o vencimento real vem da API em `expira_em`. */
const OITO_HORAS = 8 * 60 * 60;

export function opcoesConfig(expiraEm?: string, agora: Date = new Date()) {
  const ate = expiraEm ? Math.floor((Date.parse(expiraEm) - agora.getTime()) / 1000) : OITO_HORAS;
  const maxAge = Number.isFinite(ate) ? Math.max(1, Math.min(OITO_HORAS, ate)) : OITO_HORAS;
  return { httpOnly: true, sameSite: 'strict', path: PATH_CONFIG, secure: process.env.NODE_ENV === 'production', maxAge } as const;
}

/** Token do superadmin, ou null. Lê só `mx_config`. */
export async function tokenConfig(): Promise<string | null> {
  const v = (await cookies()).get(COOKIE_CONFIG_WEB)?.value;
  return v && v.length > 0 ? v : null;
}

/** Token para uma página ou ação: sem sessão de superadmin, vai ao login da plataforma. */
export async function exigirTokenConfig(): Promise<string> {
  const t = await tokenConfig();
  if (!t) redirect(ROTA_ENTRAR);
  return t;
}

/** Em ação de servidor (pode alterar cookie): sessão terminada, apaga o cookie e volta ao login. */
export async function encerrarEVoltar(): Promise<never> {
  (await cookies()).delete({ name: COOKIE_CONFIG_WEB, path: PATH_CONFIG });
  redirect(ROTA_ENTRAR);
}
