/** Worker do Macuxi ERP: filas da SEFAZ e da integração com o FDV (outbox). Entra na F1/F2. */
import { MODULOS } from '@macuxierp/platform-sdk';

export const SERVICO = 'worker' as const;
export const modulosConhecidos = MODULOS;
