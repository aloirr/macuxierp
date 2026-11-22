/**
 * O C3 passa cada lote pelo XSD do simulador (xmllint-wasm, uma worker thread por documento) e monta 20 notas em
 * sequência: o tempo-limite padrão (5 s) não cobre a suíte em paralelo no turbo. Mesmo valor do nfe-sefaz.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 30_000 } });
