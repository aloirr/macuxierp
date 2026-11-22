import { describe, expect, it } from 'vitest';
import { CargaPedido, MAX_ARQUIVOS_LOTE } from './index';

describe('contrato da carga de CSV', () => {
  it('CargaPedido aceita até MAX_ARQUIVOS_LOTE arquivos (o literal do .max() é lido pelo teste de sincronia da CLI)', () => {
    const arquivo = { nome: 'cliente.csv', bytes: new Uint8Array() };
    expect(CargaPedido.safeParse({ modo: 'validar', arquivos: Array(MAX_ARQUIVOS_LOTE).fill(arquivo) }).success).toBe(true);
    expect(CargaPedido.safeParse({ modo: 'validar', arquivos: Array(MAX_ARQUIVOS_LOTE + 1).fill(arquivo) }).success).toBe(false);
  });
});
