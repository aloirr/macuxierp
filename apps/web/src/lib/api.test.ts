import { describe, expect, it } from 'vitest';
import { buscarEu, entrar, NaoAutenticado, renovar } from './api';
import { CREDENCIAL_FALSA, EU_FALSO } from './falso';
import { EuSchema } from './eu';

describe('API falsa (até a T-0004)', () => {
  it('o /eu falso respeita o contrato', () => expect(EuSchema.parse(EU_FALSO)).toEqual(EU_FALSO));
  it('login com a credencial de demonstração', async () => {
    const s = await entrar(CREDENCIAL_FALSA.empresa, CREDENCIAL_FALSA.email, CREDENCIAL_FALSA.senha);
    expect(s).not.toBeNull();
    expect((await buscarEu(s!.acesso)).empresa.slug).toBe('demo');
    expect(await renovar(s!.refresh)).not.toBeNull();
  });
  it('credencial errada devolve null', async () => expect(await entrar('demo', 'x@y.invalid', 'errada')).toBeNull());
  it('token inválido: não autenticado', async () => {
    await expect(buscarEu('lixo')).rejects.toBeInstanceOf(NaoAutenticado);
  });
});
