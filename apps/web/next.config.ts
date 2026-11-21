import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Os manifestos dos módulos e os pacotes do workspace são TypeScript puro.
  transpilePackages: [
    '@macuxierp/platform-sdk',
    '@macuxierp/ui',
    '@macuxierp/core',
    '@macuxierp/cadastros',
    '@macuxierp/pedido',
    '@macuxierp/faturamento',
    '@macuxierp/fiscal',
    '@macuxierp/integracao-fdv',
  ],
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
