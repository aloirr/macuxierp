/**
 * Conferências do login do portal `/config` que usam o `expect` do vitest. Ficam fora do `portal-pg.ts` porque o
 * `tests/e2e/apoio-api.ts` importa aquele arquivo fora do runner do vitest (servidores dos e2e), e um `import` de topo do
 * vitest derruba a partida deles ("Vitest failed to access its internal state").
 */
import { expect } from 'vitest';
import { ContaBloqueadaResposta, COOKIE_CONFIG } from '../../packages/platform-sdk/src/index';
import type { RespostaPortal } from './portal-pg';

/** Texto literal do ADR 0012 §6, travado pelo PO na ADR 0021 (com o ponto final; não importado: o teste confere o valor). */
const MENSAGEM_UNICA = 'E-mail ou senha inválidos.';

/** ADR 0012 §6: 401 com a mensagem única e sem cookie de sessão. */
export function esperarRecusaUnica(r: RespostaPortal): void {
  expect(r.statusCode, r.body).toBe(401);
  expect(r.json<{ mensagem: string }>().mensagem).toBe(MENSAGEM_UNICA);
  expect(r.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
}

/** RN-CORE-15 (T-0111): 423 com o corpo `ContaBloqueadaResposta` do SDK e sem cookie de sessão. */
export function esperarContaBloqueada(r: RespostaPortal): void {
  expect(r.statusCode, r.body).toBe(423);
  expect(ContaBloqueadaResposta.parse(r.json())).toEqual(r.json());
  expect(r.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
}
