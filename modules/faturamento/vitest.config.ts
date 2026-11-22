/**
 * Os testes ponta a ponta do faturamento (emissão contra o simulador da SEFAZ, XSD e assinatura) rodam em paralelo
 * no turbo; sob carga o tempo-limite padrão (5 s) derrubava teste correto. 30 s cobre a folga, como no nfe-sefaz.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
