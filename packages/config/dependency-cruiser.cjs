/**
 * Regras de fronteira do Macuxi ERP (docs/produto/04 "Regras de fronteira"; CLAUDE.md regra 1).
 *
 * Um módulo importa apenas `packages/*`, `modules/core/contracts` e `modules/<outro>/contracts`.
 * Os caminhos são relativos ao diretório onde o depcruise roda (raiz do repo no CI;
 * a pasta do fixture no teste `fronteiras.test.ts`).
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'modulo-importa-interno-de-outro',
      severity: 'error',
      comment:
        'Módulo só importa a pasta contracts/ de outro módulo (domain, api, app, web, db e manifest são internos). ' +
        'Precisa de algo? Peça ao dono para expor em contracts (recado).',
      from: { path: '^modules/([^/]+)/' },
      to: { path: '^modules/', pathNot: ['^modules/$1/', '^modules/[^/]+/contracts/'] },
    },
    {
      name: 'modulo-importa-caminho-nao-exportado',
      severity: 'error',
      comment:
        'Import de pacote @macuxierp/* que não resolve: em geral é um subcaminho interno de outro módulo ' +
        'fora do "exports" do package.json (ex.: @macuxierp/pedido/domain).',
      from: { path: '^modules/' },
      to: { path: '^@macuxierp/', couldNotResolve: true },
    },
    {
      name: 'modulo-importa-app',
      severity: 'error',
      comment: 'Módulo não importa shells (apps/*); o shell é quem monta o módulo.',
      from: { path: '^modules/' },
      to: { path: '^apps/' },
    },
    {
      name: 'modulo-abre-conexao',
      severity: 'error',
      comment:
        'Módulo não abre conexão nem pool: usa a Transacao do ContextoRota (RLS do tenant). O adaptador ' +
        '@macuxierp/platform-sdk/pg é dos apps; teste de banco (*.test.ts) do módulo pode usá-lo.',
      from: { path: '^modules/', pathNot: '\\.test\\.ts$' },
      to: { path: '^packages/platform-sdk/src/pg(-testes)?\\.ts$' },
    },
    {
      name: 'app-importa-interno-de-modulo',
      severity: 'error',
      comment:
        'Shell (apps/*) monta o módulo pelo que ele exporta (manifest, contracts, api, app, web), nunca pelo domain ' +
        'nem pelo db.',
      from: { path: '^apps/' },
      to: { path: '^modules/[^/]+/(domain|db)/' },
    },
    {
      name: 'pacote-importa-modulo-ou-app',
      severity: 'error',
      comment: 'packages/* são a base: não conhecem módulos nem shells.',
      from: { path: '^packages/' },
      to: { path: '^(modules|apps)/' },
    },
    {
      name: 'contracts-importa-camada-interna',
      severity: 'error',
      comment: 'contracts/ é importado por outros módulos e pelo app: não pode puxar api, app, web ou db.',
      from: { path: '^modules/([^/]+)/contracts/' },
      to: { path: '^modules/$1/(api|app|web|db)/' },
    },
    {
      name: 'domain-importa-camada-interna',
      severity: 'error',
      comment: 'domain/ é regra pura (roda na API, no worker e na web): não importa api, app, web nem db.',
      from: { path: '^modules/([^/]+)/domain/' },
      to: { path: '^modules/$1/(api|app|web|db)/' },
    },
    {
      name: 'domain-usa-modulo-do-node',
      severity: 'error',
      comment: 'domain/ é função pura (roda na API, no worker e no BKO): sem fs, path, crypto etc. do Node.',
      from: { path: '^modules/[^/]+/domain/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'ciclo-entre-arquivos',
      severity: 'warn',
      comment: 'Dependência circular: quebre extraindo o trecho comum.',
      from: { path: '^(modules|packages)/' },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|\\.next|\\.expo|\\.turbo|dist|coverage|__fixtures__)/' },
    // pega também `import type` (senão um tipo interno de outro módulo passaria)
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
