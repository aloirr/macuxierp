import { LIMITE_REGISTROS_LOTE_FDV } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { LIMITE_INICIAL_FDV, validarLimiteLote } from './integracao-fdv';

describe('campo "Registros por lote"', () => {
  it('o valor inicial é o teto do SDK (5000)', () => expect(LIMITE_INICIAL_FDV).toBe(5000));
  it('aceita de 1 ao teto e recusa o resto', () => {
    expect(validarLimiteLote(' 250 ')).toEqual({ ok: true, valor: 250 });
    expect(validarLimiteLote(String(LIMITE_REGISTROS_LOTE_FDV))).toEqual({ ok: true, valor: 5000 });
    for (const t of ['0', '5001', '-1', '1,5', 'abc', '']) expect(validarLimiteLote(t).ok).toBe(false);
    expect(validarLimiteLote('0')).toEqual({ ok: false, erro: 'Informe um número de 1 a 5.000.' }); // RD-2326: um erro só
  });
});
