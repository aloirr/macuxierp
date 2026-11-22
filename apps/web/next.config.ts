import { readFileSync, readdirSync } from 'node:fs';
import type { NextConfig } from 'next';

const pacote = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
const doWorkspace = Object.keys(pacote.dependencies).filter((n) => n.startsWith('@macuxierp/'));

/**
 * O `@macuxierp/ui` importa os próprios arquivos com sufixo `.js` (`./TabelaDensa.js`, estilo NodeNext) e o Turbopack não troca
 * `.js` por `.ts`/`.tsx`. Enquanto o pacote não usa import sem sufixo (recado ao designer-ux), o shell mapeia cada um para o fonte.
 */
const PASTA_UI = '../../packages/ui/src';
const aliasUi = Object.fromEntries(
  readdirSync(new URL(`${PASTA_UI}/`, import.meta.url))
    .filter((f) => /^(?!index\.|.*\.test\.)[A-Za-z]+\.tsx?$/.test(f))
    .map((f) => [`./${f.replace(/\.tsx?$/, '')}.js`, `${PASTA_UI}/${f}`]),
);

const config: NextConfig = {
  turbopack: { resolveAlias: aliasUi },
  output: 'standalone',
  poweredByHeader: false,
  // Os manifestos dos módulos e os pacotes do workspace são TypeScript puro.
  transpilePackages: doWorkspace,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
