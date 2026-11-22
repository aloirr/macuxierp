/** Cifra de campo genérica (ADR 0005): AES-256-GCM com o tenant como dado associado. */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chaveIntegracaoDoAmbiente, cifrarCampo, decifrarCampo, ErroCifra, lerChaveMestra } from './cifra';

const T1 = '0d6b6a4e-3c1f-4b8e-9d2a-5f7e8c9a1b2c';
const T2 = '7a1e2d3c-4b5a-4f6e-8d7c-9b0a1f2e3d4c';
const CHAVE = randomBytes(32);
const SEGREDO = 'mfdv_SEGREDO-de-teste-0123456789abcdef';

describe('lerChaveMestra', () => {
  it('aceita 32 bytes em hex ou base64', () => {
    expect(lerChaveMestra('MACUXIERP_CHAVE_X', CHAVE.toString('hex')).equals(CHAVE)).toBe(true);
    expect(lerChaveMestra('MACUXIERP_CHAVE_X', ` ${CHAVE.toString('base64')}\n`).equals(CHAVE)).toBe(true);
  });

  it('chave ausente, curta ou ilegível: erro que cita só o nome da variável', () => {
    const invalidas = [undefined, '', 'abc', 'f'.repeat(62), randomBytes(16).toString('base64'), 'segredo-que-nao-pode-vazar-0123456789-xyz!'];
    for (const v of invalidas) {
      let erro: unknown;
      try {
        lerChaveMestra('MACUXIERP_CHAVE_X', v);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ErroCifra);
      expect((erro as Error).message).toContain('MACUXIERP_CHAVE_X');
      if (v) expect(`${(erro as Error).message} ${(erro as Error).stack}`).not.toContain(v);
    }
  });
});

describe('chaveIntegracaoDoAmbiente (T-0011: a mesma regra na API e no worker)', () => {
  it('ausente ou em branco: null', () => {
    expect(chaveIntegracaoDoAmbiente({})).toBeNull();
    expect(chaveIntegracaoDoAmbiente({ MACUXIERP_CHAVE_INTEGRACAO: '' })).toBeNull();
    expect(chaveIntegracaoDoAmbiente({ MACUXIERP_CHAVE_INTEGRACAO: ' \n' })).toBeNull();
  });

  it('32 bytes em hex ou base64: a chave', () => {
    expect(chaveIntegracaoDoAmbiente({ MACUXIERP_CHAVE_INTEGRACAO: CHAVE.toString('hex') })?.equals(CHAVE)).toBe(true);
    expect(chaveIntegracaoDoAmbiente({ MACUXIERP_CHAVE_INTEGRACAO: CHAVE.toString('base64') })?.equals(CHAVE)).toBe(true);
  });

  it('presente e inválida: ErroCifra que cita só o nome da variável', () => {
    const valor = 'segredo-que-nao-pode-vazar-0123456789-xyz!';
    let erro: unknown;
    try {
      chaveIntegracaoDoAmbiente({ MACUXIERP_CHAVE_INTEGRACAO: valor });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroCifra);
    expect((erro as Error).message).toContain('MACUXIERP_CHAVE_INTEGRACAO');
    expect(`${(erro as Error).message} ${(erro as Error).stack}`).not.toContain(valor);
  });
});

describe('cifrarCampo / decifrarCampo', () => {
  it('ida e volta (string e Buffer), no formato nonce(12) + cifrado + tag(16)', () => {
    const c = cifrarCampo({ chave: CHAVE, tenantId: T1, claro: SEGREDO });
    expect(c.length).toBe(12 + Buffer.byteLength(SEGREDO) + 16);
    expect(c.toString('latin1')).not.toContain(SEGREDO);
    expect(decifrarCampo({ chave: CHAVE, tenantId: T1, cifrado: c }).toString('utf8')).toBe(SEGREDO);
    const bin = randomBytes(100);
    expect(decifrarCampo({ chave: CHAVE, tenantId: T1, cifrado: new Uint8Array(cifrarCampo({ chave: CHAVE, tenantId: T1, claro: bin })) }).equals(bin)).toBe(true);
  });

  it('nonce diferente a cada cifra do mesmo claro', () => {
    const a = cifrarCampo({ chave: CHAVE, tenantId: T1, claro: SEGREDO });
    const b = cifrarCampo({ chave: CHAVE, tenantId: T1, claro: SEGREDO });
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('outro tenant, outra chave, adulteração ou tamanho curto: erro de mensagem fixa, sem ecoar dados', () => {
    const c = cifrarCampo({ chave: CHAVE, tenantId: T1, claro: SEGREDO });
    const adulterado = Buffer.from(c);
    adulterado[14] = (adulterado[14] ?? 0) ^ 0xff;
    const tentativas = [
      () => decifrarCampo({ chave: CHAVE, tenantId: T2, cifrado: c }),
      () => decifrarCampo({ chave: randomBytes(32), tenantId: T1, cifrado: c }),
      () => decifrarCampo({ chave: CHAVE, tenantId: T1, cifrado: adulterado }),
      () => decifrarCampo({ chave: CHAVE, tenantId: T1, cifrado: c.subarray(0, 27) }),
      () => decifrarCampo({ chave: CHAVE.subarray(0, 16), tenantId: T1, cifrado: c }),
    ];
    for (const t of tentativas) {
      let erro: unknown;
      try {
        t();
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ErroCifra);
      const texto = `${(erro as Error).message} ${(erro as Error).stack} ${JSON.stringify(erro)}`;
      expect(texto).toMatch(/^cifra: /);
      for (const proibido of [SEGREDO, T1, T2, CHAVE.toString('hex'), c.toString('hex')]) expect(texto).not.toContain(proibido);
    }
  });
});
