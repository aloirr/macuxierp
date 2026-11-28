/**
 * Conferências do login do portal `/config` que usam o `expect` do vitest. Ficam fora do `portal-pg.ts` porque o
 * `tests/e2e/apoio-api.ts` importa aquele arquivo fora do runner do vitest (servidores dos e2e), e um `import` de topo do
 * vitest derruba a partida deles ("Vitest failed to access its internal state").
 */
import { expect } from 'vitest';
import { ContaBloqueadaResposta, COOKIE_CONFIG, MENSAGEM_LOGIN_INVALIDO } from '../../packages/platform-sdk/src/index';
import type { RespostaPortal } from './portal-pg';

/**
 * ADR 0012 §6 e ADR 0021 (texto travado pelo PO, `MENSAGEM_LOGIN_INVALIDO` do SDK): 401 com o corpo inteiro
 * `{ codigo, mensagem }`, sem campo que diga qual dado errou, e sem cookie nenhum.
 */
export function esperarRecusaUnica(r: RespostaPortal): void {
  expect(r.statusCode, r.body).toBe(401);
  expect(r.json()).toEqual({ codigo: 'NAO_AUTENTICADO', mensagem: MENSAGEM_LOGIN_INVALIDO });
  expect(r.cookies).toEqual([]);
}

/** RN-CORE-15 (T-0111): 423 com o corpo `ContaBloqueadaResposta` do SDK e sem cookie de sessão. */
export function esperarContaBloqueada(r: RespostaPortal): void {
  expect(r.statusCode, r.body).toBe(423);
  expect(ContaBloqueadaResposta.parse(r.json())).toEqual(r.json());
  expect(r.cookies.map((c) => c.name)).not.toContain(COOKIE_CONFIG);
}
