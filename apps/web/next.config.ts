import { execFileSync } from 'node:child_process';
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

/** Identificador do build, só para a trava da recarga e para o log (sem segredo): `MACUXI_BUILD_ID` ou o SHA curto do git; sem nenhum dos dois, `dev`. */
function idDoBuild(): string {
  if (process.env.MACUXI_BUILD_ID) return process.env.MACUXI_BUILD_ID;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

/** Páginas: tudo menos `/_next/static`, `/_next/image`, `/favicon.ico` e caminhos com extensão de arquivo. */
export const REGRA_SEM_CACHE = '/((?!_next/static|_next/image|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)';

export const ROTAS_ANTIGAS_DO_LOGIN = ['/login', '/config/entrar'];

const config: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: idDoBuild() },
  turbopack: { resolveAlias: aliasUi },
  output: 'standalone',
  poweredByHeader: false,
  // Os manifestos dos módulos e os pacotes do workspace são TypeScript puro.
  transpilePackages: doWorkspace,
  /** Login único na raiz (v0.3.27, decisão 42 = A): as rotas antigas do login passam a '/' em 308; o fragmento do link do e-mail (`#email=…`) o navegador mantém. */
  async redirects() {
    return ROTAS_ANTIGAS_DO_LOGIN.map((source) => ({ source, destination: '/', permanent: true }));
  },
  async headers() {
    return [
      {
        // HTML (BKO e /config) nunca em cache: o navegador sempre pega a página do build que está no ar. Fora os estáticos
        // com hash (`/_next/static`, cache imutável do Next), as imagens otimizadas, o favicon e os arquivos de `public/` com extensão.
        source: REGRA_SEM_CACHE,
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
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
