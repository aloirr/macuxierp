import { defineConfig } from 'vitest/config';

// Testes de banco: cada arquivo cria e migra um banco efêmero (segundos), e o psql roda síncrono.
// T-0053: o spawnSync de src/psql.ts bloqueia o event loop do worker do pool threads e, sob carga, o vitest caía com
// "Timeout calling onTaskUpdate" no liberar. Pool forks (processos) com no máximo 2 workers e teardown folgado.
// Causa raiz (v0.4): psql assíncrono (spawn).
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
