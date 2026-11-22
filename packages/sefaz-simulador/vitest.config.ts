/**
 * O validador XSD (xmllint-wasm) abre uma worker thread por documento: ~60 ms sozinho, bem mais com a suíte inteira
 * em paralelo no turbo. O tempo-limite padrão (5 s) derrubava teste com vários documentos; 30 s cobre a folga.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 30_000 } });
