/**
 * ESLint compartilhado (flat config). Copiado do Macuxi FDV, com ignores do monorepo modular.
 * A raiz (eslint.config.mjs) reexporta esta configuração; cada pacote roda `eslint .`.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { ARQUIVOS_DE_TESTE, pluginMacuxi } from './regras/hora-fixa.mjs';

export const macuxiEslint = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/expo-env.d.ts',
      // fixtures do teste de fronteira: violam as regras de propósito
      '**/__fixtures__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // T-0043 (ADR 0015): teste não mistura instante fixo com o relógio real. AVISO até virar erro (data no ADR);
    // exceção pontual com `// hora-fixa-ok: <motivo>`.
    files: ARQUIVOS_DE_TESTE,
    plugins: { macuxi: pluginMacuxi },
    rules: { 'macuxi/hora-fixa-em-teste': 'warn' },
  },
);

export default macuxiEslint;
