#!/usr/bin/env node
/**
 * Empacota o Conector em um único arquivo (dist/conector.mjs) com esbuild. Os pacotes oficiais (zip Windows e tar.gz Linux,
 * com SHA256SUMS) saem do workflow .github/workflows/conector-montar.yml, que roda este build e junta conector.mjs, exemplos/,
 * windows/ ou linux/ e o LEIAME.md. `node:sqlite` fica de fora (é do próprio Node 24.7+).
 * Uso: pnpm --filter ./apps/conector build
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(raiz, 'dist'), { recursive: true });

await build({
  entryPoints: [join(raiz, 'src/cli.ts')],
  outfile: join(raiz, 'dist/conector.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  minify: false,
  external: ['node:*'],
  // pacotes CommonJS (pg, tedious) usam require() dinâmico: precisam de um require no escopo do módulo ESM
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
