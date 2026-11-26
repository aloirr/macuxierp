/**
 * Código e campo do erro por linha do FDV (T-0086): o SDK é a fonte, e `CodigoErro` e `CampoErro` de
 * `modules/integracao-fdv/contracts` são reexport (molde do `LIMITE_REGISTROS_LOTE_FDV`). Arquivo folha, sem import de
 * outro arquivo do SDK, para o `cliente-fdv.ts` usar sem ciclo (T-0110); o `portal-integracao-operacao.ts` reexporta daqui.
 */
import { z } from 'zod';

export const CodigoErroFdv = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/);
export const CampoErroFdv = z.string().regex(/^[A-Za-z0-9_.[\]]{1,80}$/).nullable();
