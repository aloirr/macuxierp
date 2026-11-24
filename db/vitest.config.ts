import { defineConfig } from 'vitest/config';

// Testes de banco: cada arquivo cria e migra um banco efêmero (segundos), e o psql roda síncrono.
// T-0053/T-0073: o spawnSync de src/psql.ts bloqueia o event loop do worker (em qualquer pool, threads ou forks) e,
// sob carga, o vitest caía com "Timeout calling onTaskUpdate" (birpc, 60 s). O setupFile testes/ceder-loop.ts cede o
// loop após cada teste. Pool forks com no máximo 2 workers e teardown folgado limitam a carga.
// Causa raiz (v0.4): psql assíncrono (spawn).
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    setupFiles: ['./testes/ceder-loop.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
