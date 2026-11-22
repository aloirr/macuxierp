/**
 * Cliente do Hub do FDV do worker (T-0009 §6): a base de cada ambiente vem de uma lista fixa na configuração do
 * servidor (anti-SSRF), nunca do tenant. Ambiente:
 * - `MACUXIERP_HUB_URL_TESTE` e `MACUXIERP_HUB_URL_PRODUCAO` (https, sem credencial nem consulta), as duas ou nenhuma.
 * Sem a configuração, devolve `null`. Uma só, ou URL inválida, derruba a partida (erro de configuração).
 * A versão do ERP vai só no `User-Agent` (P-2, opção A) e vem de `MACUXIERP_VERSAO` (`versaoDoErp`).
 */
import { criarClienteHub, type ClienteHub } from '@macuxierp/platform-sdk';

/** Versão do ERP pelo `MACUXIERP_VERSAO` do compose (sem o `v` inicial); ausente → 'dev'. Fora de `[0-9A-Za-z.+-]` derruba a partida. */
export function versaoDoErp(env: Readonly<Record<string, string | undefined>>): string {
  const v = env.MACUXIERP_VERSAO?.trim().replace(/^v/, '');
  if (!v) return 'dev';
  if (!/^[0-9A-Za-z.+-]{1,64}$/.test(v)) throw new Error('configuração inválida: MACUXIERP_VERSAO');
  return v;
}

export function configurarHub(env: Readonly<Record<string, string | undefined>>, versaoErp: string, f?: typeof fetch): ClienteHub | null {
  const teste = env.MACUXIERP_HUB_URL_TESTE?.trim() || undefined;
  const producao = env.MACUXIERP_HUB_URL_PRODUCAO?.trim() || undefined;
  if (!teste && !producao) return null;
  if (!teste || !producao) throw new Error('configuração inválida: MACUXIERP_HUB_URL_TESTE e MACUXIERP_HUB_URL_PRODUCAO vão juntas');
  return criarClienteHub({ urls: { teste, producao }, versaoErp, ...(f ? { fetch: f } : {}) });
}
