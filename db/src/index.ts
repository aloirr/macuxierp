/** Papéis do banco macuxierp (docs/produto/04, "Banco"). Senhas só no .env do servidor. */
export const BANCO = 'macuxierp' as const;
export const PAPEIS = {
  app: 'macuxierp_app',
  leitura: 'macuxierp_leitura',
  worker: 'macuxierp_worker',
} as const;
/** Schemas: um por módulo, mais a plataforma (o ERP nunca lê tabela do FDV). */
export const SCHEMAS = [
  'plataforma',
  'core',
  'cadastros',
  'pedido',
  'faturamento',
  'fiscal',
  'integracao_fdv',
] as const;
/** Tenant de referência das tabelas oficiais (D9). */
export const TENANT_REFERENCIA = '00000000-0000-0000-0000-000000000000' as const;

export { migrar, listarMigracoes } from './migrar.ts';
export { type Conexao, type Contexto, conexaoDoAmbiente, consultar, executar } from './psql.ts';
