/**
 * O XSD do simulador (xmllint-wasm, uma worker thread por documento) não cabe nos 5 s padrão com a suíte em
 * paralelo no turbo. Mesmo valor do nfe-sefaz; o C3 das 20 notas tem limite próprio no teste.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 30_000 } });
