import { describe, expect, it, vi } from 'vitest';
import { ehUuidCanonico, externalIdColideComId } from './external-id';

const U = '3f2b8a10-5c6d-4e7f-8a9b-0c1d2e3f4a5b';

describe('UUID canônico (RD-0317, ADR 0010)', () => {
  it('RD-0317: 36 caracteres, hexadecimal minúsculo, com os quatro hifens', () => {
    expect(ehUuidCanonico(U)).toBe(true);
  });
  it.each([U.toUpperCase(), U.replaceAll('-', ''), `${U} `, `x${U}`, U.slice(0, 35), 'C000123', '123456789', ''])('RD-0317: %j não é canônico', (v) => {
    expect(ehUuidCanonico(v)).toBe(false);
  });
});

describe('guarda do external_id (RD-0317, RN-CORE-05)', () => {
  const existe = (v: boolean) => async () => v;
  it('RN-CORE-05: external_id canônico que é o id de um registro (inclusive o próprio) é recusado', async () => {
    expect(await externalIdColideComId(U, existe(true))).toEqual({ rn: 'RN-CORE-05', campo: 'external_id', mensagem: expect.stringContaining('UUID') });
  });
  it('RD-0317: canônico que não é id de ninguém passa', async () => {
    expect(await externalIdColideComId(U, existe(false))).toBeNull();
  });
  it('RD-0317: chave do kit, maiúsculo e valor que não é texto passam sem nem consultar', async () => {
    const consulta = vi.fn(async () => true);
    for (const v of ['C000123', U.toUpperCase(), undefined, null, 7]) expect(await externalIdColideComId(v, consulta)).toBeNull();
    expect(consulta).not.toHaveBeenCalled();
  });
});
