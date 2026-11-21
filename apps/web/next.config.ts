import { readFileSync } from 'node:fs';
import type { NextConfig } from 'next';

const pacote = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
const doWorkspace = Object.keys(pacote.dependencies).filter((n) => n.startsWith('@macuxierp/'));

const config: NextConfig = {
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
