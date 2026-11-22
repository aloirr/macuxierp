/**
 * Contratos públicos do módulo integracao-fdv (Zod). Única parte importável por outros módulos e pelos shells.
 * Mudança incompatível = nova versão do contrato (@2) + ADR + recado aos consumidores.
 */
import { z } from 'zod';

export const MODULO = 'integracao-fdv' as const;

/** Identificador do tenant (UUID). Repetido por módulo de propósito: o tipo vem sempre de contracts. */
export const TenantId = z.string().uuid();

export * from './credencial';
export * from './eventos';
export * from './hub';
export * from './monitor';
