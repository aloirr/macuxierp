import { setTimeout as esperar } from 'node:timers/promises';
import { beforeAll, expect, it } from 'vitest';
import { PRAZO_HOOK_BANCO_MS } from './pg-testes';

// Prova do `vi.setConfig` do apoio: hook sem prazo explícito, registrado depois da importação, que passa dos 10 s padrão
// do vitest. Sem o `hookTimeout` do apoio, cai com "Hook timed out in 10000ms" (o que derrubou o primeiro liberar).
const DURACAO_MS = 10_500;
let terminou = false;

beforeAll(async () => {
  await esperar(DURACAO_MS);
  terminou = true;
});

it('o apoio dos testes de banco estende o prazo dos hooks do arquivo que o importa', () => {
  expect(PRAZO_HOOK_BANCO_MS).toBeGreaterThan(DURACAO_MS);
  expect(terminou).toBe(true);
});
