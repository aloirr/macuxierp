import { defineConfig } from 'vitest/config';

// Os *.db.test.ts de tests/ criam e migram um banco efêmero no beforeAll (segundos): prazos maiores que o padrão.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 180_000 } });
