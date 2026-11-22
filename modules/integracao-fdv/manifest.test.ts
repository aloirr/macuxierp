import { describe, expect, it } from 'vitest';
import { manifest } from './manifest';
import { EVENTOS_DE_RETORNO } from './domain/retorno-pedido';

describe('manifesto do módulo integracao-fdv', () => {
  it('tem o id da pasta e só publica eventos próprios', () => {
    expect(manifest.id).toBe('integracao-fdv');
    expect(manifest.publica.every((e) => e.startsWith('integracao-fdv.'))).toBe(true);
  });

  it('RN-PED-05: consome os eventos de retorno do pedido, sem aprovado@1 nem recusado@1 e com faturado@1 (RD-0164)', () => {
    expect(manifest.consome).toEqual(expect.arrayContaining([...EVENTOS_DE_RETORNO]));
    expect(manifest.consome).not.toContain('pedido.pedido.aprovado@1');
    expect(manifest.consome).not.toContain('pedido.pedido.recusado@1');
  });
});
