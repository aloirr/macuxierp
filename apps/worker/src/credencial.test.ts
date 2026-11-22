/** Chave mestra das credenciais do conector no worker (T-0009 §6): `MACUXIERP_CHAVE_INTEGRACAO` = versão 1. */
import { randomBytes } from 'node:crypto';
import { cifrarCampo } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { configurarCredenciais } from './credencial';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';

describe('configurarCredenciais', () => {
  it('sem a variável (ou em branco): laço de agenda desligado (null)', () => {
    expect(configurarCredenciais({})).toBeNull();
    expect(configurarCredenciais({ MACUXIERP_CHAVE_INTEGRACAO: '  ' })).toBeNull();
  });

  it('chave em hex ou base64 vira a versão 1', () => {
    const mestra = randomBytes(32);
    const c = cifrarCampo({ chave: mestra, tenantId: T1, claro: 'mfdv_chave' });
    for (const valor of [mestra.toString('hex'), mestra.toString('base64')]) {
      const decifrar = configurarCredenciais({ MACUXIERP_CHAVE_INTEGRACAO: valor });
      expect(decifrar?.(c, T1, 1)).toBe('mfdv_chave');
      expect(() => decifrar?.(c, T1, 2)).toThrow(/versão de chave desconhecida/);
    }
  });

  it('versão desconhecida (2, 0, 1.5, NaN): erro de mensagem fixa, sem a chave mestra nem o cifrado', () => {
    const mestra = randomBytes(32);
    const decifrar = configurarCredenciais({ MACUXIERP_CHAVE_INTEGRACAO: mestra.toString('hex') });
    const c = cifrarCampo({ chave: mestra, tenantId: T1, claro: 'mfdv_chave' });
    for (const versao of [2, 0, 1.5, Number.NaN]) {
      expect(() => decifrar?.(c, T1, versao)).toThrow(/^credencial do conector: versão de chave desconhecida$/);
    }
    expect(decifrar?.(c, T1, 1)).toBe('mfdv_chave');
  });

  it('chave inválida derruba a partida citando só o nome da variável', () => {
    const valor = 'valor-secreto-invalido-que-nao-pode-vazar';
    expect(() => configurarCredenciais({ MACUXIERP_CHAVE_INTEGRACAO: valor })).toThrow(/MACUXIERP_CHAVE_INTEGRACAO/);
    try {
      configurarCredenciais({ MACUXIERP_CHAVE_INTEGRACAO: valor });
    } catch (e) {
      expect(`${(e as Error).message} ${(e as Error).stack}`).not.toContain(valor);
    }
  });
});
