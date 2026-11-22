import { defineConfig } from 'vitest/config';

// Testes de banco: cada arquivo cria e migra um banco efêmero (segundos), e o psql roda síncrono.
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
