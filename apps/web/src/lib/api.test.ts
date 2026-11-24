import { describe, expect, it } from 'vitest';
import { buscarEu, NaoAutenticado, renovar } from './api';
import { EU_FALSO, EU_FALSO_MEI, REFRESH_FALSO, TOKEN_FALSO } from './falso';
import { EuResposta } from '@macuxierp/platform-sdk';

describe('API falsa (até a T-0004)', () => {
  it('o /eu falso respeita o contrato', () => expect(EuResposta.parse(EU_FALSO)).toEqual(EU_FALSO));
  it('o /eu falso MEI respeita o contrato', () => expect(EuResposta.parse(EU_FALSO_MEI)).toEqual(EU_FALSO_MEI));
  it('sessão falsa: eu e renovação', async () => {
    expect((await buscarEu(TOKEN_FALSO)).empresa.slug).toBe('demo');
    expect(await renovar(REFRESH_FALSO)).not.toBeNull();
  });
  it('token inválido: não autenticado', async () => {
    await expect(buscarEu('lixo')).rejects.toBeInstanceOf(NaoAutenticado);
  });
});
